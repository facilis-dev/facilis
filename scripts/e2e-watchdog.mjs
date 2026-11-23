#!/usr/bin/env node
/**
 * Supervisor for a harness-spawned server (issue #153).
 *
 * Usage: node scripts/e2e-watchdog.mjs <command> [args...]
 *
 * The harness spawns this DETACHED, so it leads its own process group, and pipes stdin from
 * the harness without ever writing to it. The server runs in the SAME group, so one signal
 * reaches the server and every descendant it spawns — `child.kill()` alone does not.
 *
 * Two independent triggers reap the group:
 *  - stdin EOF: the harness is gone. This is the only mechanism that survives SIGKILL of the
 *    harness, where no signal handler and no `finally` can run — the exact incident that left
 *    three Nitro servers alive on a shared dev machine.
 *  - SIGTERM/SIGINT/SIGHUP: the harness is tearing down, or a human interrupted the run.
 * A ppid poll backstops the pipe, in case another process inherited its write end.
 *
 * Residual edge: SIGKILL of this supervisor itself still orphan the server. The host lock
 * (scripts/e2e-lock.mjs) bounds how many such trees can exist, and docs/POSTGRES.md carries
 * the reaper recipe.
 */
import { spawn } from "node:child_process";
import process from "node:process";
import { killGroup } from "./e2e-process.mjs";

// Above the server's own graceful-close window (Nitro announces 5 s), so a clean SIGTERM
// shutdown is not cut short by the escalation.
const GRACE_MS = Number(process.env.FACILIS_E2E_WATCHDOG_GRACE_MS) || 10_000;
const POLL_MS = 500;
const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node scripts/e2e-watchdog.mjs <command> [args...]");
  process.exit(2);
}

// Once the harness is gone its read ends close: a log write must not crash the teardown.
process.stdout?.on?.("error", () => {});
process.stderr?.on?.("error", () => {});

const parentPid = process.ppid;
// "ignore" stdin keeps the server off the liveness pipe; its output still reaches the harness.
const child = spawn(command, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "inherit", "inherit"],
});

let tearing = false;
let poll = null;
let escalate = null;

function finish(code) {
  if (poll !== null) clearInterval(poll);
  if (escalate !== null) clearTimeout(escalate);
  process.exit(code);
}

function teardown(reason) {
  if (tearing) return;
  tearing = true;
  if (poll !== null) clearInterval(poll);
  console.error(`watchdog: ${reason}; stopping process group ${process.pid}`);
  // We lead the group (the harness spawned us detached), so this is the whole tree. The
  // direct signal is the fallback for a manual, non-detached invocation.
  killGroup(process.pid, "SIGTERM");
  try {
    child.kill("SIGTERM");
  } catch {
    // Already gone.
  }
  escalate = setTimeout(() => {
    killGroup(process.pid, "SIGKILL");
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
    finish(1);
  }, GRACE_MS);
}

child.once("exit", (code, signal) => {
  if (!tearing) console.error(`watchdog: server exited (code=${code} signal=${signal})`);
  finish(tearing ? 0 : (code ?? 1));
});
child.once("error", (error) => {
  console.error("watchdog: cannot start the server: " + error.message);
  finish(1);
});

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  // Survive our own group SIGTERM: teardown is idempotent and must outlive it to escalate.
  process.on(signal, () => teardown(signal));
}
process.stdin.on("end", () => teardown("harness closed the liveness pipe"));
process.stdin.on("close", () => teardown("harness liveness pipe closed"));
process.stdin.on("error", () => teardown("harness liveness pipe failed"));
process.stdin.resume();
poll = setInterval(() => {
  if (process.ppid !== parentPid) teardown("harness exited (this process was re-parented)");
}, POLL_MS);
