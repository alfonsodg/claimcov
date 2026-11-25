import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig, loadConfig } from "../src/init.mjs";

test("init round-trips the verification inputs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "claimcov-init-"));
  try {
    await saveConfig(dir, {
      doc: "docs/demo/README.md",
      url: "https://demo.example/",
      tagValues: ["work", "home"],
      extra: { owner: "qa@example.test" },
    });
    assert.deepEqual(await loadConfig(dir), {
      doc: "docs/demo/README.md",
      url: "https://demo.example/",
      tagValues: ["work", "home"],
      extra: { owner: "qa@example.test" },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig tolerates a missing or corrupt file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "claimcov-init-"));
  try {
    assert.deepEqual(await loadConfig(dir), {});
    await writeFile(join(dir, "claimcov.json"), "{not json");
    assert.deepEqual(await loadConfig(dir), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
