/**
 * Process lifecycle helpers for the repository's acceptance harnesses (issue #153).
 *
 * A harness that spawns servers and builds owns three failure modes the plain
 * `child.kill()` + `finally` pattern does not cover:
 *
 *  - `kill()` signals the direct child only, so a build's or a server's descendants survive;
 *  - a `finally` never runs when the harness itself is SIGKILLed, or when SIGTERM/SIGINT
 *    arrive with no handler installed (Node's default action terminates immediately);
 *  - an unbounded phase (a wedged build, a server that never answers) hangs the run forever.
 *
 * Everything here is a named export with no import side effects, so the harnesses and their
 * colocated tests share one implementation of the rules.
 */
import { spawn } from "node:child_process";
import process from "node:process";

/** Grace period between SIGTERM and the SIGKILL escalation. */
export const DEFAULT_GRACE_MS = 5_000;
/** Exit codes follow the shell convention: 128 + the signal number. */
const SIGNAL_NUMBERS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };

/**
 * Spawn in a NEW process group (`detached`), so one signal reaches the child and every
 * descendant it spawns. The caller owns the group: pair this with `stopGroup`.
 */
export function spawnGroup(command, args, options = {}) {
  const child = spawn(command, args, { ...options, detached: true });
  // The harness holds stdin open as a liveness pipe; a child that already exited makes the
  // write end fail with EPIPE, which must not surface as an unhandled 'error' event.
  child.stdin?.on("error", () => {});
  return child;
}

/** Signal a whole process group. A group that is already gone is success, not an error. */
export function killGroup(pid, signal = "SIGTERM") {
  if (!pid) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

/**
 * Synchronous backstop for `process.on("exit")`: kill the group only while the child is still
 * running. A finished child's pid can be reused, and signalling that group would hit an
 * unrelated process tree.
 */
export function killGroupIfRunning(child, signal = "SIGKILL") {
  if (!child?.pid) return false;
  if (child.exitCode !== null || child.signalCode !== null) return false;
  return killGroup(child.pid, signal);
}

/** Resolve with `{ code, signal }` once the child exits, or `null` if the budget ran out. */
export function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve(null);
    }, timeoutMs);
    const onExit = (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    };
    child.once("exit", onExit);
  });
}

/** SIGTERM the group, then SIGKILL whatever is still alive after the grace period. */
export async function stopGroup(child, graceMs = DEFAULT_GRACE_MS) {
  if (!child?.pid) return { exited: true, forced: false };
  killGroup(child.pid, "SIGTERM");
  if (await waitForExit(child, graceMs)) return { exited: true, forced: false };
  killGroup(child.pid, "SIGKILL");
  const exited = await waitForExit(child, graceMs);
  return { exited: exited !== null, forced: true };
}

/** Reject with a diagnostic naming the phase and its budget when a promise outruns it. */
export function withTimeout(promise, ms, label) {
  let timer;
  const budget = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`phase "${label}" timed out after ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([promise, budget]).finally(() => clearTimeout(timer));
}

/**
 * Run a command to completion inside its own process group, with a hard budget. On timeout
 * the whole group is killed (a `pnpm build` leaves turbo/vite grandchildren behind) and the
 * error names the phase, so a hung run fails fast with something actionable.
 */
export async function runCommand(command, args, options = {}) {
  const {
    cwd,
    env,
    stdio = ["ignore", "inherit", "inherit"],
    timeoutMs = 600_000,
    label = command,
    cleanup,
    graceMs = DEFAULT_GRACE_MS,
  } = options;
  const child = spawnGroup(command, args, { cwd, env, stdio });
  // Synchronous backstop: `process.on("exit")` cannot await, but it can still kill a group.
  cleanup?.addSync(() => killGroupIfRunning(child));
  const exit = await waitForExit(child, timeoutMs);
  if (exit === null) {
    await stopGroup(child, graceMs);
    throw new Error(
      `phase "${label}" timed out after ${timeoutMs} ms; process group ${child.pid} was killed`,
    );
  }
  return exit;
}

/**
 * A run-once cleanup registry. Tasks run last-in-first-out (the server is stopped before the
 * database it talks to), every task is isolated so one failure cannot skip the rest, and the
 * synchronous half is safe to call from `process.on("exit")`.
 */
export function createCleanup() {
  const asyncTasks = [];
  const syncTasks = [];
  let settled = false;
  const runSync = () => {
    const errors = [];
    for (const task of [...syncTasks].reverse()) {
      try {
        task();
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  };
  return {
    add(task) {
      asyncTasks.push(task);
    },
    addSync(task) {
      syncTasks.push(task);
    },
    get settled() {
      return settled;
    },
    runSync() {
      if (settled) return [];
      settled = true;
      return runSync();
    },
    async run() {
      if (settled) return [];
      settled = true;
      const errors = [];
      for (const task of [...asyncTasks].reverse()) {
        try {
          await task();
        } catch (error) {
          errors.push(error);
        }
      }
      return errors.concat(runSync());
    },
  };
}

/**
 * Turn signals and fatal errors into one clean teardown, then exit. Without this a SIGTERM
 * (a closed session, a CI cancellation, `kill`) terminates Node before any `finally` runs and
 * leaves the spawned servers behind — the orphaned Nitro processes of issue #153.
 *
 * Returns `trigger` so a run deadline can reuse the same path, and `uninstall` for tests.
 */
export function installExitHandlers(cleanup, options = {}) {
  const log = options.log ?? ((message) => console.error(message));
  const exit = options.exit ?? ((code) => process.exit(code));
  const signals = options.signals ?? ["SIGINT", "SIGTERM", "SIGHUP"];
  let tearing = false;
  const trigger = (reason, code) => {
    if (tearing) return;
    tearing = true;
    log(`harness: ${reason}; cleaning up`);
    void cleanup.run().then((errors) => {
      for (const error of errors) log(`harness cleanup error: ${error?.message ?? error}`);
      exit(code);
    });
  };
  const handlers = signals.map((signal) => {
    const handler = () => trigger(signal, 128 + (SIGNAL_NUMBERS[signal] ?? 0));
    process.on(signal, handler);
    return [signal, handler];
  });
  const onFatal = (error) => {
    log(`harness fatal: ${error?.stack ?? error}`);
    trigger("fatal error", 1);
  };
  const onExit = () => cleanup.runSync();
  process.on("uncaughtException", onFatal);
  process.on("unhandledRejection", onFatal);
  process.on("exit", onExit);
  return {
    trigger,
    uninstall() {
      for (const [signal, handler] of handlers) process.removeListener(signal, handler);
      process.removeListener("uncaughtException", onFatal);
      process.removeListener("unhandledRejection", onFatal);
      process.removeListener("exit", onExit);
    },
  };
}
