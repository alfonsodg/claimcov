import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toClaim,
  coverageEvent,
  gapsEvent,
  buildReport,
  buildGaps,
  summarise,
  exitCodeFor,
  CLAIM,
} from "../src/report.mjs";

/** Real `cover --json` shape captured from kane-cli 0.10.8. */
const COVERAGE = {
  type: "coverage",
  v: 1,
  verb: "cover",
  source: "project",
  coverage_version: 2,
  scope: "project",
  config: { weighting: "risk", weights: { high: 1.25, med: 1, low: 0.75 } },
  pct: 0,
  note: "nothing_run_yet",
  usecases: { total: 3, proven: 0, partial: 0, failing: 0, not_run: 1, no_criteria: 2 },
  criteria: { total: 2, proven: 0 },
  perUc: [
    {
      id: "uc-1",
      title: "Sign in with Google",
      risk: "high",
      weight: 1.25,
      state: "no_criteria",
      pct: 0,
      criteria: 0,
      proven: 0,
      stale: false,
    },
    {
      id: "uc-2",
      title: "Export all tasks to CSV",
      risk: "low",
      weight: 0.75,
      state: "not_run",
      pct: 0,
      criteria: 2,
      proven: 0,
      stale: false,
    },
    {
      id: "uc-3",
      title: "Works offline as a PWA",
      risk: "med",
      weight: 1,
      state: "covered",
      pct: 100,
      criteria: 1,
      proven: 1,
      stale: false,
    },
  ],
};

test("maps Kane states to claim statuses", () => {
  assert.equal(toClaim({ state: "covered" }).status, CLAIM.PROVEN);
  assert.equal(toClaim({ state: "failing" }).status, CLAIM.FALSE);
  assert.equal(toClaim({ state: "failed" }).status, CLAIM.FALSE);
  assert.equal(toClaim({ state: "partial" }).status, CLAIM.PARTIAL);
  assert.equal(toClaim({ state: "blocked" }).status, CLAIM.BLOCKED);
  assert.equal(toClaim({ state: "not_run" }).status, CLAIM.OWED);
  assert.equal(toClaim({ state: "no_criteria" }).status, CLAIM.OWED);
});

test("an unknown state is owed, never proven", () => {
  // A new state must not silently pass the build.
  assert.equal(toClaim({ state: "something-new" }).status, CLAIM.OWED);
  assert.equal(toClaim({}).status, CLAIM.OWED);
});

test("keeps the title, risk and stale flag from the use-case", () => {
  const c = toClaim(COVERAGE.perUc[1]);
  assert.equal(c.title, "Export all tasks to CSV");
  assert.equal(c.risk, "low");
  assert.equal(c.criteria, 2);
  assert.equal(c.stale, false);
});

test("finds the coverage event among other events", () => {
  const events = [{ type: "run_start" }, COVERAGE, { type: "done" }];
  assert.equal(coverageEvent(events), COVERAGE);
  assert.equal(coverageEvent({ events }), COVERAGE);
  assert.equal(coverageEvent([{ type: "done" }]), null);
});

test("builds a report with one claim per use-case", () => {
  const r = buildReport(COVERAGE);
  assert.equal(r.claims.length, 3);
  assert.equal(r.summary.total, 3);
  assert.equal(r.summary.proven, 1);
  assert.equal(r.summary.owed, 2);
  assert.equal(r.summary.false, 0);
  assert.equal(r.summary.allProven, false);
});

test("keeps Kane's own percentage as the headline number", () => {
  assert.equal(buildReport(COVERAGE).summary.pct, 0);
  assert.equal(buildReport({ ...COVERAGE, pct: 62.5 }).summary.pct, 62.5);
});

test("sorts false claims first, proven last", () => {
  const mixed = {
    pct: 33,
    perUc: [
      { id: "a", title: "proven one", state: "covered" },
      { id: "b", title: "false one", state: "failing" },
      { id: "c", title: "owed one", state: "not_run" },
      { id: "d", title: "partial one", state: "partial" },
    ],
  };
  const order = buildReport(mixed).claims.map((c) => c.status);
  assert.deepEqual(order, ["false", "partial", "owed", "proven"]);
});

test("allProven only when every claim is proven", () => {
  const all = {
    pct: 100,
    perUc: [
      { id: "a", title: "one", state: "covered" },
      { id: "b", title: "two", state: "covered" },
    ],
  };
  assert.equal(buildReport(all).summary.allProven, true);
  assert.equal(buildReport({ pct: 0, perUc: [] }).summary.allProven, false);
});

test("buildReport returns null without perUc", () => {
  assert.equal(buildReport(null), null);
  assert.equal(buildReport({}), null);
});

test("toClaim carries the source line when the store cited one", () => {
  const c = toClaim(
    { id: "uc-1", title: "Sign in", state: "failing" },
    { line: 16, quote: "- Sign in with Google", source: "readme" }
  );
  assert.equal(c.line, 16);
  assert.equal(c.source, "readme");
  assert.equal(c.quote, "- Sign in with Google");
});

test("toClaim leaves the line empty when nothing cited it", () => {
  const c = toClaim({ id: "uc-1", state: "covered" });
  assert.equal(c.line, null);
  assert.equal(c.source, null);
  assert.equal(c.quote, null);
});

test("buildReport merges the store citations into claims", () => {
  const r = buildReport(COVERAGE, { "uc-1": { line: 16, quote: "q", source: "readme" } });
  assert.equal(r.claims.find((c) => c.id === "uc-1").line, 16);
  assert.equal(r.claims.find((c) => c.id === "uc-2").line, null);
});

test("buildGaps collects pending work and other gaps", () => {
  const gaps = {
    usecases: [
      {
        id: "uc-1",
        title: "Sign in",
        pending: [
          {
            ref: "uc-1",
            kind: "zero-scenario",
            why: "use-case has no scenarios",
            risk: "high",
            stage: "design",
            ready_command: "kane-cli design tests --use-case uc-1",
          },
        ],
      },
    ],
    other: [
      {
        ref: "gap-1",
        kind: "incomplete",
        why: "missing start URL",
        risk: "high",
        stage: "design",
        ready_command: "kane-cli design explain gap-1",
        question: { prompt: "What is the browser entry URL?" },
      },
    ],
  };
  const out = buildGaps(gaps);
  assert.equal(out.length, 2);
  assert.equal(out[0].claim, "Sign in");
  assert.match(out[0].command, /design tests/);
  assert.equal(out[1].claim, null);
  assert.match(out[1].question, /entry URL/);
});

test("buildGaps tolerates a missing event", () => {
  assert.deepEqual(buildGaps(null), []);
  assert.deepEqual(buildGaps({}), []);
});

test("gapsEvent finds the pending-work event", () => {
  const gaps = { type: "gaps", usecases: [], other: [] };
  assert.equal(gapsEvent([COVERAGE, gaps]), gaps);
  assert.equal(gapsEvent({ events: [gaps] }), gaps);
});

test("gapsEvent never mistakes the coverage event for gaps", () => {
  assert.equal(gapsEvent([COVERAGE]), null, "coverage carries usecases as an object, not an array");
  assert.equal(gapsEvent([]), null);
  assert.equal(gapsEvent(null), null);
});

test("summarise is a one-liner that names what is wrong", () => {
  const r = buildReport(COVERAGE);
  const line = summarise(r);
  assert.match(line, /1\/3 claims proven/);
  assert.match(line, /2 unproven/);
  assert.equal(summarise(null), "no coverage data");
  assert.equal(summarise({ summary: { total: 0 } }), "no claims found in the document");
});

test("exit code is non-zero only when a claim is false", () => {
  assert.equal(exitCodeFor(buildReport(COVERAGE)), 0, "unproven claims do not fail");

  const withFalse = {
    pct: 50,
    perUc: [
      { id: "a", title: "ok", state: "covered" },
      { id: "b", title: "lie", state: "failing" },
    ],
  };
  assert.equal(exitCodeFor(buildReport(withFalse)), 1);
  assert.equal(exitCodeFor(null), 1);
});
