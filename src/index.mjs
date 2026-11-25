/**
 * claimcov public surface, for programmatic consumers.
 *
 * The CLI (`cli.mjs`) stays the primary interface; this module re-exports the
 * pieces an agent loop may want to call directly.
 */
export { runKane, classify, parseEvent, normaliseNext, EXIT, OUTCOME } from "./kane.mjs";
export { runUntilDone, recoverAndRetry, overridesFor } from "./loop.mjs";
export {
  answerOption,
  answerFlags,
  resumeArgv,
  commandToArgv,
  describePause,
} from "./resume.mjs";
export {
  toClaim,
  coverageEvent,
  buildReport,
  buildGaps,
  summarise,
  exitCodeFor,
  CLAIM,
} from "./report.mjs";
export { planVariables, applyVariables, readVariables, VARIABLES_PATH } from "./variables.mjs";
export { verify, useCaseIds } from "./verify.mjs";
