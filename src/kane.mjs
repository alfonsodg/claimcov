/**
 * kane — run kane-cli and make its output usable by a program.
 *
 * kane-cli speaks NDJSON to stdout and signals outcomes through its exit code,
 * which is what makes a closed loop possible:
 *
 *   0  complete         continue
 *   2  refused          a precondition failed and it names the command to fix it
 *   3  session_paused   it needs an answer, and the pause payload carries the
 *                       question, its options and a recommended index
 *
 * Everything here exists so a caller never has to parse free text or guess what
 * a non-zero code meant.
 */
import { spawn } from "node:child_process";

/** Exit codes kane-cli uses. Verified against 0.10.8. */
export const EXIT = {
  OK: 0,
  REFUSED: 2,
  PAUSED: 3,
};

/** How a run ended, in terms a caller can branch on. */
export const OUTCOME = {
  COMPLETE: "complete",
  REFUSED: "refused",
  PAUSED: "paused",
  FAILED: "failed",
  TIMEOUT: "timeout",
};

/**
 * Parse one NDJSON line. Returns null for anything that is not JSON, because
 * kane-cli interleaves human-readable progress with the stream.
 */
export function parseEvent(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const value = JSON.parse(trimmed);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Normalise the `next` hints a run carries.
 *
 * The shapes differ by event: the `done` summary carries objects with `cmd` and
 * `why`, while the `error` event may carry bare command strings. Both mean the
 * same thing, so callers get one shape and never see a `cmd` of undefined.
 */
export function normaliseNext(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((n) => (typeof n === "string" ? { cmd: n } : n))
    .filter((n) => n && typeof n.cmd === "string" && n.cmd.length > 0);
}

/**
 * Pull the structured meaning out of a finished run.
 *
 * The `done` event is the authoritative summary; the exit code is the fallback
 * when a run dies before emitting it.
 */
export function classify(events, code) {
  const done = [...events].reverse().find((e) => e.type === "done");
  const paused = events.find((e) => e.type === "session_paused");
  const error = events.find((e) => e.type === "error");

  if (paused) {
    return {
      outcome: OUTCOME.PAUSED,
      code,
      session: paused.sid,
      resume: paused.resume,
      expiresAt: paused.expires_at,
      questions: paused.pending_questions ?? [],
      next: normaliseNext(paused.next ?? done?.next ?? []),
    };
  }

  if (code === EXIT.PAUSED) {
    // Exit 3 without a pause payload is a protocol violation, not a success.
    return {
      outcome: OUTCOME.FAILED,
      code,
      error: "exit 3 without a session_paused event",
      next: normaliseNext(done?.next ?? []),
    };
  }

  if (code === EXIT.REFUSED || error) {
    return {
      outcome: OUTCOME.REFUSED,
      code,
      error: error?.message,
      code_name: error?.code,
      next: normaliseNext(done?.next ?? error?.next ?? []),
    };
  }

  if (code === EXIT.OK) {
    return { outcome: OUTCOME.COMPLETE, code, next: normaliseNext(done?.next ?? []) };
  }

  return {
    outcome: OUTCOME.FAILED,
    code,
    error: done?.status ?? "unknown failure",
    next: normaliseNext(done?.next ?? []),
  };
}

/**
 * Run kane-cli.
 *
 * @param {string[]} argv             arguments after `kane-cli`
 * @param {object}   [opts]
 * @param {string}   [opts.bin]       binary name, defaults to kane-cli
 * @param {string}   [opts.cwd]       working directory, where the .context store lives
 * @param {number}   [opts.timeoutMs] kill the run after this long
 * @param {(e:object)=>void} [opts.onEvent] called for each parsed event
 * @param {(s:string)=>void} [opts.onStderr]
 * @returns {Promise<{outcome:string, code:number, events:object[], stderr:string}>}
 */
export function runKane(argv, opts = {}) {
  const {
    bin = process.env.CLAIMCOV_KANE_BIN ?? "kane-cli",
    cwd = process.cwd(),
    timeoutMs = 15 * 60 * 1000,
    onEvent,
    onStderr,
  } = opts;

  return new Promise((resolve) => {
    const child = spawn(bin, argv, {
      cwd,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });

    const events = [];
    let buffer = "";
    let stderr = "";
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, events, stderr });
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ outcome: OUTCOME.TIMEOUT, code: -1 });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseEvent(line);
        if (!event) continue;
        events.push(event);
        onEvent?.(event);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      onStderr?.(text);
    });

    child.on("error", (e) => {
      finish({
        outcome: OUTCOME.FAILED,
        code: -1,
        ...{ stderr: `${stderr}${e.message}` },
      });
    });

    child.on("exit", (code) => {
      // A final line without a trailing newline is still an event.
      const event = parseEvent(buffer);
      if (event) {
        events.push(event);
        onEvent?.(event);
      }
      finish({ ...classify(events, code ?? -1), code: code ?? -1 });
    });
  });
}
