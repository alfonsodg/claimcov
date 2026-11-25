/**
 * init — remember what a document verification needs.
 *
 * `claimcov verify` takes the document, the product URL and the tag values
 * every time. `init` writes them once into `<dir>/claimcov.json` so later
 * runs — and reviewers following the setup instructions — need no flags.
 * Explicit `verify()` options always win over the stored file.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Config file name, relative to the kane working directory. */
export const CONFIG_PATH = "claimcov.json";

/**
 * Store the verification inputs.
 *
 * @param {string} cwd  kane working directory
 * @param {object} cfg  `{doc, url, tagValues, extra}`
 */
export async function saveConfig(cwd, cfg = {}) {
  await mkdir(cwd, { recursive: true });
  const { doc, url, tagValues, extra } = cfg;
  await writeFile(
    join(cwd, CONFIG_PATH),
    `${JSON.stringify({ doc, url, tagValues, extra }, null, 2)}\n`,
    "utf8"
  );
}

/**
 * Read the stored inputs.
 *
 * @returns {Promise<object>} the config, or `{}` when absent or corrupt
 */
export async function loadConfig(cwd) {
  try {
    const raw = await readFile(join(cwd, CONFIG_PATH), "utf8");
    const cfg = JSON.parse(raw);
    return cfg && typeof cfg === "object" ? cfg : {};
  } catch {
    return {};
  }
}
