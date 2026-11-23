import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runKane, OUTCOME } from "../src/kane.mjs";
import { resumeArgv } from "../src/resume.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, "fixtures", "fake-kane.mjs");

/**
 * The stub is a node script, so every call goes through the interpreter.
 * It behaves according to the argv it receives, like the real CLI.
 */
const run = (args, opts = {}) =>
  runKane([FAKE, ...args], { bin: process.execPath, cwd: here, ...opts });

test("a completed run is COMPLETE and keeps every event", async () => {
  const r = await run([]);
  assert.equal(r.outcome, OUTCOME.COMPLETE);
  assert.equal(r.code, 0);
  assert.ok(r.events.some((e) => e.type === "commit"));
  assert.equal(r.events.at(-1).type, "done");
});

test("exit 2 surfaces REFUSED with the recovery command", async () => {
  const r = await run(["design", "tests"]);
  assert.equal(r.outcome, OUTCOME.REFUSED);
  assert.equal(r.code_name, "UC_UNREVIEWED");
  assert.match(r.next[0].cmd, /context review --approve/);
});

test("exit 3 surfaces PAUSED with the session and resume argv", async () => {
  const r = await run(["context", "extract"]);
  assert.equal(r.outcome, OUTCOME.PAUSED);
  assert.equal(r.session, "ext-test-1");
  assert.equal(r.questions.length, 1);

  const argv = resumeArgv(r);
  assert.deepEqual(argv, [
    "context",
    "extract",
    "--resume",
    "ext-test-1",
    "--mode",
    "agent",
    "--answer",
    "q1=1",
  ]);
});

test("exit 3 with no pause payload is a failure", async () => {
  const r = await run(["--nopause"]);
  assert.equal(r.outcome, OUTCOME.FAILED);
  assert.match(r.error, /without a session_paused/);
});

test("non-JSON noise is ignored, the real event still lands", async () => {
  const r = await run(["--broken"]);
  assert.equal(r.outcome, OUTCOME.FAILED);
  assert.ok(r.events.every((e) => typeof e === "object"));
  assert.ok(r.events.some((e) => e.type === "done"));
});

test("a run that overruns its deadline is killed and reported as TIMEOUT", async () => {
  const r = await run(["--hang"], { timeoutMs: 400 });
  assert.equal(r.outcome, OUTCOME.TIMEOUT);
});

test("onEvent sees each parsed event as it arrives", async () => {
  const seen = [];
  await run([], { onEvent: (e) => seen.push(e.type) });
  assert.ok(seen.includes("commit"));
  assert.equal(seen.at(-1), "done");
});

test("a missing binary fails instead of hanging", async () => {
  const r = await runKane(["whatever"], { bin: "/nonexistent/kane-cli-xyz" });
  assert.equal(r.outcome, OUTCOME.FAILED);
});
