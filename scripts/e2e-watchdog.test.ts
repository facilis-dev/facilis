import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { killGroup, spawnGroup, waitForExit } from "./e2e-process.mjs";

const WATCHDOG = fileURLToPath(new URL("./e2e-watchdog.mjs", import.meta.url));
const dirs: string[] = [];
const pids: number[] = [];
function tmpDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "e2e-watchdog-"));
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
async function waitForGone(pid: number, limitMs = 20_000) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    if (!alive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !alive(pid);
}
async function waitForFile(file: string, limitMs = 20_000) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("marker file never appeared: " + file);
}
/** A stand-in server that spawns a descendant, so the test proves the whole group is reaped. */
function serverScript(marker: string) {
  return `
    const { spawn } = require("node:child_process");
    const fs = require("node:fs");
    const kid = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ server: process.pid, kid: kid.pid }));
    setInterval(() => {}, 1000);
  `;
}
/** The harness side of the incident: spawn the watchdog detached, hold the pipe, stay alive. */
function harnessScript(watchdog: string, server: string) {
  return `
    const { spawn } = require("node:child_process");
    const w = spawn(process.execPath, [${JSON.stringify(watchdog)}, process.execPath, "-e", ${JSON.stringify(server)}], {
      stdio: ["pipe", "ignore", "ignore"],
      detached: true,
    });
    w.unref();
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

describe("e2e-watchdog", () => {
  it("reaps the server group when the harness is SIGKILLed (issue #153)", async () => {
    const marker = path.join(tmpDir(), "tree.json");
    const harness = spawn(
      process.execPath,
      ["-e", harnessScript(WATCHDOG, serverScript(marker))],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    pids.push(harness.pid);
    const tree = await waitForFile(marker);
    pids.push(tree.server, tree.kid);
    expect(alive(tree.server)).toBe(true);
    expect(alive(tree.kid)).toBe(true);

    // SIGKILL cannot be handled in-process: no handler, no finally. The watchdog must notice
    // the liveness pipe closing and reap the group anyway.
    process.kill(harness.pid, "SIGKILL");
    await waitForExit(harness, 10_000);
    expect(await waitForGone(tree.kid)).toBe(true);
    expect(await waitForGone(tree.server)).toBe(true);
  });

  it("reaps the server group when the harness closes the liveness pipe", async () => {
    const marker = path.join(tmpDir(), "tree.json");
    const watchdog = spawnGroup(
      process.execPath,
      [WATCHDOG, process.execPath, "-e", serverScript(marker)],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    pids.push(watchdog.pid);
    let stderr = "";
    watchdog.stderr.on("data", (chunk) => (stderr += chunk));
    const tree = await waitForFile(marker);
    pids.push(tree.server, tree.kid);

    watchdog.stdin.end();
    expect(await waitForGone(tree.kid)).toBe(true);
    expect(await waitForGone(tree.server)).toBe(true);
    expect(await waitForGone(watchdog.pid)).toBe(true);
    expect(stderr).toContain("liveness pipe");
  });

  it("reaps the server group on SIGTERM to the watchdog", async () => {
    const marker = path.join(tmpDir(), "tree.json");
    const watchdog = spawnGroup(
      process.execPath,
      [WATCHDOG, process.execPath, "-e", serverScript(marker)],
      { stdio: ["pipe", "ignore", "ignore"] },
    );
    pids.push(watchdog.pid);
    const tree = await waitForFile(marker);
    pids.push(tree.server, tree.kid);

    killGroup(watchdog.pid, "SIGTERM");
    expect(await waitForGone(tree.kid)).toBe(true);
    expect(await waitForGone(tree.server)).toBe(true);
    expect(await waitForGone(watchdog.pid)).toBe(true);
  });

  it("propagates the server's own exit code", async () => {
    const watchdog = spawnGroup(
      process.execPath,
      [WATCHDOG, process.execPath, "-e", "process.exit(7)"],
      { stdio: ["pipe", "ignore", "ignore"] },
    );
    pids.push(watchdog.pid);
    const exit = await waitForExit(watchdog, 20_000);
    expect(exit?.code).toBe(7);
  });

  it("fails with a usage diagnostic when no command is given", async () => {
    const watchdog = spawnGroup(process.execPath, [WATCHDOG], { stdio: ["ignore", "ignore", "pipe"] });
    pids.push(watchdog.pid);
    let stderr = "";
    watchdog.stderr.on("data", (chunk) => (stderr += chunk));
    const exit = await waitForExit(watchdog, 20_000);
    expect(exit?.code).toBe(2);
    expect(stderr).toContain("usage:");
  });
});
