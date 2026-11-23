/**
 * verify — run the whole pipeline over a document.
 *
 * Ingest the document, find the claims in it, design a test for each, run them
 * in a real browser, and report which claims survived.
 *
 * This stays deliberately thin: every step delegates to Kane. What the tool adds
 * is sequencing, the pause loop, and turning the coverage event into a claim
 * report.
 */
import { copyFile, mkdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join, resolve } from "node:path";
import { OUTCOME } from "./kane.mjs";
import { runUntilDone, recoverAndRetry } from "./loop.mjs";
import { coverageEvent, buildReport, summarise, exitCodeFor } from "./report.mjs";

const exists = async (p) => {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Collect the use-case ids a run produced.
 *
 * `extract` commits them under `minted`, each with a logical id such as `uc-1`.
 */
export function useCaseIds(events) {
  const ids = new Set();
  for (const e of events ?? []) {
    if (e?.type !== "commit") continue;
    // Only the extract verb mints use-cases. The design verb mints gaps and
    // tests, which `design tests --use-case` would reject.
    if (e.verb !== "extract") continue;
    for (const m of e.minted ?? []) {
      if (m?.logical_id?.startsWith("uc-")) ids.add(m.logical_id);
    }
  }
  return [...ids];
}

/**
 * @param {object} opts
 * @param {string} opts.doc            path to the document to verify
 * @param {string} [opts.url]          the product URL the claims are about
 * @param {string} [opts.cwd]          working directory, where .context lives
 * @param {number} [opts.maxUseCases]  cap how many claims get designed
 * @param {boolean} [opts.skipRun]     design but do not execute
 * @param {(s:object)=>void} [opts.onStep]
 */
export async function verify(opts = {}) {
  const {
    doc,
    url,
    cwd = resolve(".claimcov"),
    maxUseCases = 10,
    skipRun = false,
    onStep,
  } = opts;

  if (!doc) throw new Error("a document is required");
  const step = (s) => onStep?.({ ...s });
  const steps = [];

  const record = (s) => {
    steps.push(s);
    step(s);
  };

  await mkdir(cwd, { recursive: true });

  // kane-cli resolves the source relative to its working directory, so the
  // document is copied in rather than reached across the filesystem.
  const source = join(cwd, basename(doc) === "README.md" ? "README.md" : basename(doc));
  if (resolve(doc) !== resolve(source)) {
    await copyFile(doc, source);
  }

  // 1. Ingest.
  const ingest = await runUntilDone(["context", "ingest", basename(source)], {
    cwd,
    url,
  });
  record({ step: "ingest", outcome: ingest.outcome });
  if (ingest.outcome !== OUTCOME.COMPLETE) {
    return { ok: false, failedAt: "ingest", steps, report: null, gaps: [] };
  }

  // 2. Extract the claims, answering any pause on the way.
  const extract = await runUntilDone(["context", "extract", "--mode", "agent"], {
    cwd,
    url,
    onStep: (s) => record(s),
  });
  record({ step: "extract", outcome: extract.outcome, resumes: extract.resumes });
  if (extract.outcome !== OUTCOME.COMPLETE) {
    return { ok: false, failedAt: "extract", steps, report: null, gaps: [] };
  }

  const ids = useCaseIds(extract.events).slice(0, maxUseCases);
  record({ step: "claims", outcome: "found", count: ids.length, ids });

  // 3. Design a test per claim. A refusal here means the claim is unreviewed,
  //    which Kane itself tells us how to fix.
  const designed = [];
  for (const id of ids) {
    const argv = ["design", "tests", "--use-case", id, "--mode", "agent"];
    let run = await runUntilDone(argv, { cwd, url, onStep: (s) => record(s) });

    if (run.outcome === OUTCOME.REFUSED) {
      const retried = await recoverAndRetry(argv, run, {
        cwd,
        url,
        onStep: (s) => record(s),
      });
      if (retried) run = retried;
    }

    designed.push({ id, outcome: run.outcome });
    record({ step: "design", id, outcome: run.outcome });
  }

  // 4. Run the tests, unless the caller only wanted the design.
  if (!skipRun && designed.some((d) => d.outcome === OUTCOME.COMPLETE)) {
    const run = await runUntilDone(["testrun", "run"], { cwd, url });
    record({ step: "testrun", outcome: run.outcome });
  }

  // 5. Prove. `cover --json` is the only thing that knows what passed.
  const cover = await runUntilDone(["cover", "--json", "--mode", "agent"], {
    cwd,
    url,
  });
  record({ step: "cover", outcome: cover.outcome });

  const coverage = coverageEvent(cover.events);
  const report = buildReport(coverage);

  record({
    step: "result",
    outcome: report ? summarise(report) : "no coverage",
    exitCode: exitCodeFor(report),
  });

  return {
    ok: exitCodeFor(report) === 0,
    failedAt: null,
    steps,
    report,
    gaps: [],
    designed,
  };
}
