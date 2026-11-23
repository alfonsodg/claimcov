#!/usr/bin/env node
/**
 * Demonstrate the closed loop against the real kane-cli.
 *
 * Ingest a document, extract use-cases, and when the run pauses for a decision
 * answer it from the recommended option and continue — no human in the middle.
 *
 *   node scripts/verify-loop.mjs <doc.md> [workdir]
 *
 * Returns 0 when the extraction completes, 1 otherwise.
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { runKane, OUTCOME } from "../src/kane.mjs";
import { resumeArgv, describePause } from "../src/resume.mjs";

const doc = process.argv[2];
if (!doc) {
  console.error("usage: node scripts/verify-loop.mjs <doc.md> [workdir]");
  process.exit(2);
}

const workdir = resolve(process.argv[3] ?? ".claimcov-work");
if (!existsSync(workdir)) await mkdir(workdir, { recursive: true });

// kane-cli stores its context relative to the working directory, so the source
// document is copied in rather than referenced.
const sourcePath = join(workdir, "README.md");
await writeFile(sourcePath, await readFile(doc, "utf8"));

const log = (m) => process.stderr.write(`${m}\n`);
let answers = 0;

const ingest = await runKane(["context", "ingest", "README.md"], { cwd: workdir });
if (ingest.outcome !== OUTCOME.COMPLETE) {
  log(`ingest failed: ${ingest.outcome} ${ingest.error ?? ""}`);
  process.exit(1);
}
log("ingest: 1 source");

let run = await runKane(["context", "extract", "--mode", "agent"], { cwd: workdir });
log(`extract: ${run.outcome}`);

// The loop. Bounded so a pathological session cannot spin forever.
for (let attempt = 0; run.outcome === OUTCOME.PAUSED && attempt < 6; attempt++) {
  log(`paused — ${describePause(run)}`);
  const argv = resumeArgv(run);
  if (!argv.length) {
    log("pause carried no usable resume command");
    process.exit(1);
  }
  answers++;
  log(`answering (${answers}) and resuming`);
  run = await runKane(argv, { cwd: workdir });
  log(`resume -> ${run.outcome}`);
}

if (run.outcome !== OUTCOME.COMPLETE) {
  log(`did not complete: ${run.outcome} ${run.error ?? ""}`);
  for (const n of run.next ?? []) log(`  next: ${n.cmd}`);
  process.exit(1);
}

const committed = run.events.find((e) => e.type === "commit");
log(
  `complete: ${committed?.derived ?? "?"} use-cases derived, ` +
    `${answers} question(s) answered automatically`
);
process.exit(0);
