import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planVariables, applyVariables, readVariables, VARIABLES_PATH } from "../src/variables.mjs";

/** Real assurance.json captured from a kane-cli 0.10.8 design run. */
const DECLARED = {
  start_url: {
    value: "",
    secret: false,
    description: "Browser URL of the Tasklist demo page.",
  },
  google_test_email: {
    value: "",
    secret: false,
    description: "Email address of an authorized Google test account for Tasklist sign-in.",
  },
  google_test_password: {
    value: "",
    secret: true,
    description: "Password for the authorized Google test account.",
  },
  tag_name: {
    value: "",
    secret: false,
    description: "Name of an available Tasklist tag used in the tag filter.",
  },
  other_tag_name: {
    value: "",
    secret: false,
    description: "An available Tasklist tag distinct from the existing tag_name variable.",
  },
};

test("fills the URL from the caller", () => {
  const { filled } = planVariables(DECLARED, { url: "https://demo.example/" });
  assert.equal(filled.start_url, "https://demo.example/");
});

test("gives tag variables distinct values", () => {
  const { filled } = planVariables(DECLARED, {
    url: "https://demo.example",
    tagValues: ["work", "home"],
  });
  assert.equal(filled.tag_name, "work");
  assert.notEqual(filled.other_tag_name, filled.tag_name);
});

test("never invents a secret", () => {
  const { filled, skipped } = planVariables(DECLARED, { url: "https://demo.example" });
  assert.equal(filled.google_test_password, undefined);
  assert.match(skipped.google_test_password, /secret/);
});

test("leaves an unknown variable unfilled rather than guessing", () => {
  const { filled, skipped } = planVariables(
    { mystery: { value: "", description: "Something unrelated entirely" } },
    { url: "https://demo.example" }
  );
  assert.equal(filled.mystery, undefined);
  assert.match(skipped.mystery, /no value/);
});

test("an explicit extra value wins", () => {
  const { filled } = planVariables(
    { google_test_email: { value: "", description: "Email address of a test account" } },
    { extra: { google_test_email: "qa@example.test" } }
  );
  assert.equal(filled.google_test_email, "qa@example.test");
});

test("no URL means the URL variable stays empty", () => {
  const { filled } = planVariables(DECLARED, {});
  assert.equal(filled.start_url, undefined);
});

test("handles an empty declaration map", () => {
  assert.deepEqual(planVariables({}, { url: "https://x" }).filled, {});
  assert.deepEqual(planVariables(null, {}).filled, {});
});

test("applyVariables writes the values into the kane file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "claimcov-vars-"));
  try {
    await mkdir(join(dir, ".testmuai", "variables"), { recursive: true });
    await writeFile(join(dir, VARIABLES_PATH), JSON.stringify(DECLARED, null, 2));

    const plan = await applyVariables(dir, { url: "https://demo.example/", tagValues: ["work", "home"] });
    assert.equal(plan.filled.start_url, "https://demo.example/");

    const after = await readVariables(dir);
    assert.equal(after.start_url.value, "https://demo.example/");
    assert.equal(after.tag_name.value, "work");
    assert.equal(after.google_test_password.value, "", "a secret must stay empty");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("applyVariables reports when no variables were declared", async () => {
  const dir = await mkdtemp(join(tmpdir(), "claimcov-vars-"));
  try {
    const plan = await applyVariables(dir, { url: "https://demo.example" });
    assert.deepEqual(plan.filled, {});
    assert.ok(Object.keys(plan.skipped).length > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readVariables tolerates a missing or corrupt file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "claimcov-vars-"));
  try {
    assert.equal(await readVariables(dir), null);

    await mkdir(join(dir, ".testmuai", "variables"), { recursive: true });
    await writeFile(join(dir, VARIABLES_PATH), "{not json");
    assert.equal(await readVariables(dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
