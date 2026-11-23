#!/usr/bin/env node
/**
 * A stand-in for kane-cli, so the spawn path can be tested without credits or
 * a browser. It mimics the real stream: progress text mixed with NDJSON, and an
 * exit code that carries the outcome.
 *
 * Behaviour is driven by the argv it receives, the way the real CLI behaves:
 *
 *   no arguments                -> complete
 *   context extract             -> pauses once, then completes on --resume
 *   --resume <sid>              -> completes
 *   design tests                -> refuses with a recovery command
 *   --approve                   -> completes
 *   --hang                      -> never finishes
 *   --broken                    -> noise and a non-zero exit
 *   --nopause                   -> exit 3 with no pause payload
 */
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);

const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

process.stdout.write("reading readme (source 1 of 1)\n");
process.stdout.write("thinking\n");

if (has("--hang")) {
  setTimeout(() => {
    emit({ type: "done", v: 1, status: "complete", exit_code: 0 });
    process.exit(0);
  }, 5000);
} else if (has("--broken")) {
  process.stdout.write("{this is not json}\n");
  emit({ type: "done", v: 1, status: "failed", exit_code: 1 });
  process.exit(1);
} else if (has("--nopause")) {
  emit({ type: "done", v: 1, status: "complete", exit_code: 0 });
  process.exit(3);
} else if (argv[0] === "design" && !has("--allow-unreviewed")) {
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
} else if (argv[0] === "context" && argv[1] === "extract" && !has("--resume")) {
  // First pass: pause for one question, the way a real extraction does.
  emit({
    type: "session_paused",
    v: 1,
    sid: "ext-test-1",
    resume: "kane-cli context extract --resume ext-test-1 --mode agent",
    pending_questions: [
      {
        id: "q1",
        header: "missing start URL",
        text: "What is the browser entry URL for demo-app?",
        options: [{ label: "Fill start_url" }, { label: "Provide source" }],
        recommended_index: 0,
      },
    ],
  });
  emit({ type: "done", v: 1, status: "paused", exit_code: 3 });
  process.exit(3);
} else if (argv[0] === "cover") {
  emit({
    type: "coverage",
    v: 1,
    verb: "cover",
    pct: 50,
    note: null,
    perUc: [
      { id: "uc-1", title: "Create a task", state: "covered", pct: 100, criteria: 1, proven: 1 },
      { id: "uc-2", title: "Export to CSV", state: "failing", pct: 0, criteria: 1, proven: 0 },
    ],
  });
  emit({ type: "done", v: 1, status: "complete", exit_code: 0 });
  process.exit(0);
} else if (has("--resume") || has("--approve")) {
  emit({ type: "commit", v: 1, derived: 6 });
  emit({ type: "done", v: 1, status: "complete", exit_code: 0 });
  process.exit(0);
} else {
  emit({ type: "commit", v: 1, derived: 6 });
  emit({ type: "done", v: 1, status: "complete", exit_code: 0 });
  process.exit(0);
}
