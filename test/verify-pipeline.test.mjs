import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verify } from "../src/verify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, "fixtures", "fake-kane.mjs");

test("verify runs the pipeline and surfaces cover gaps", async () => {
  const dir = await mkdtemp(join(tmpdir(), "claimcov-pipe-"));
  try {
    const doc = join(dir, "sample.md");
    await writeFile(doc, "# Sample\n\n- Create a task\n- Export to CSV\n");

    const steps = [];
    const result = await verify({
      doc,
      url: "https://demo.example/",
      cwd: dir,
      bin: process.execPath,
      prefix: [FAKE],
      tagValues: ["work", "home"],
      onStep: (s) => steps.push(s),
    });

    assert.equal(result.report.summary.total, 2);
    assert.equal(result.gaps.length, 1);
    assert.equal(result.gaps[0].ref, "gap-9");
    assert.match(result.gaps[0].command, /design tests/);
    assert.ok(
      steps.some((s) => s.step === "gaps"),
      "the gaps step is recorded"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
