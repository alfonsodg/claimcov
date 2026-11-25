/**
 * report — turn Kane's coverage output into a claim report.
 *
 * Kane answers a different question than the one this tool asks. `cover` reports
 * per acceptance criterion; `claimcov` reports per claim published in the
 * document. The mapping is one use-case to one claim, because that is how the
 * extraction built them: each use-case came from a line of the document.
 *
 * The vocabulary also differs. Kane says `covered`, `partial`, `blocked`. A
 * reader of a README wants to know whether the promise is true, false, or
 * unproven. The conversion is explicit here rather than spread through callers.
 */

/** How a claim ended up. */
export const CLAIM = {
  PROVEN: "proven",
  FALSE: "false",
  PARTIAL: "partial",
  BLOCKED: "blocked",
  OWED: "owed",
};

/**
 * Kane's per-use-case state to a claim status.
 *
 * `failing` and `failed` both appear across versions; both mean the run proved
 * the claim wrong, which is the only status that makes the tool exit non-zero.
 * Anything unrecognised is treated as owed, never as proven — a new state must
 * not silently pass.
 */
const STATE_TO_STATUS = {
  covered: CLAIM.PROVEN,
  failing: CLAIM.FALSE,
  failed: CLAIM.FALSE,
  partial: CLAIM.PARTIAL,
  blocked: CLAIM.BLOCKED,
  uncovered: CLAIM.OWED,
  not_run: CLAIM.OWED,
  no_criteria: CLAIM.OWED,
  undesigned: CLAIM.OWED,
};

/**
 * Map one use-case entry from `cover --json` to a claim.
 *
 * @param {object} uc a `perUc` entry
 * @returns {object} a claim
 */
export function toClaim(uc, src = {}) {
  const status = STATE_TO_STATUS[uc?.state] ?? CLAIM.OWED;
  return {
    id: uc?.id ?? "unknown",
    title: uc?.title ?? uc?.id ?? "untitled",
    risk: uc?.risk ?? "unknown",
    state: uc?.state ?? "unknown",
    status,
    criteria: uc?.criteria ?? 0,
    proven: uc?.proven ?? 0,
    pct: typeof uc?.pct === "number" ? uc.pct : 0,
    stale: uc?.stale === true,
    line: Number.isInteger(src?.line) ? src.line : null,
    source: typeof src?.source === "string" ? src.source : null,
    quote: typeof src?.quote === "string" ? src.quote : null,
  };
}

/**
 * Find the coverage event in a run.
 *
 * Kane emits `{"type":"coverage",...}`; the run wrapper also keeps every event,
 * so callers can pass either the events array or the classified run.
 */
export function coverageEvent(events) {
  const list = Array.isArray(events) ? events : (events?.events ?? []);
  return [...list].reverse().find((e) => e?.type === "coverage") ?? null;
}

/**
 * Find the pending-work event in a run.
 *
 * `cover gaps --json` emits the gaps payload; like `coverageEvent` this
 * accepts either the events array or the classified run. Events that only
 * carry `usecases`/`other` arrays (no explicit type) are accepted too, so a
 * future CLI version that renames the type does not silently drop the gaps.
 */
export function gapsEvent(events) {
  const list = Array.isArray(events) ? events : (events?.events ?? []);
  return (
    [...list].reverse().find(
      (e) =>
        e?.type === "gaps" ||
        (e && typeof e === "object" && (Array.isArray(e.usecases) || Array.isArray(e.other)))
    ) ?? null
  );
}

/**
 * Build the claim report from a coverage event.
 *
 * @param {object} coverage the `coverage` event from `cover --json`
 * @param {object} [sources] `{ucId: {line, quote, source}}` from the store
 * @returns {{summary:object, claims:object[]}|null}
 */
export function buildReport(coverage, sources = {}) {
  if (!coverage || !Array.isArray(coverage.perUc)) return null;

  const claims = coverage.perUc.map((uc) => toClaim(uc, sources?.[uc?.id]));

  const count = (status) => claims.filter((c) => c.status === status).length;
  const proven = count(CLAIM.PROVEN);
  const falsy = count(CLAIM.FALSE);
  const partial = count(CLAIM.PARTIAL);
  const blocked = count(CLAIM.BLOCKED);
  const owed = count(CLAIM.OWED);
  const total = claims.length;

  return {
    summary: {
      // Kane's own risk-weighted percentage, kept as the headline number so the
      // tool and the CLI cannot disagree about what the score is.
      pct: typeof coverage.pct === "number" ? coverage.pct : 0,
      total,
      proven,
      false: falsy,
      partial,
      blocked,
      owed,
      note: coverage.note,
      // A run where every claim is proven is the only clean pass.
      allProven: total > 0 && proven === total,
      hasFalseClaims: falsy > 0,
    },
    claims: claims.sort((a, b) => {
      // False claims first: they are the only thing that needs action.
      const order = { false: 0, partial: 1, blocked: 2, owed: 3, proven: 4 };
      const d = (order[a.status] ?? 9) - (order[b.status] ?? 9);
      return d !== 0 ? d : a.id.localeCompare(b.id);
    }),
  };
}

/**
 * Pull the gaps, which are the work still owed rather than claims that failed.
 * Kept separate because "we could not test this" and "this is untrue" are
 * different problems for whoever has to fix it.
 */
export function buildGaps(gapsEvent) {
  if (!gapsEvent) return [];
  const out = [];

  for (const uc of gapsEvent.usecases ?? []) {
    for (const p of uc.pending ?? []) {
      out.push({
        ref: p.ref ?? uc.id,
        claim: uc.title ?? uc.id,
        kind: p.kind,
        why: p.why,
        risk: p.risk,
        stage: p.stage,
        command: p.ready_command,
      });
    }
  }

  for (const g of gapsEvent.other ?? []) {
    out.push({
      ref: g.ref,
      claim: null,
      kind: g.kind,
      why: g.why,
      risk: g.risk,
      stage: g.stage,
      command: g.ready_command,
      question: g.question?.prompt,
    });
  }

  return out;
}

/**
 * A one-line verdict, for a log or the top of a report.
 */
export function summarise(report) {
  if (!report) return "no coverage data";

  const { summary } = report;
  if (summary.total === 0) return "no claims found in the document";

  const parts = [`${summary.proven}/${summary.total} claims proven`];
  if (summary.false > 0) parts.push(`${summary.false} false`);
  if (summary.owed > 0) parts.push(`${summary.owed} unproven`);
  if (summary.blocked > 0) parts.push(`${summary.blocked} blocked`);
  if (summary.partial > 0) parts.push(`${summary.partial} partial`);

  return `${parts.join(" · ")} (${Math.round(summary.pct)}%)`;
}

/**
 * Exit code for a report.
 *
 * Non-zero only when a claim is proven false. Unproven claims are reported but
 * do not fail a build: the document may describe work that is legitimately not
 * testable yet. A false claim is a defect.
 */
export function exitCodeFor(report) {
  if (!report) return 1;
  return report.summary.hasFalseClaims ? 1 : 0;
}
