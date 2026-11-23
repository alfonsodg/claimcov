#!/usr/bin/env node
/**
 * claimcov — prove the claims in your documentation with Kane CLI.
 *
 *   claimcov verify README.md https://your-product.example
 *   claimcov report .claimcov/report.json
 */
import { parseArgs } from "node:util";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { verify } from "./src/verify.mjs";
import { summarise, exitCodeFor } from "./src/report.mjs";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: "string" },
    dir: { type: "string", default: ".claimcov" },
    out: { type: "string" },
    max: { type: "string", default: "10" },
    "skip-run": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    quiet: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

const command = positionals[0];

if (args.help || !command) {
  process.stdout.write(`claimcov — prove your documentation claims

  claimcov verify <doc> [url]    run the pipeline and report claim coverage
  claimcov report <file>         re-print a saved report

Options for verify:
  --url <url>       the product URL the claims refer to
  --dir <path>      working directory for Kane's store, default .claimcov
  --out <path>      write the JSON report here
  --max <n>         design at most n claims, default 10
  --skip-run        design but do not execute the tests
  --json            print the report as JSON only
  --quiet           suppress progress on stderr

Exit codes:
  0  every claim that could be tested was proven, or is still owed
  1  at least one claim is false, or the pipeline failed
`);
  process.exit(command ? 0 : 2);
}

const log = args.quiet ? () => {} : (m) => process.stderr.write(`${m}\n`);

if (command === "verify") {
  const doc = positionals[1];
  const url = args.url ?? positionals[2];

  if (!doc) {
    process.stderr.write("a document is required\n");
    process.exit(2);
  }

  const result = await verify({
    doc,
    url,
    cwd: args.dir,
    maxUseCases: Number(args.max),
    skipRun: args["skip-run"],
    onStep: (s) => {
      if (s.step === "resume") log(`  ${s.detail}`);
      else if (s.step === "claims") log(`found ${s.count} claim(s): ${s.ids.join(", ")}`);
      else if (s.step === "design") log(`design ${s.id}: ${s.outcome}`);
      else log(`${s.step}: ${s.outcome}`);
    },
  });

  if (args.out) {
    await writeFile(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    log(`wrote ${args.out}`);
  } else if (!args.json) {
    const path = join(args.dir, "report.json");
    await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    log(`wrote ${path}`);
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  } else if (result.report) {
    log("");
    log(summarise(result.report));
    for (const c of result.report.claims) {
      log(`  ${c.status.padEnd(8)} ${c.title}`);
    }
  }

  process.exit(exitCodeFor(result.report));
}

if (command === "report") {
  const file = positionals[1];
  if (!file) {
    process.stderr.write("a report file is required\n");
    process.exit(2);
  }
  const saved = JSON.parse(await readFile(file, "utf8"));
  const report = saved.report ?? saved;
  process.stdout.write(`${summarise(report)}\n`);
  for (const c of report.claims ?? []) {
    process.stdout.write(`  ${c.status.padEnd(8)} ${c.title}\n`);
  }
  process.exit(exitCodeFor(report));
}

process.stderr.write(`unknown command: ${command}\n`);
process.exit(2);
