// Browser proof for the PTC runner chain (docs/PTC.md §5, D-101).
//
// Serves the real ide/public/ptc-runner.html with the production CSP header (plus the
// IDE's COOP/COEP pair) and drives it exactly like runner.ts/runner-frame.ts do: a host
// page loads it in a sandbox="allow-scripts" iframe and speaks the postMessage protocol.
//
// Proves: the result comes back, the tool RPC round-trips, the worker's fetch is blocked
// by CSP, a program that would loop for >5s is killed by the runner timeout, the iframe
// main thread keeps relaying while the worker is stuck, and a fresh sandbox works after a
// termination. Needs the repo Chromium (pnpm ide:browser, docs/DEV.md).
//
// Usage: node scripts/dev/check-ptc-runner.mjs
// Exit code 0 = every check passed.

import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, openPage } from "./cdp.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RUNNER_PAGE = path.join(REPO_ROOT, "ide/public/ptc-runner.html");
const TOOLING = process.env.FACILIS_TOOLING_DIR || "/tmp/facilis-dev";
const CHROME = process.env.FACILIS_CHROME || path.join(TOOLING, "browser/chrome/chrome");
const SYSROOT = process.env.FACILIS_BROWSER_SYSROOT || path.join(TOOLING, "browser/sysroot");
const FONTCONFIG = process.env.FACILIS_FONTCONFIG || path.join(TOOLING, "browser/fonts.conf");
const ARTIFACTS = path.join(TOOLING, "ptc-runner-check");
const CSP = "default-src 'none'; script-src 'unsafe-inline'; worker-src blob:";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The host page: a miniature of runner-frame.ts + runner.ts, kept inline so the check has
// no build step and drives the production page through the documented protocol only.
const HOST_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>PTC runner browser check</title>
  </head>
  <body>
    <pre id="out">running…</pre>
    <script>
      "use strict";

      var checks = [];
      var toolCalls = [];
      function record(name, ok, detail) {
        checks.push({ name: name, ok: Boolean(ok), detail: String(detail === undefined ? "" : detail) });
      }
      var sleep = function (ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
      };

      function createChild() {
        return new Promise(function (resolve, reject) {
          var frame = document.createElement("iframe");
          frame.setAttribute("sandbox", "allow-scripts");
          frame.setAttribute("title", "PTC sandbox");
          frame.style.display = "none";
          frame.src = "/ptc-runner.html";
          frame.addEventListener("load", function () { resolve(frame); }, { once: true });
          frame.addEventListener("error", function () { reject(new Error("the runner frame failed to load")); }, { once: true });
          document.body.appendChild(frame);
        });
      }

      // The host half of the protocol: relay tool calls to a fake executor, resolve on
      // result/error, and terminate the frame when the run timeout fires (runner.ts does
      // the same through PtcChild.terminate()).
      function runProgram(frame, program, timeoutMs) {
        return new Promise(function (resolve) {
          var startedAt = Date.now();
          var calls = 0;
          var settled = false;
          var timer = null;
          var origin = null;
          function finish(outcome) {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            removeEventListener("message", onMessage);
            frame.remove();
            resolve({ outcome: outcome, elapsedMs: Date.now() - startedAt, toolCalls: calls, origin: origin });
          }
          function onMessage(event) {
            if (event.source !== frame.contentWindow) return;
            origin = event.origin;
            var data = event.data;
            if (!data || typeof data !== "object") return;
            if (data.type === "tool") {
              calls += 1;
              toolCalls.push({ name: data.name, args: data.args });
              frame.contentWindow.postMessage(
                { type: "tool-result", id: data.id, ok: true, value: { echo: data.args } },
                "*",
              );
              return;
            }
            if (data.type === "result") { finish({ ok: true, value: data.value }); return; }
            if (data.type === "error") {
              finish({ ok: false, error: { kind: data.kind, message: data.message } });
            }
          }
          addEventListener("message", onMessage);
          timer = setTimeout(function () {
            finish({ ok: false, error: { kind: "timeout", message: "the harness timeout fired" } });
          }, timeoutMs);
          frame.contentWindow.postMessage({ type: "run", runId: "check-" + startedAt, program: program }, "*");
        });
      }

      function pingFrame(frame, limitMs) {
        return new Promise(function (resolve) {
          var startedAt = performance.now();
          var timer = null;
          function cleanup() {
            if (timer) clearTimeout(timer);
            removeEventListener("message", onMessage);
          }
          function onMessage(event) {
            if (event.source !== frame.contentWindow) return;
            if (!event.data || event.data.type !== "pong") return;
            cleanup();
            resolve({ ok: true, ms: Math.round(performance.now() - startedAt) });
          }
          timer = setTimeout(function () { cleanup(); resolve({ ok: false, ms: -1 }); }, limitMs);
          addEventListener("message", onMessage);
          frame.contentWindow.postMessage({ type: "ping" }, "*");
        });
      }

      async function main() {
        // One program: tool RPC, arithmetic and an egress probe. The URL is embedded as a
        // literal because the worker's own origin is opaque ("null").
        var frame = await createChild();
        var probeProgram =
          "const seen = await tools.echo({ value: 42 });" +
          'let net = "allowed";' +
          "try { await fetch(" + JSON.stringify(location.origin + "/ping") + ', { mode: "no-cors" }); }' +
          'catch (error) { net = "blocked"; }' +
          "return { seen: seen, net: net, sum: 2 + 2 };";
        var probe = await runProgram(frame, probeProgram, 8000);
        var value = probe.outcome.value || {};
        record("the program result came back", probe.outcome.ok === true, JSON.stringify(probe.outcome));
        record("the tool RPC round-tripped once", probe.toolCalls === 1 && toolCalls[0] && toolCalls[0].name === "echo" && toolCalls[0].args.value === 42, JSON.stringify(toolCalls));
        record("the program received the tool result", Boolean(value.seen && value.seen.echo && value.seen.echo.value === 42), JSON.stringify(value.seen));
        record("the program computed a value", value.sum === 4, JSON.stringify(value.sum));
        record("worker fetch is blocked by CSP", value.net === "blocked", JSON.stringify(value.net));
        record("the iframe origin is opaque", probe.origin === "null", String(probe.origin));

        // A loop far longer than the 5 s contract; 600 ms is the harness's budget. While it
        // runs the iframe main thread must still answer: the program is in the worker.
        var busyFrame = await createChild();
        var busyRun = runProgram(busyFrame, "while (true) {}", 600);
        await sleep(150);
        var pong = await pingFrame(busyFrame, 1500);
        var busy = await busyRun;
        record("the iframe main thread answers during a busy program", pong.ok && pong.ms < 500, "pong=" + JSON.stringify(pong));
        record(
          "a >5s loop is terminated by the runner timeout",
          busy.outcome.ok === false && busy.outcome.error && busy.outcome.error.kind === "timeout" && busy.elapsedMs < 4000,
          JSON.stringify(busy.outcome) + " after " + busy.elapsedMs + "ms",
        );

        var recoveryFrame = await createChild();
        var recovery = await runProgram(recoveryFrame, "return { alive: true };", 5000);
        record("a fresh sandbox runs after a termination", recovery.outcome.ok === true && Boolean(recovery.outcome.value && recovery.outcome.value.alive), JSON.stringify(recovery.outcome));

        var passed = checks.filter(function (check) { return check.ok; }).length;
        window.__PTC_CHECK__ = { done: true, checks: checks, passed: passed, total: checks.length };
        document.getElementById("out").textContent = JSON.stringify(window.__PTC_CHECK__, null, 2);
        console.log("ptc-runner check finished: " + passed + "/" + checks.length);
      }

      main().catch(function (error) {
        window.__PTC_CHECK__ = {
          done: true,
          checks: checks,
          passed: checks.filter(function (check) { return check.ok; }).length,
          total: checks.length + 1,
          error: String(error && error.stack ? error.stack : error),
        };
        console.error("ptc-runner check failed", error);
      });
    </script>
  </body>
</html>
`;

function startServer() {
  const runnerHtml = fs.readFileSync(RUNNER_PAGE);
  const headers = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "no-store",
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/ping") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"ok":true}');
      return;
    }
    if (url.pathname === "/ptc-runner.html") {
      // Production shape: the CSP header, not the Chrome-only csp="" attribute.
      response.writeHead(200, {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": CSP,
      });
      response.end(runnerHtml);
      return;
    }
    if (url.pathname === "/") {
      response.writeHead(200, { ...headers, "Content-Type": "text/html; charset=utf-8" });
      response.end(HOST_PAGE);
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        url: "http://127.0.0.1:" + address.port + "/",
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

async function main() {
  if (!fs.existsSync(CHROME)) {
    console.error("no Chromium at " + CHROME + "; run `pnpm ide:browser` first (docs/DEV.md).");
    process.exit(2);
  }
  fs.rmSync(ARTIFACTS, { recursive: true, force: true });
  const served = await startServer();
  console.log("serving " + served.url + " (CSP: " + CSP + ")");
  let report = null;
  let page = null;
  const chrome = await launchChrome({
    chrome: CHROME,
    profileDir: path.join(ARTIFACTS, "profile"),
    homeDir: path.join(ARTIFACTS, "home"),
    sysroot: fs.existsSync(SYSROOT) ? SYSROOT : "",
    fontconfigFile: fs.existsSync(FONTCONFIG) ? FONTCONFIG : "",
  });
  try {
    page = await openPage(chrome.client, served.url);
    const until = Date.now() + 40000;
    while (Date.now() < until) {
      report = await page.evaluate("window.__PTC_CHECK__ || null");
      if (report && report.done) break;
      await sleep(200);
    }
  } finally {
    try {
      chrome.client.close();
    } catch {
      /* already gone */
    }
    try {
      chrome.child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    await served.close();
    fs.rmSync(ARTIFACTS, { recursive: true, force: true });
  }

  if (report === null || !report.done) {
    console.error("FAIL: the browser check did not finish within 40s");
    process.exit(1);
  }
  let failed = report.error !== undefined || report.passed !== report.total;
  for (const check of report.checks)
    console.log((check.ok ? "PASS " : "FAIL ") + check.name + "  " + check.detail);
  if (report.error !== undefined) console.error("check error: " + report.error);
  if (page && page.pageErrors.length > 0) {
    failed = true;
    console.log("FAIL no page errors  " + page.pageErrors.slice(0, 3).join(" | "));
  }
  console.log("");
  console.log(report.passed + "/" + report.total + " checks passed");
  process.exit(failed ? 1 : 0);
}

await main();
