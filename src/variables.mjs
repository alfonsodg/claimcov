/**
 * variables — fill in the values Kane declared for a design.
 *
 * `design tests` declares the variables its tests need and leaves every value
 * empty. A test full of `{{start_url}}` can never pass, and Kane reports it as a
 * plain failure rather than as a missing input, so the cause is easy to miss.
 *
 * Filling them is the caller's job, and this module is the caller.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

/** Where kane-cli keeps declared variables, relative to its working directory. */
export const VARIABLES_PATH = join(".testmuai", "variables", "assurance.json");

/**
 * Read the declared variables.
 *
 * @returns {Promise<object|null>} the map, or null when nothing was declared
 */
export async function readVariables(cwd) {
  const path = join(cwd, VARIABLES_PATH);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Choose a value for each declared variable from what the caller knows.
 *
 * The heuristics are deliberately conservative: a variable is only filled when
 * the answer is unambiguous from its name and description. A credential is left
 * empty on purpose, because inventing one would make a later failure misleading.
 * Tag values are never invented either: they come from `opts.tagValues` (or an
 * explicit `opts.extra` entry), and without them tag-like variables are
 * reported as skipped so the operator can supply `--tag-values`.
 *
 * @param {object} declared  the map read from assurance.json
 * @param {object} [opts]
 * @param {string} [opts.url]          the product URL
 * @param {string[]} [opts.tagValues]  tag names to hand out; distinct values go
 *                                     to plain tags first, then to other-tags,
 *                                     so the result never depends on the order
 *                                     Kane declared them in
 * @returns {{filled:object, skipped:object}}
 */
export function planVariables(declared, opts = {}) {
  const { url, tagValues = [], extra = {} } = opts;
  const filled = {};
  const skipped = {};

  const text = (v) => `${v?.description ?? ""} ${v?.value ?? ""}`.toLowerCase();

  // Tag-like variables are collected first and assigned second, so two runs
  // over the same declarations always agree however Kane ordered them.
  const tagEntries = [];

  for (const [name, def] of Object.entries(declared ?? {})) {
    if (def?.secret) {
      skipped[name] = "secret: needs a real credential from the operator";
      continue;
    }

    const hint = `${name} ${text(def)}`.toLowerCase();

    if (url && /url|address|page/.test(hint)) {
      filled[name] = url;
      continue;
    }

    const given = extra[name];
    if (given !== undefined) {
      filled[name] = given;
      continue;
    }

    if (/tag/.test(hint)) {
      tagEntries.push({ name, other: /other.*tag|tag.*other|distinct.*tag/.test(hint) });
      continue;
    }

    skipped[name] = "no value could be inferred";
  }

  // Plain tags first, then other-tags: every variable gets a value nobody else
  // holds while values last, so a filter test can tell the tags apart.
  const used = new Set();
  const takeDistinct = () => tagValues.find((v) => !used.has(v));
  for (const entry of [...tagEntries.filter((e) => !e.other), ...tagEntries.filter((e) => e.other)]) {
    const value = takeDistinct() ?? tagValues[tagValues.length - 1];
    if (value === undefined) {
      skipped[entry.name] = "no tag value supplied: pass --tag-values";
      continue;
    }
    filled[entry.name] = value;
    used.add(value);
  }

  return { filled, skipped };
}

/**
 * Apply values to the declared variables and write the file back.
 *
 * @returns {Promise<{filled:object, skipped:object}>}
 */
export async function applyVariables(cwd, opts = {}) {
  const declared = await readVariables(cwd);
  if (!declared) return { filled: {}, skipped: { "": "no variables were declared" } };

  const plan = planVariables(declared, opts);
  for (const [name, value] of Object.entries(plan.filled)) {
    if (declared[name]) declared[name].value = value;
  }

  await writeFile(join(cwd, VARIABLES_PATH), `${JSON.stringify(declared, null, 2)}\n`, "utf8");
  return plan;
}
