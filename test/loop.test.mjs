import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { overridesFor, runUntilDone, recoverAndRetry } from "../src/loop.mjs";
import { OUTCOME } from "../src/kane.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, "fixtures", "fake-kane.mjs");

const URL_QUESTION = {
  id: "q1",
  header: "missing start URL",
  text: "What is the browser entry URL for demo-app?",
  options: [{ label: "Fill start_url" }, { label: "Provide source" }],
  recommended_index: 0,
};

const OTHER_QUESTION = {
  id: "q2",
  header: "offline scope",
  text: "Which task actions does \u201cWorks offline\u201d cover?",
  options: [{ label: "Leave unspecified" }, { label: "All actions" }],
  recommended_index: 0,
};

const opts = (extra = {}) => ({ bin: process.execPath, cwd: here, prefix: [FAKE], ...extra });

test("a start-URL question is answered with the supplied URL", () => {
  const out = overridesFor([URL_QUESTION], { url: "https://demo.example" });
  assert.deepEqual(out, { q1: "https://demo.example" });
});

test("other questions keep the recommendation", () => {
  assert.deepEqual(overridesFor([OTHER_QUESTION], { url: "https://demo.example" }), {});
});

test("no URL means no overrides at all", () => {
  assert.deepEqual(overridesFor([URL_QUESTION], {}), {});
  assert.deepEqual(overridesFor([URL_QUESTION], { url: "" }), {});
});

test("recognises the variations kane-cli uses for the URL question", () => {
  for (const header of ["start_url", "entry URL", "product URL", "browser URL"]) {
    const out = overridesFor([{ id: "q", header, options: [{}] }], { url: "https://x.test" });
    assert.deepEqual(out, { q: "https://x.test" }, header);
  }
});

test("mixed questions only override the URL one", () => {
  const out = overridesFor([URL_QUESTION, OTHER_QUESTION], { url: "https://demo.example" });
  assert.deepEqual(out, { q1: "https://demo.example" });
});

test("the loop answers a pause and finishes without input", async () => {
  const steps = [];
  const run = await runUntilDone(["context", "extract", "--mode", "agent"], {
    ...opts(),
    url: "https://demo.example",
    onStep: (s) => steps.push(s),
  });

  assert.equal(run.outcome, OUTCOME.COMPLETE);
  assert.equal(run.resumes, 1);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].step, "resume");
  // The URL question must be answered with the URL, not with a numbered option.
  assert.deepEqual(steps[0].answered, ["q1"]);
});

test("without a URL the loop still answers from the recommendation", async () => {
  const run = await runUntilDone(["context", "extract", "--mode", "agent"], opts());
  assert.equal(run.outcome, OUTCOME.COMPLETE);
  assert.equal(run.resumes, 1);
});

test("the loop stops after the resume budget instead of spinning", async () => {
  const run = await runUntilDone(["--nopause"], opts({ maxResumes: 2 }));
  assert.equal(run.outcome, OUTCOME.FAILED);
  assert.equal(run.resumes, 0, "a malformed pause is not resumed");
});

test("a refusal reports the recovery commands", async () => {
  const steps = [];
  const run = await runUntilDone(["design", "tests"], {
    ...opts(),
    onStep: (s) => steps.push(s),
  });
  assert.equal(run.outcome, OUTCOME.REFUSED);
  assert.equal(steps.at(-1).step, "refused");
  assert.match(steps.at(-1).next[0], /context review --approve/);
});

test("recoverAndRetry approves and retries the command", async () => {
  const refused = await runUntilDone(["design", "tests"], opts());
  assert.equal(refused.outcome, OUTCOME.REFUSED);

  const steps = [];
  const retried = await recoverAndRetry(["design", "tests"], refused, {
    ...opts(),
    onStep: (s) => steps.push(s),
  });

  // The stub keeps refusing because --allow-unreviewed is what unblocks it,
  // so the retry legitimately ends refused again. What matters is that the
  // approval command ran.
  assert.equal(steps[0].step, "recover");
  assert.match(steps[0].detail, /context review --approve/);
  assert.ok(retried === null || retried.outcome === OUTCOME.REFUSED);
});

test("recoverAndRetry returns null when there is nothing to approve", async () => {
  assert.equal(await recoverAndRetry([], { next: [] }, opts()), null);
  assert.equal(await recoverAndRetry([], {}, opts()), null);
});
