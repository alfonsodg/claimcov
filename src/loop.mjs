/**
 * loop — run a kane-cli command until it stops asking questions.
 *
 * This is the piece that makes the tool more than a wrapper. Kane pauses when it
 * needs a decision, and every pause carries a recommended option, so most of the
 * time the loop can answer for itself.
 *
 * The one case it must not guess is the product URL: answering "leave
 * unspecified" produces tests that can never run. When the caller supplies a
 * URL, any question about the start URL is answered with it verbatim as free
 * text rather than with a numbered option.
 */
import { runKane, OUTCOME } from "./kane.mjs";
import { resumeArgv, answerOption, describePause } from "./resume.mjs";

/** Matches the questions kane-cli asks when it has no entry URL. */
const URL_QUESTION = /start[\s_-]?url|entry url|product url|browser url/i;

/**
 * Decide which questions get a value supplied by the caller instead of the
 * recommendation.
 *
 * @param {Array<object>} questions `pending_questions`
 * @param {object} [opts]
 * @param {string} [opts.url] the product URL to answer with
 * @returns {object} map of question id to answer
 */
export function overridesFor(questions, opts = {}) {
  const overrides = {};
  const url = opts.url;
  if (!url) return overrides;

  for (const q of questions ?? []) {
    const text = [q?.header, q?.text, q?.prompt].filter(Boolean).join(" ");
    if (URL_QUESTION.test(text)) {
      overrides[q.id] = url;
    }
  }
  return overrides;
}

/**
 * Run until the command completes, refusing, or exhausting its resume budget.
 *
 * @param {string[]} argv
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {string} [opts.url]      answer start-URL questions with this
 * @param {number} [opts.maxResumes] default 6
 * @param {(step:object)=>void} [opts.onStep]
 * @param {(e:object)=>void} [opts.onEvent]
 * @returns {Promise<object>} the final classified run, plus `resumes`
 */
export async function runUntilDone(argv, opts = {}) {
  const { cwd, url, maxResumes = 6, onStep, onEvent, timeoutMs, bin, prefix = [] } = opts;

  // `prefix` exists for the test stub, whose script path has to survive a
  // resume rebuild. In production it is empty and bin is `kane-cli`.
  const call = (a) => runKane([...prefix, ...a], { cwd, onEvent, timeoutMs, bin });

  let run = await call(argv);
  let resumes = 0;

  while (run.outcome === OUTCOME.PAUSED && resumes < maxResumes) {
    const overrides = overridesFor(run.questions, { url });
    const next = resumeArgv(run, { overrides });

    if (!next.length) {
      onStep?.({
        step: "resume",
        outcome: "unusable",
        detail: "pause carried no resume command",
        questions: run.questions.map((q) => q.id),
      });
      break;
    }

    onStep?.({
      step: "resume",
      outcome: "answering",
      detail: describePause(run),
      answered: Object.keys(overrides),
      questions: run.questions.map((q) => ({ id: q.id, chosen: answerOption(q) })),
    });

    resumes++;
    run = await call(next);
  }

  if (run.outcome === OUTCOME.REFUSED) {
    onStep?.({
      step: "refused",
      outcome: "refused",
      detail: run.error ?? run.code_name ?? "refused",
      next: (run.next ?? []).map((n) => n.cmd),
    });
  }

  return { ...run, resumes };
}

/**
 * Follow the recovery command kane-cli prints for a refusal, then retry once.
 *
 * A refusal is not a dead end: `design tests` on an unreviewed use-case prints
 * `context review --approve <uc>`. Doing what it says and retrying is the whole
 * recovery path.
 *
 * @param {string[]} argv           the command that was refused
 * @param {object} refused          the refused run
 * @param {object} [opts]           same options as runUntilDone
 */
export async function recoverAndRetry(argv, refused, opts = {}) {
  const { cwd, bin, prefix = [], timeoutMs, onStep } = opts;
  const recovery = (refused.next ?? []).find((n) =>
    /context review --approve/.test(n.cmd ?? "")
  );

  if (!recovery) return null;

  const recoveryArgv = recovery.cmd.replace(/^kane-cli\s+/, "").split(/\s+/);
  const fixed = await runKane([...prefix, ...recoveryArgv], { cwd, bin, timeoutMs });

  onStep?.({
    step: "recover",
    outcome: fixed.outcome,
    detail: recovery.cmd,
  });

  if (fixed.outcome !== OUTCOME.COMPLETE) return null;

  return runUntilDone(argv, opts);
}
