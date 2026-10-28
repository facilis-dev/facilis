// Minimal Chrome DevTools Protocol client used by the IDE smoke test.
//
// No npm dependency on purpose: Playwright/Puppeteer are not repo dependencies and
// the only capability needed is "drive one page and screenshot it". Node 24 ships a
// global WebSocket, so the whole client is ~100 lines and stays inside the repo's
// 300-line-per-file rule.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Shared-library dirs of a Debian sysroot prepared by scripts/dev/fetch-browser.sh. */
function sysrootLibraryPath(sysroot) {
  if (!sysroot) return "";
  const dirs = [
    path.join(sysroot, "usr/lib/x86_64-linux-gnu"),
    path.join(sysroot, "usr/lib/x86_64-linux-gnu/pulseaudio"),
    path.join(sysroot, "lib/x86_64-linux-gnu"),
    path.join(sysroot, "usr/lib"),
  ];
  return dirs.join(":");
}

export async function launchChrome(options) {
  const {
    chrome,
    profileDir: freshProfileDir,
    homeDir,
    sysroot,
    fontconfigFile,
    timeoutMs = 30000,
  } = options;
  // Extra switches for experiments (e.g. hosting the studio behind another hostname).
  // JSON array so switches with spaces survive: '["--host-resolver-rules=MAP x 127.0.0.1"]'
  const rawFlags = process.env.FACILIS_CHROME_FLAGS_JSON || "[]";
  const extraFlags = JSON.parse(rawFlags);
  // FACILIS_PROFILE_DIR reuses one browser profile across local runs: OPFS keeps the
  // kernel's dependency snapshot and the package manager's store, so an iteration after
  // the first does not pay a cold install. The smoke's default stays a throwaway profile
  // (a fresh, reproducible boot); use this only when iterating by hand.
  const profileDir = process.env.FACILIS_PROFILE_DIR || freshProfileDir;
  if (!process.env.FACILIS_PROFILE_DIR) fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });
  if (homeDir) fs.mkdirSync(homeDir, { recursive: true });

  const env = { ...process.env };
  if (sysroot) {
    env.LD_LIBRARY_PATH = [sysrootLibraryPath(sysroot), env.LD_LIBRARY_PATH]
      .filter(Boolean)
      .join(":");
  }
  if (fontconfigFile) env.FONTCONFIG_FILE = fontconfigFile;
  if (homeDir) env.HOME = homeDir;

  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-crash-reporter",
      "--disable-breakpad",
      "--no-first-run",
      "--remote-debugging-port=0",
      "--user-data-dir=" + profileDir,
      ...extraFlags,
      "about:blank",
    ],
    { env, stdio: ["ignore", "ignore", "pipe"] },
  );
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

  const portFile = path.join(profileDir, "DevToolsActivePort");
  const until = Date.now() + timeoutMs;
  let port = "";
  while (Date.now() < until && !port) {
    await sleep(200);
    try {
      port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
    } catch {
      /* not up yet */
    }
  }
  if (!port) {
    child.kill("SIGKILL");
    throw new Error(
      "chrome did not open a DevTools port. stderr:\n" + stderr.join("").slice(-1500),
    );
  }
  const version = await (await fetch("http://127.0.0.1:" + port + "/json/version")).json();
  const client = await connect(version.webSocketDebuggerUrl);
  return { child, client, port };
}

export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP socket failed")), { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return { ws, send, on: (listener) => listeners.add(listener), close: () => ws.close() };
}

export async function openPage(client, url) {
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params = {}) => client.send(method, params, sessionId);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Log.enable");
  await client.send(
    "Target.setAutoAttach",
    { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
    sessionId,
  );

  const consoleEntries = [];
  const pageErrors = [];
  const failedRequests = [];
  const requests = new Map();
  client.on((message) => {
    const params = message.params || {};
    // The kernel installs packages from inside Web Workers, and their Network events
    // arrive on the worker's own CDP session: each attached target must be instrumented
    // or the install looks like it downloads nothing (and its failures are invisible).
    if (message.method === "Target.attachedToTarget") {
      for (const method of ["Network.enable", "Runtime.enable", "Log.enable"]) {
        client.send(method, {}, params.sessionId).catch(() => {});
      }
      return;
    }
    if (message.method === "Network.requestWillBeSent") {
      requests.set(params.requestId, { url: params.request.url, bytes: 0 });
      return;
    }
    if (message.method === "Network.loadingFinished") {
      const record = requests.get(params.requestId);
      if (record) record.bytes = params.encodedDataLength || 0;
      return;
    }
    if (message.method === "Runtime.consoleAPICalled") {
      const text = (params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ");
      consoleEntries.push({ type: params.type, text: String(text).slice(0, 500) });
    } else if (message.method === "Runtime.exceptionThrown") {
      pageErrors.push(
        String(params.exceptionDetails?.exception?.description || "exception").slice(0, 800),
      );
    } else if (message.method === "Network.loadingFailed" && !params.canceled) {
      const record = requests.get(params.requestId);
      failedRequests.push(
        (params.errorText || "failed") + " " + (record ? record.url.slice(0, 200) : ""),
      );
    } else if (message.method === "Network.responseReceived") {
      const response = params.response || {};
      if (response.status >= 400)
        failedRequests.push(response.status + " " + response.url?.slice(0, 200));
    }
  });

  await send("Page.navigate", { url });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || "evaluate failed");
    }
    return result.result.value;
  };
  const screenshot = async (file) => {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(file, Buffer.from(data, "base64"));
  };
  const downloads = () => Array.from(requests.values()).filter((request) => request.bytes > 0);

  return {
    sessionId,
    send,
    evaluate,
    screenshot,
    consoleEntries,
    pageErrors,
    failedRequests,
    downloads,
  };
}
