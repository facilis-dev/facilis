/**
 * Single-slot host lock for the Postgres acceptance harness (issue #153).
 *
 * `pnpm pg:e2e` builds four packages, boots a PGlite Wasm cluster, a TCP wire server and a
 * production Nitro server. Three concurrent runs saturated a 16-core shared dev machine
 * (loadavg 48/99/68) and froze the maintainer's desktop, so the harness serialises itself per
 * host instead of relying on every caller to be polite.
 *
 * The lock is advisory and self-healing: a holder whose pid is gone is stale and is reclaimed,
 * and releasing never removes a file another run owns.
 */
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

/** Default slot: one per host (the tmpdir is per-machine, not per-checkout). */
export const DEFAULT_LOCK_FILE = path.join(os.tmpdir(), "facilis-pg-e2e.lock");
/** How often a queued run re-checks the slot. */
const POLL_MS = 250;
/** Bound the stale-reclaim loop so an unwritable directory cannot spin forever. */
const MAX_STALE_RETRIES = 3;

export function lockPath(env = process.env) {
  return env.FACILIS_PG_E2E_LOCK || DEFAULT_LOCK_FILE;
}

export function lockWaitMs(env = process.env) {
  const raw = Number(env.FACILIS_PG_E2E_LOCK_WAIT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** A pid we may not signal (EPERM) still exists; only ESRCH means it is gone. */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function readHolder(file) {
  try {
    const holder = JSON.parse(readFileSync(file, "utf8"));
    return holder && typeof holder === "object" ? holder : null;
  } catch {
    return null;
  }
}

function describe(file, holder) {
  const who = holder
    ? `pid ${holder.pid}, started ${holder.startedAt}, cwd ${holder.cwd ?? "unknown"}`
    : "an unreadable holder record";
  return (
    `another pg:e2e run holds ${file} (${who}).\n` +
    "This harness builds four packages and boots PGlite plus a Nitro server; parallel runs " +
    "saturated a shared 16-core host (issue #153), so it runs one at a time per host.\n" +
    "Wait for that run, or set FACILIS_PG_E2E_LOCK_WAIT_MS=<ms> to queue for the slot, or " +
    "FACILIS_PG_E2E_LOCK=<path> to deliberately use a separate slot.\n" +
    "If the holder is gone but the file survived (a killed run), remove the file and retry."
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Take the slot, or fail with a diagnostic naming the holder. `waitMs` queues instead of
 * failing immediately; a stale lock (holder pid no longer alive) is reclaimed either way.
 */
export async function acquireLock(options = {}) {
  const file = options.file ?? lockPath();
  const waitMs = options.waitMs ?? 0;
  const pollMs = options.pollMs ?? POLL_MS;
  const deadline = Date.now() + waitMs;
  let staleRetries = 0;
  for (;;) {
    let fd;
    try {
      // "wx" is atomic: of two racing runs exactly one creates the file.
      fd = openSync(file, "wx");
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const holder = readHolder(file);
      if (!isAlive(holder?.pid)) {
        if (++staleRetries > MAX_STALE_RETRIES) {
          throw new Error(`cannot reclaim the stale lock ${file}: remove it manually`);
        }
        try {
          unlinkSync(file);
        } catch {
          // Another run reclaimed it first; loop and re-read.
        }
        continue;
      }
      if (Date.now() >= deadline) throw new Error(describe(file, holder));
      await sleep(pollMs);
      continue;
    }
    const holder = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      host: os.hostname(),
      cwd: process.cwd(),
    };
    writeSync(fd, JSON.stringify(holder, null, 2) + "\n");
    closeSync(fd);
    return {
      file,
      holder,
      /** Remove the slot only while this run still owns it. */
      release() {
        const current = readHolder(file);
        if (current?.pid !== holder.pid || current?.startedAt !== holder.startedAt) return false;
        try {
          unlinkSync(file);
          return true;
        } catch {
          return false;
        }
      },
    };
  }
}
