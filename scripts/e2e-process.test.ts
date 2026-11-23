import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCleanup,
  installExitHandlers,
  killGroup,
  killGroupIfRunning,
  runCommand,
  spawnGroup,
  stopGroup,
  waitForExit,
  withTimeout,
} from "./e2e-process.mjs";

const dirs: string[] = [];
const pids: number[] = [];
function tmpDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "e2e-process-"));
  dirs.push(dir);
  return dir;
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function waitForGone(pid: number, limitMs = 15_000) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    if (!alive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !alive(pid);
}
async function waitForFile(file: string, limitMs = 15_000) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("marker file never appeared: " + file);
}
/** A "server" that spawns a descendant, so a test can prove the whole group is reaped. */
function treeScript(marker: string) {
  return `
    const { spawn } = require("node:child_process");
    const fs = require("node:fs");
    const kid = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ parent: process.pid, kid: kid.pid }));
    setInterval(() => {}, 1000);
  `;
}
afterEach(() => {
  for (const pid of pids.splice(0)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("killGroup", () => {
  it("reports a vanished group instead of throwing", async () => {
    const child = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
    const exit = await waitForExit(child, 10_000);
    expect(exit?.code).toBe(0);
    expect(killGroup(child.pid, "SIGKILL")).toBe(false);
    expect(killGroup(0)).toBe(false);
  });
});

describe("killGroupIfRunning", () => {
  it("skips an exited child so a reused pid is never signalled", async () => {
    const done = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
    await waitForExit(done, 10_000);
    expect(killGroupIfRunning(done)).toBe(false);
    const live = spawnGroup(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    pids.push(live.pid);
    expect(killGroupIfRunning(live)).toBe(true);
    expect(await waitForGone(live.pid)).toBe(true);
  });
});

describe("spawnGroup + stopGroup", () => {
  it("reaps the child and the descendant it spawned", async () => {
    const marker = path.join(tmpDir(), "tree.json");
    const child = spawnGroup(process.execPath, ["-e", treeScript(marker)], { stdio: "ignore" });
    pids.push(child.pid);
    const tree = await waitForFile(marker);
    expect(alive(tree.parent)).toBe(true);
    expect(alive(tree.kid)).toBe(true);
    // The child is its own group leader, so one signal reaches both.
    expect(child.pid).toBe(tree.parent);
    const stopped = await stopGroup(child, 5_000);
    expect(stopped.exited).toBe(true);
    expect(await waitForGone(tree.kid)).toBe(true);
    expect(await waitForGone(tree.parent)).toBe(true);
  });

  it("escalates to SIGKILL when the group ignores SIGTERM", async () => {
    const marker = path.join(tmpDir(), "stubborn.json");
    const stubborn = `
      process.on("SIGTERM", () => {});
      require("node:fs").writeFileSync(${JSON.stringify(marker)}, String(process.pid));
      setInterval(() => {}, 1000);
    `;
    const child = spawnGroup(process.execPath, ["-e", stubborn], { stdio: "ignore" });
    pids.push(child.pid);
    await waitForFile(marker);
    const stopped = await stopGroup(child, 500);
    expect(stopped.forced).toBe(true);
    expect(await waitForGone(child.pid)).toBe(true);
  });
});

describe("waitForExit", () => {
  it("resolves null when the budget runs out, and the code when it does not", async () => {
    const sleeper = spawnGroup(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    pids.push(sleeper.pid);
    expect(await waitForExit(sleeper, 300)).toBeNull();
    const stopped = await stopGroup(sleeper, 1_000);
    expect(stopped.exited).toBe(true);
    const exit = await waitForExit(sleeper, 1_000);
    expect(exit?.code).toBeNull();
    expect(["SIGTERM", "SIGKILL"]).toContain(exit?.signal);
  });
});

describe("withTimeout", () => {
  it("names the phase and its budget, and passes a fast promise through", async () => {
    await expect(withTimeout(new Promise(() => {}), 50, "provision")).rejects.toThrow(
      'phase "provision" timed out after 50 ms',
    );
    await expect(withTimeout(Promise.resolve("ok"), 1_000, "fast")).resolves.toBe("ok");
  });
});

describe("runCommand", () => {
  it("returns the exit code of a completed command", async () => {
    const exit = await runCommand(process.execPath, ["-e", "0"], { timeoutMs: 20_000 });
    expect(exit.code).toBe(0);
  });

  it("kills the whole group on timeout and reports the phase", async () => {
    const marker = path.join(tmpDir(), "build.json");
    const cleanup = createCleanup();
    await expect(
      runCommand(process.execPath, ["-e", treeScript(marker)], {
        timeoutMs: 1_500,
        label: "build @facilis.dev/db",
        cleanup,
      }),
    ).rejects.toThrow(/phase "build @facilis\.dev\/db" timed out after 1500 ms/);
    const tree = await waitForFile(marker);
    pids.push(tree.parent);
    expect(await waitForGone(tree.kid)).toBe(true);
    expect(await waitForGone(tree.parent)).toBe(true);
  });
});

describe("createCleanup", () => {
  it("runs last-in-first-out, isolates failures and settles once", async () => {
    const order: string[] = [];
    const cleanup = createCleanup();
    cleanup.add(() => order.push("first"));
    cleanup.addSync(() => order.push("sync"));
    cleanup.add(() => {
      order.push("second");
      throw new Error("boom");
    });
    const errors = await cleanup.run();
    // Async tasks unwind last-in-first-out, then the synchronous backstops do the same.
    expect(order).toEqual(["second", "first", "sync"]);
    expect(errors).toHaveLength(1);
    expect(cleanup.settled).toBe(true);
    expect(await cleanup.run()).toEqual([]);
    expect(order).toHaveLength(3);
  });

  it("runSync only runs the synchronous half, for process.on('exit')", () => {
    const order: string[] = [];
    const cleanup = createCleanup();
    cleanup.add(() => order.push("async"));
    cleanup.addSync(() => order.push("sync"));
    expect(cleanup.runSync()).toEqual([]);
    expect(order).toEqual(["sync"]);
  });
});

describe("installExitHandlers", () => {
  it("tears down on SIGTERM and exits with 128 + the signal number", async () => {
    const order: string[] = [];
    const cleanup = createCleanup();
    cleanup.add(() => order.push("cleaned"));
    const codes: number[] = [];
    let resolveExited: () => void = () => {};
    const exited = new Promise<void>((resolve) => {
      resolveExited = resolve;
    });
    const handlers = installExitHandlers(cleanup, {
      log: () => {},
      exit: (code: number) => {
        codes.push(code);
        resolveExited();
      },
    });
    process.emit("SIGTERM");
    // A second signal must not run the teardown twice.
    process.emit("SIGTERM");
    await exited;
    handlers.uninstall();
    expect(order).toEqual(["cleaned"]);
    expect(codes).toEqual([143]);
  });

  it("trigger reuses the same teardown path for a run deadline", async () => {
    const cleanup = createCleanup();
    let cleaned = 0;
    cleanup.add(() => {
      cleaned += 1;
    });
    const codes: number[] = [];
    const handlers = installExitHandlers(cleanup, {
      log: () => {},
      exit: (code: number) => codes.push(code),
    });
    handlers.trigger("run deadline exceeded", 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    handlers.uninstall();
    expect(cleaned).toBe(1);
    expect(codes).toEqual([1]);
  });
});
