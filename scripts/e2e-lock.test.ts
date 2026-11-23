import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";

import {
  acquireLock,
  isAlive,
  lockPath,
  lockWaitMs,
  readHolder,
} from "./e2e-lock.mjs";
import { waitForExit } from "./e2e-process.mjs";

const dirs: string[] = [];
function lockFile() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "e2e-lock-"));
  dirs.push(dir);
  return path.join(dir, "pg-e2e.lock");
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
async function deadPid() {
  const child = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
  await waitForExit(child, 10_000);
  return child.pid;
}

describe("isAlive", () => {
  it("recognises this process, a reaped one and nonsense pids", async () => {
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(await deadPid())).toBe(false);
    expect(isAlive(0)).toBe(false);
    expect(isAlive(-1)).toBe(false);
    expect(isAlive(Number.NaN)).toBe(false);
  });
});

describe("lockPath / lockWaitMs", () => {
  it("honours the environment overrides and defaults to one slot per host", () => {
    expect(lockPath({})).toBe(path.join(os.tmpdir(), "facilis-pg-e2e.lock"));
    expect(lockPath({ FACILIS_PG_E2E_LOCK: "/tmp/custom.lock" })).toBe("/tmp/custom.lock");
    expect(lockWaitMs({})).toBe(0);
    expect(lockWaitMs({ FACILIS_PG_E2E_LOCK_WAIT_MS: "1500" })).toBe(1500);
    expect(lockWaitMs({ FACILIS_PG_E2E_LOCK_WAIT_MS: "nonsense" })).toBe(0);
  });
});

describe("acquireLock", () => {
  it("records the holder and releases only its own slot", async () => {
    const file = lockFile();
    const lock = await acquireLock({ file });
    expect(lock.holder.pid).toBe(process.pid);
    expect(readHolder(file)?.cwd).toBe(process.cwd());
    expect(lock.release()).toBe(true);
    expect(existsSync(file)).toBe(false);
    expect(lock.release()).toBe(false);
  });

  it("refuses a second concurrent run and names the holder", async () => {
    const file = lockFile();
    const first = await acquireLock({ file });
    await expect(acquireLock({ file })).rejects.toThrow(
      new RegExp(`another pg:e2e run holds .*pid ${process.pid}`),
    );
    // The diagnostic must say how to queue and how to recover a killed run.
    await expect(acquireLock({ file })).rejects.toThrow(/FACILIS_PG_E2E_LOCK_WAIT_MS/);
    expect(existsSync(file)).toBe(true);
    expect(first.release()).toBe(true);
  });

  it("reclaims a lock whose holder is gone", async () => {
    const file = lockFile();
    writeFileSync(
      file,
      JSON.stringify({ pid: await deadPid(), startedAt: "2026-11-21T00:00:00.000Z" }),
    );
    const lock = await acquireLock({ file });
    expect(lock.holder.pid).toBe(process.pid);
    expect(lock.release()).toBe(true);
  });

  it("queues for the slot when a wait budget is given", async () => {
    const file = lockFile();
    const first = await acquireLock({ file });
    const queued = acquireLock({ file, waitMs: 10_000, pollMs: 50 });
    setTimeout(() => first.release(), 200);
    const second = await queued;
    expect(second.holder.pid).toBe(process.pid);
    expect(second.release()).toBe(true);
  });

  it("gives up with a diagnostic when the queue budget runs out", async () => {
    const file = lockFile();
    const first = await acquireLock({ file });
    await expect(acquireLock({ file, waitMs: 150, pollMs: 50 })).rejects.toThrow(
      /another pg:e2e run holds/,
    );
    expect(first.release()).toBe(true);
  });

  it("never removes a slot another run took over", async () => {
    const file = lockFile();
    const lock = await acquireLock({ file });
    const other = { pid: process.pid, startedAt: "2099-01-01T00:00:00.000Z", cwd: "/elsewhere" };
    writeFileSync(file, JSON.stringify(other));
    expect(lock.release()).toBe(false);
    expect(readHolder(file)).toEqual(other);
  });

  it("treats an unreadable holder record as stale", async () => {
    const file = lockFile();
    writeFileSync(file, "not json");
    const lock = await acquireLock({ file });
    expect(lock.holder.pid).toBe(process.pid);
    expect(lock.release()).toBe(true);
  });
});
