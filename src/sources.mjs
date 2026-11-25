/**
 * sources — where in the document each claim comes from.
 *
 * The NDJSON stream names use-cases (`minted: [{cid, logical_id}]`) but never
 * the lines they came from. The line citations live in Kane's local store:
 * the extract commit's DERIVES edges carry `props.anchor` (e.g. "L16-L16"),
 * `props.quote` and `props.source_id`. This module joins the stream's minted
 * cids to those edges. Verified against store files written by kane-cli 0.10.8.
 *
 * Everything here is best-effort: a missing, corrupt or citation-free store
 * yields an empty map, never a failure. A claim without a line is reported
 * with `line: null`, not with an invented one.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Read the first line of an anchor.
 *
 * @param {string} anchor e.g. "L16-L16"
 * @returns {number|null} the starting line, or null when it is not an anchor
 */
export function parseAnchor(anchor) {
  if (typeof anchor !== "string") return null;
  const m = /^L(\d+)(?:-L?\d+)?$/.exec(anchor.trim());
  return m ? Number(m[1]) : null;
}

/**
 * Map logical use-case ids to their source lines.
 *
 * @param {string} cwd  kane-cli working directory, holding `.context`
 * @param {Array<{id:string, cid:string}>} minted  from the extract commit event
 * @returns {Promise<object>} `{ucId: {line, quote, source}}`, possibly empty
 */
export async function readClaimSources(cwd, minted = []) {
  const wanted = new Map(
    (minted ?? []).filter((m) => m?.cid).map((m) => [m.cid, m.id])
  );
  if (!wanted.size) return {};

  let files;
  try {
    files = await readdir(join(cwd, ".context", "commits"));
  } catch {
    return {};
  }

  const out = {};
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    let commit;
    try {
      commit = JSON.parse(await readFile(join(cwd, ".context", "commits", file), "utf8"));
    } catch {
      continue;
    }
    if (!commit || typeof commit !== "object") continue;

    const nodes = new Set(
      (commit.nodes ?? [])
        .filter((n) => n && typeof n === "object")
        .map((n) => n.cid)
    );
    for (const edge of commit.edges ?? []) {
      if (edge?.type !== "DERIVES" || !nodes.has(edge.dst) || !wanted.has(edge.dst)) {
        continue;
      }
      const id = wanted.get(edge.dst);
      if (out[id]) continue;
      out[id] = {
        line: parseAnchor(edge.props?.anchor),
        quote: typeof edge.props?.quote === "string" ? edge.props.quote : null,
        source: typeof edge.props?.source_id === "string" ? edge.props.source_id : null,
      };
    }
    if (Object.keys(out).length >= wanted.size) break;
  }
  return out;
}
