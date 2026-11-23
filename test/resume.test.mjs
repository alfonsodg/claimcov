import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commandToArgv,
  answerOption,
  answerFlags,
  resumeArgv,
  describePause,
} from "../src/resume.mjs";

/** Real pause payload captured from kane-cli 0.10.8. */
const PAUSED = {
  outcome: "paused",
  session: "ext-20261123T114116-3d721eb6-readme",
  resume: "kane-cli context extract --resume ext-20261123T114116-3d721eb6-readme --mode agent",
  questions: [
    {
      id: "q1",
      header: "offline scope",
      options: [
        { label: "Leave unspecified" },
        { label: "All listed actions" },
        { label: "Read and filter only" },
      ],
      recommended_index: 0,
    },
  ],
};

test("splits a command string into argv without the binary", () => {
  assert.deepEqual(commandToArgv(PAUSED.resume), [
    "context",
    "extract",
    "--resume",
    "ext-20261123T114116-3d721eb6-readme",
    "--mode",
    "agent",
  ]);
});

test("commandToArgv handles quoted arguments and empty input", () => {
  assert.deepEqual(commandToArgv('kane-cli run "go to example.com"'), [
    "run",
    "go to example.com",
  ]);
  assert.deepEqual(commandToArgv(""), []);
  assert.deepEqual(commandToArgv(null), []);
});

test("recommended_index is 0-based but --answer is 1-based", () => {
  // This is the off-by-one that silently answers the wrong option.
  assert.equal(answerOption(PAUSED.questions[0]), 1);
  assert.equal(answerOption({ options: [{}, {}], recommended_index: 1 }), 2);
});

test("answerOption falls back to the first option when the index is invalid", () => {
  assert.equal(answerOption({ options: [{}, {}] }), 1);
  assert.equal(answerOption({ options: [{}, {}], recommended_index: 9 }), 1);
  assert.equal(answerOption({ options: [] }), null);
  assert.equal(answerOption(null), null);
});

test("builds answer flags from the recommendation", () => {
  assert.deepEqual(answerFlags(PAUSED.questions), ["q1=1"]);
});

test("an override wins over the recommendation", () => {
  assert.deepEqual(answerFlags(PAUSED.questions, { q1: 3 }), ["q1=3"]);
  assert.deepEqual(answerFlags(PAUSED.questions, { q1: "free text" }), ["q1=free text"]);
});

test("resumeArgv produces the exact command the CLI printed", () => {
  assert.deepEqual(resumeArgv(PAUSED), [
    "context",
    "extract",
    "--resume",
    "ext-20261123T114116-3d721eb6-readme",
    "--mode",
    "agent",
    "--answer",
    "q1=1",
  ]);
});

test("resumeArgv appends extra arguments", () => {
  const argv = resumeArgv(PAUSED, { extra: ["--force"] });
  assert.equal(argv.at(-1), "--force");
});

test("resumeArgv returns nothing usable when the pause has no resume command", () => {
  assert.deepEqual(resumeArgv({ questions: [] }), []);
  assert.deepEqual(resumeArgv(null), []);
});

test("handles multiple questions", () => {
  const paused = {
    resume: "kane-cli context extract --resume s1 --mode agent",
    questions: [
      { id: "q1", options: [{}, {}], recommended_index: 1 },
      { id: "q2", options: [{}, {}, {}], recommended_index: 2 },
    ],
  };
  assert.deepEqual(answerFlags(paused.questions), ["q1=2", "q2=3"]);
});

test("describePause names the chosen option", () => {
  assert.match(describePause(PAUSED), /q1: offline scope .* Leave unspecified/);
  assert.equal(describePause({ questions: [] }), "paused with no questions");
});
