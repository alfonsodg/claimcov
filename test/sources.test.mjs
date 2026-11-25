import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAnchor, readClaimSources } from "../src/sources.mjs";

/**
 * Store layout below mirrors a real `.context/commits/NNNNN-hash.json`
 * captured from kane-cli 0.10.8: nodes carry the use-case, DERIVES edges
 * carry the citation (`anchor`, `quote`, `source_id`).
 */
const COMMIT = {
  seq: 2,
  nodes: [
    { cid: "sha256:aa", label: "usecase", content: { title: "Sign in" } },
    { cid: "sha256:bb", label: "usecase", content: { title: "Create a task" } },
  ],
  edges: [
    {
      ecid: "sha256:ee1",
      type: "DERIVES",
      src: "sha256:src",
      dst: "sha256:aa",
      props: { source_id: "readme", anchor: "L16-L16", quote: "- Sign in with Google" },
    },
    {
      ecid: "sha256:ee2",
      type: "DERIVES",
      src: "sha256:src",
      dst: "sha256:bb",
      props: { source_id: "readme", anchor: "L12-L12", quote: "- Create tasks" },
    },
  ],
};

const setup = async (commit = COMMIT) => {
  const dir = await mkdtemp(join(tmpdir(), "claimcov-src-"));
  await mkdir(join(dir, ".context", "commits"), { recursive: true });
  await writeFile(join(dir, ".context", "commits", "000002-aa.json"), JSON.stringify(commit));
  return dir;
};

test("parseAnchor reads the L-first-last form", () => {
  assert.equal(parseAnchor("L16-L16"), 16);
  assert.equal(parseAnchor("L3-L9"), 3);
  assert.equal(parseAnchor("L7"), 7);
});

test("parseAnchor rejects what is not a line anchor", () => {
  assert.equal(parseAnchor(null), null);
  assert.equal(parseAnchor(""), null);
  assert.equal(parseAnchor("16"), null);
  assert.equal(parseAnchor("page 3"), null);
});

test("readClaimSources joins minted cids to their citations", async () => {
  const dir = await setup();
  try {
    const out = await readClaimSources(dir, [
      { id: "uc-1", cid: "sha256:aa" },
      { id: "uc-2", cid: "sha256:bb" },
    ]);
    assert.deepEqual(out["uc-1"], { line: 16, quote: "- Sign in with Google", source: "readme" });
    assert.deepEqual(out["uc-2"], { line: 12, quote: "- Create tasks", source: "readme" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readClaimSources ignores unknown cids and non-DERIVES edges", async () => {
  const dir = await setup({
    nodes: [{ cid: "sha256:zz", label: "usecase", content: {} }],
    edges: [{ type: "REFINES", dst: "sha256:zz", props: { anchor: "L1-L1" } }],
  });
  try {
    assert.deepEqual(await readClaimSources(dir, [{ id: "uc-9", cid: "sha256:nope" }]), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readClaimSources tolerates a missing or corrupt store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "claimcov-src-"));
  try {
    assert.deepEqual(await readClaimSources(dir, [{ id: "uc-1", cid: "sha256:aa" }]), {});
    await mkdir(join(dir, ".context", "commits"), { recursive: true });
    await writeFile(join(dir, ".context", "commits", "bad.json"), "{not json");
    assert.deepEqual(await readClaimSources(dir, [{ id: "uc-1", cid: "sha256:aa" }]), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readClaimSources needs no work when nothing was minted", async () => {
  assert.deepEqual(await readClaimSources("/nonexistent", []), {});
});
