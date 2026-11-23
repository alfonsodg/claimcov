#!/usr/bin/env node
/**
 * A stand-in for kane-cli, so the spawn path can be tested without credits or
 * a browser. It mimics the real stream: progress text mixed with NDJSON, and an
 * exit code that carries the outcome.
 *
 * Usage: fake-kane.mjs <ok|refused|paused|broken|nopause|slow>
 */
const mode = process.argv[2] ?? "ok";

const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

process.stdout.write("reading readme (source 1 of 1)\n");
process.stdout.write("thinking\n");

if (mode === "ok") {
  emit({ type: "run_start", v: 1, verb: "extract", mode: "agent" });
  emit({ type: "commit", v: 1, derived: 6 });
  emit({ type: "done", v: 1, status: "complete", exit_code: 0 });
  process.exit(0);
}

if (mode === "refused") {
  emit({
    type: "error",
    v: 1,
    code: "UC_UNREVIEWED",
    message: "design: uc-5 is unreviewed",
    next: ["kane-cli context review --approve uc-5"],
  });
  emit({
    type: "done",
    v: 1,
    status: "refused",
    exit_code: 2,
    next: [{ cmd: "kane-cli context review --approve uc-5", why: "approve it first" }],
  });
  process.exit(2);
}

if (mode === "paused") {
  emit({
    type: "session_paused",
    v: 1,
    sid: "ext-test-1",
    resume: "kane-cli context extract --resume ext-test-1 --mode agent",
    pending_questions: [
      {
        id: "q1",
        header: "offline scope",
        options: [{ label: "Leave unspecified" }, { label: "All listed actions" }],
        recommended_index: 0,
      },
    ],
  });
  emit({ type: "done", v: 1, status: "paused", exit_code: 3 });
  process.exit(3);
}

if (mode === "nopause") {
  // Exit 3 with no pause payload: a protocol violation.
  emit({ type: "done", v: 1, status: "complete", exit_code: 0 });
  process.exit(3);
}

if (mode === "broken") {
  process.stdout.write("{this is not json}\n");
  emit({ type: "done", v: 1, status: "failed", exit_code: 1 });
  process.exit(1);
}

if (mode === "slow") {
  // Deliberately hangs so the caller's deadline can be exercised.
  setTimeout(() => {
    emit({ type: "done", v: 1, status: "complete", exit_code: 0 });
    process.exit(0);
  }, 5000);
} else {
  process.exit(1);
}
