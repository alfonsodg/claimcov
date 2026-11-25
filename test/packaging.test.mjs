import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

test("the package main entry exists and loads the public surface", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const main = resolve(root, pkg.main);
  assert.ok(existsSync(main), `${pkg.main} must exist`);

  const mod = await import(main);
  for (const name of [
    "verify",
    "buildReport",
    "buildGaps",
    "runUntilDone",
    "exitCodeFor",
    "summarise",
  ]) {
    assert.equal(typeof mod[name], "function", `${name} is exported`);
  }
});
