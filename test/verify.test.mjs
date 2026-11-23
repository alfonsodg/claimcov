import { test } from "node:test";
import assert from "node:assert/strict";
import { useCaseIds } from "../src/verify.mjs";

/** Real `commit` events captured from kane-cli 0.10.8. */
const EXTRACT_COMMIT = {
  type: "commit",
  v: 1,
  verb: "extract",
  source_id: "readme",
  derived: 2,
  minted: [
    { cid: "sha256:aa", logical_id: "uc-1" },
    { cid: "sha256:bb", logical_id: "uc-2" },
  ],
};

const DESIGN_COMMIT = {
  type: "commit",
  v: 1,
  verb: "design",
  acs: 0,
  tests: 3,
  minted: [
    { temp_ref: "g1", cid: "sha256:cc", logical_id: "gap-1" },
    { temp_ref: "t1", cid: "sha256:dd", logical_id: "t-1" },
  ],
};

test("collects use-case ids from the extract commit", () => {
  assert.deepEqual(useCaseIds([EXTRACT_COMMIT]), ["uc-1", "uc-2"]);
});

test("ignores ids from the design commit", () => {
  // gap-1 and t-1 are not use-cases; designing them would fail.
  assert.deepEqual(useCaseIds([EXTRACT_COMMIT, DESIGN_COMMIT]), ["uc-1", "uc-2"]);
});

test("deduplicates when several commits mint the same id", () => {
  assert.deepEqual(useCaseIds([EXTRACT_COMMIT, EXTRACT_COMMIT]), ["uc-1", "uc-2"]);
});

test("tolerates empty and malformed streams", () => {
  assert.deepEqual(useCaseIds([]), []);
  assert.deepEqual(useCaseIds(null), []);
  assert.deepEqual(useCaseIds([{ type: "commit" }]), []);
  assert.deepEqual(useCaseIds([{ type: "commit", minted: [{ logical_id: null }] }]), []);
});
