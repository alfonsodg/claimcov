import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEvent, classify, EXIT, OUTCOME } from "../src/kane.mjs";

/** Fixtures are real events captured from kane-cli 0.10.8. */

const DONE_OK = { type: "done", v: 1, verb: "extract", status: "complete", exit_code: 0 };
const DONE_REFUSED = {
  type: "done",
  v: 1,
  verb: "design",
  status: "refused",
  exit_code: 2,
  next: [
    { cmd: "kane-cli context review --approve uc-5", why: "approve it first" },
    { cmd: "kane-cli design tests --use-case uc-5 --mode agent --allow-unreviewed", why: "or skip" },
  ],
};
const ERROR_UNREVIEWED = {
  type: "error",
  v: 1,
  verb: "design",
  code: "UC_UNREVIEWED",
  message: "design: uc-5 is unreviewed — approve it first, or pass --allow-unreviewed",
};
const PAUSED = {
  type: "session_paused",
  v: 1,
  verb: "extract",
  sid: "ext-20261123T114116-3d721eb6-readme",
  source_id: "readme",
  mode: "agent",
  resume: "kane-cli context extract --resume ext-20261123T114116-3d721eb6-readme --mode agent",
  expires_at: "2026-11-24T11:41:16.714Z",
  pending_questions: [
    {
      id: "q1",
      header: "offline scope",
      text: "Which task actions does \u201cWorks offline as a PWA\u201d cover?",
      risk: "med",
      options: [
        { label: "Leave unspecified", detail: "..." },
        { label: "All listed actions", detail: "..." },
        { label: "Read and filter only", detail: "..." },
      ],
      recommended_index: 0,
      allow_free_text: true,
    },
  ],
};

test("parses a JSON line and ignores progress text", () => {
  assert.deepEqual(parseEvent('{"type":"done","status":"complete"}'), {
    type: "done",
    status: "complete",
  });
  assert.equal(parseEvent("reading readme (source 1 of 1)"), null);
  assert.equal(parseEvent(""), null);
  assert.equal(parseEvent("{not json}"), null);
});

test("exit 0 is complete", () => {
  const r = classify([DONE_OK], EXIT.OK);
  assert.equal(r.outcome, OUTCOME.COMPLETE);
  assert.equal(r.code, 0);
});

test("exit 2 is refused and carries the next commands", () => {
  const r = classify([ERROR_UNREVIEWED, DONE_REFUSED], EXIT.REFUSED);
  assert.equal(r.outcome, OUTCOME.REFUSED);
  assert.equal(r.code_name, "UC_UNREVIEWED");
  assert.equal(r.next.length, 2);
  assert.match(r.next[0].cmd, /context review --approve/);
});

test("exit 3 is paused and exposes the session and questions", () => {
  const r = classify([PAUSED, { type: "done", status: "paused", exit_code: 3 }], EXIT.PAUSED);
  assert.equal(r.outcome, OUTCOME.PAUSED);
  assert.equal(r.session, "ext-20261123T114116-3d721eb6-readme");
  assert.equal(r.questions.length, 1);
  assert.equal(r.questions[0].id, "q1");
  assert.match(r.resume, /--resume ext-20261123T114116/);
});

test("exit 3 without a pause payload is a failure, not a success", () => {
  const r = classify([DONE_OK], EXIT.PAUSED);
  assert.equal(r.outcome, OUTCOME.FAILED);
  assert.match(r.error, /exit 3 without a session_paused/);
});

test("a pause wins over a refused error in the same stream", () => {
  const r = classify([ERROR_UNREVIEWED, PAUSED], EXIT.PAUSED);
  assert.equal(r.outcome, OUTCOME.PAUSED);
});

test("unknown non-zero code is a failure", () => {
  const r = classify([], 1);
  assert.equal(r.outcome, OUTCOME.FAILED);
  assert.equal(r.code, 1);
});

test("classify tolerates an empty stream", () => {
  assert.equal(classify([], 0).outcome, OUTCOME.COMPLETE);
});
