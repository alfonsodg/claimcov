/**
 * resume — answer a paused kane-cli session and continue it.
 *
 * When a run pauses it hands back everything needed to continue: the session id,
 * a ready-made resume command, and the questions it needs answered. The
 * recommended option is included, which is what lets an agent close the loop
 * without a human.
 *
 * Verified against kane-cli 0.10.8: `recommended_index` is 0-based, but
 * `--answer q1=M` takes a 1-based option number. Getting that off by one is
 * silent — the wrong option is accepted.
 */

/**
 * Split a command string from the payload into argv.
 *
 * The strings kane-cli emits are simple (no shell metacharacters we need to
 * honour), so a quote-aware split is enough. We deliberately do not run them
 * through a shell.
 */
export function commandToArgv(command) {
  if (typeof command !== "string" || !command.trim()) return [];
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return tokens
    .map((t) => t.replace(/^["']|["']$/g, ""))
    .filter((t) => t !== "kane-cli");
}

/**
 * The 1-based option number to pass to `--answer`.
 *
 * @param {object} question a `pending_questions` entry
 * @returns {number|null} null when no valid option can be chosen
 */
export function answerOption(question) {
  const options = question?.options ?? [];
  if (!options.length) return null;

  const recommended = question?.recommended_index;
  if (Number.isInteger(recommended) && recommended >= 0 && recommended < options.length) {
    return recommended + 1;
  }
  return 1;
}

/**
 * Build `qN=M` answer flags for a paused session.
 *
 * @param {Array<object>} questions `pending_questions`
 * @param {object} [overrides] map of question id to a 1-based number or free text
 * @returns {string[]} flags, ready to append to the resume argv
 */
export function answerFlags(questions, overrides = {}) {
  const flags = [];
  for (const q of questions ?? []) {
    const id = q?.id;
    if (!id) continue;

    const override = overrides[id];
    if (override !== undefined && override !== null && override !== "") {
      flags.push(`${id}=${override}`);
      continue;
    }

    const option = answerOption(q);
    if (option !== null) flags.push(`${id}=${option}`);
  }
  return flags;
}

/**
 * Turn a paused outcome into the argv of the command that resumes it.
 *
 * @param {object} paused  the object returned by `classify()` for a pause
 * @param {object} [opts]
 * @param {object} [opts.overrides] question id to answer
 * @param {string[]} [opts.extra]   additional arguments to append
 * @returns {string[]} argv, or an empty array when the pause is unusable
 */
export function resumeArgv(paused, opts = {}) {
  if (!paused?.resume) return [];

  const argv = commandToArgv(paused.resume);
  if (!argv.length) return [];

  const flags = answerFlags(paused.questions, opts.overrides);
  for (const flag of flags) {
    argv.push("--answer", flag);
  }

  for (const extra of opts.extra ?? []) argv.push(extra);
  return argv;
}

/**
 * A short, human-readable description of what a pause is waiting for.
 * Used in logs and in the report, never for control flow.
 */
export function describePause(paused) {
  const questions = paused?.questions ?? [];
  if (!questions.length) return "paused with no questions";

  return questions
    .map((q) => {
      const choice = answerOption(q);
      const label = choice ? q.options?.[choice - 1]?.label : "no option";
      return `${q.id}: ${q.header ?? q.text ?? "question"} \u2192 ${label}`;
    })
    .join("; ");
}
