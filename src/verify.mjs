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
import {
  coverageEvent,
  gapsEvent,
  buildReport,
  buildGaps,
  summarise,
  exitCodeFor,
} from "./report.mjs";
import { applyVariables } from "./variables.mjs";
import { readClaimSources } from "./sources.mjs";
import { loadConfig } from "./init.mjs";

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
  return [...new Set(useCaseCids(events).map((m) => m.id))];
}

/**
 * Collect the minted use-cases with their content ids.
 *
 * The `cid` is the join key into Kane's local store, where the DERIVES edges
 * cite the document line each use-case came from.
 */
export function useCaseCids(events) {
  const seen = new Set();
  const out = [];
  for (const e of events ?? []) {
    if (e?.type !== "commit") continue;
    // Only the extract verb mints use-cases. The design verb mints gaps and
    // tests, which `design tests --use-case` would reject.
    if (e.verb !== "extract") continue;
    for (const m of e.minted ?? []) {
      if (m?.logical_id?.startsWith("uc-") && typeof m?.cid === "string" && !seen.has(m.cid)) {
        seen.add(m.cid);
        out.push({ id: m.logical_id, cid: m.cid });
      }
    }
  }
  return out;
}

/**
 * @param {object} opts
 * @param {string} opts.doc            path to the document to verify
 * @param {string} [opts.url]          the product URL the claims are about
 * @param {string} [opts.cwd]          working directory, where .context lives
 * @param {number} [opts.maxUseCases]  cap how many claims get designed
 * @param {boolean} [opts.skipRun]     design but do not execute
 * @param {string[]} [opts.tagValues]  values for tag-like variables
 * @param {object} [opts.extra]        explicit variable values by name
 * @param {string} [opts.bin]          kane-cli binary, defaults to kane-cli
 * @param {string[]} [opts.prefix]     argv prefix for the test stub
 * @param {(s:object)=>void} [opts.onStep]
 */
export async function verify(opts = {}) {
  const {
    doc,
    cwd = resolve(".claimcov"),
    maxUseCases = 10,
    skipRun = false,
    bin,
    prefix,
    onStep,
  } = opts;

  if (!doc) throw new Error("a document is required");

  // Stored inputs are defaults; explicit options always win.
  const stored = await loadConfig(cwd);
  const url = opts.url ?? stored.url;
  const tagValues = opts.tagValues ?? stored.tagValues;
  const extra = opts.extra ?? stored.extra;
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
    bin,
    prefix,
  });
  record({ step: "ingest", outcome: ingest.outcome });
  if (ingest.outcome !== OUTCOME.COMPLETE) {
    return { ok: false, failedAt: "ingest", steps, report: null, gaps: [] };
  }

  // 2. Extract the claims, answering any pause on the way.
  const extract = await runUntilDone(["context", "extract", "--mode", "agent"], {
    cwd,
    url,
    bin,
    prefix,
    onStep: (s) => record(s),
  });
  record({ step: "extract", outcome: extract.outcome, resumes: extract.resumes });
  if (extract.outcome !== OUTCOME.COMPLETE) {
    return { ok: false, failedAt: "extract", steps, report: null, gaps: [] };
  }

  const ids = useCaseIds(extract.events).slice(0, maxUseCases);
  record({ step: "claims", outcome: "found", count: ids.length, ids });

  // 2b. Where each claim comes from. The stream never carries lines; the
  //     store's DERIVES edges do. Best-effort: no store, no lines.
  const sources = await readClaimSources(cwd, useCaseCids(extract.events));
  record({ step: "sources", outcome: "found", count: Object.keys(sources).length });

  // 3. Design a test per claim. A refusal here means the claim is unreviewed.
  //    The documented recovery is the approval Kane names (`context review
  //    --approve`); bypassing the review would skip the audit trail, so the
  //    loop approves and retries instead.
  const designed = [];
  for (const id of ids) {
    const argv = ["design", "tests", "--use-case", id, "--mode", "agent"];
    let run = await runUntilDone(argv, { cwd, url, bin, prefix, onStep: (s) => record(s) });

    if (run.outcome === OUTCOME.REFUSED) {
      const retried = await recoverAndRetry(argv, run, {
        cwd,
        url,
        bin,
        prefix,
        onStep: (s) => record(s),
      });
      if (retried) {
        run = retried;
      } else {
        record({
          step: "recover",
          id,
          outcome: "no approval offered",
          detail: run.code_name ?? run.error,
        });
      }
    }

    designed.push({ id, outcome: run.outcome });
    record({ step: "design", id, outcome: run.outcome });
  }

  // 3b. Fill in the values the design declared. Without this every test body
  //     still contains {{start_url}}, so it fails for the wrong reason and the
  //     failure looks like a false claim rather than a missing input.
  const vars = await applyVariables(cwd, { url, tagValues, extra });
  record({
    step: "variables",
    outcome: Object.keys(vars.filled).length ? "filled" : "none",
    filled: Object.keys(vars.filled),
    skipped: Object.keys(vars.skipped),
  });

  // 4. Run the tests, unless the caller only wanted the design.
  //    `testrun` takes `--agent`, not `--mode agent`: it is the NDJSON switch,
  //    and an unknown option is a hard refusal with exit 2.
  if (!skipRun && designed.some((d) => d.outcome === OUTCOME.COMPLETE)) {
    const run = await runUntilDone(["testrun", "run", "--agent"], { cwd, url, bin, prefix });
    record({ step: "testrun", outcome: run.outcome, error: run.error });
  }

  // 5. Prove. `cover --json` is the only thing that knows what passed.
  const cover = await runUntilDone(["cover", "--json", "--mode", "agent"], {
    cwd,
    url,
    bin,
    prefix,
  });
  record({ step: "cover", outcome: cover.outcome });

  // 5b. Pending work. `cover gaps` names what is still owed and the command
  //     that unblocks it, which is what makes the report actionable.
  let gaps = [];
  if (cover.outcome === OUTCOME.COMPLETE) {
    const gapsRun = await runUntilDone(["cover", "gaps", "--json", "--mode", "agent"], {
      cwd,
      url,
      bin,
      prefix,
    });
    record({ step: "gaps", outcome: gapsRun.outcome });
    gaps = buildGaps(gapsEvent(gapsRun.events));
  }

  const coverage = coverageEvent(cover.events);
  const report = buildReport(coverage, sources);

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
    gaps,
    designed,
  };
}
