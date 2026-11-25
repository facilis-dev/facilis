#!/usr/bin/env node
/**
 * Spike runner (issue #133, epic #131, D-203).
 *
 * Boots a production Nitro build with telemetry ON and a second one with telemetry OFF, an
 * operator-style OTLP collector and a real headless Chrome, then asserts:
 *   - one trace-id spans browser fetch → Nitro request → DB query;
 *   - the ingestion route rejects wrong origin, null origin, over-rate, oversize, malformed
 *     and oversized batches, strips value/PII attributes, dedups span ids;
 *   - disabled telemetry answers 404 and the route has no read surface.
 *
 * Usage: node run.mjs   (requires `npm install` here and in `client/`)
 * Artifacts: results/report.json, results/browser.png, .spike/*.log
 */
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, openPage } from "../../scripts/dev/cdp.mjs";
import { runGateProbes } from "./lib/probes.mjs";

const SPIKE = dirname(fileURLToPath(import.meta.url));
const APP_PORT = 5180;
const DISABLED_PORT = 5182;
const COLLECTOR_PORT = 4318;
const ORIGIN = "http://127.0.0.1:" + APP_PORT;
const APP = ORIGIN;
const DISABLED = "http://127.0.0.1:" + DISABLED_PORT;
const COLLECTOR = "http://127.0.0.1:" + COLLECTOR_PORT;
const SPANS_PER_MINUTE = 24;
const TOOLING = process.env.FACILIS_TOOLING_DIR || "/tmp/facilis-dev";
const CHROME = process.env.FACILIS_CHROME || join(TOOLING, "browser/chrome/chrome");
const RESULTS = join(SPIKE, "results");
const WORK = join(SPIKE, ".spike");
const children = [];
const checks = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: SPIKE, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve(output) : reject(new Error(command + " exited " + code + "\n" + output.slice(-2000))),
    );
  });
}

function start(name, args, env) {
  const log = openSync(join(WORK, name + ".log"), "w");
  const child = spawn(process.execPath, args, {
    cwd: SPIKE,
    env: { ...process.env, ...env },
    stdio: ["ignore", log, log],
  });
  children.push(child);
  return child;
}

async function waitForHttp(url, timeoutMs = 20000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error("timeout waiting for " + url);
}

async function build() {
  mkdirSync(WORK, { recursive: true });
  mkdirSync(RESULTS, { recursive: true });
  mkdirSync(join(SPIKE, "public"), { recursive: true });
  copyFileSync(join(SPIKE, "client/index.html"), join(SPIKE, "public/index.html"));
  await run(join(SPIKE, "client/node_modules/esbuild/bin/esbuild"), [
    "client/src/main.ts",
    "--bundle",
    "--format=esm",
    "--platform=browser",
    "--target=chrome120",
    "--outfile=public/spike.js",
    "--log-level=warning",
  ]);
  await run(join(SPIKE, "node_modules/.bin/nitro"), ["build"]);
}

async function collectorSpans() {
  return (await (await fetch(COLLECTOR + "/spans")).json()).spans;
}

async function waitForCorrelatedTrace(timeoutMs = 20000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const spans = await collectorSpans();
    const web = spans.find((span) => span.serviceName === "facilis-spike-web");
    if (web !== undefined) {
      const server = spans.find(
        (span) => span.traceId === web.traceId && span.name === "GET /api/items",
      );
      const db = spans.find((span) => span.traceId === web.traceId && span.name === "SELECT items");
      if (server !== undefined && db !== undefined) {
        return { spans, web, server, db };
      }
    }
    await sleep(250);
  }
  const leftover = await collectorSpans();
  writeFileSync(join(RESULTS, "collector-debug.json"), JSON.stringify(leftover, null, 2) + "\n");
  throw new Error(
    "no correlated browser→server trace; collector has " +
      leftover.length +
      " spans: " +
      JSON.stringify(leftover.map((span) => span.serviceName + "|" + span.name + "|" + span.traceId)),
  );
}

const VALUE_FREE_SPAN_KEYS = new Set([
  "http.request.method",
  "http.route",
  "http.response.status_code",
  "db.system",
  "db.operation",
  "db.table",
]);

async function main() {
  await build();

  start("collector", ["collector.mjs"], { COLLECTOR_PORT: String(COLLECTOR_PORT) });
  const commonEnv = {
    NODE_ENV: "production",
    FACILIS_OTLP_ENDPOINT: COLLECTOR + "/v1/traces",
    FACILIS_TELEMETRY_ORIGINS: ORIGIN,
    FACILIS_TELEMETRY_SPANS_PER_MIN: String(SPANS_PER_MINUTE),
  };
  start("app", [".output/server/index.mjs"], {
    ...commonEnv,
    PORT: String(APP_PORT),
    FACILIS_TELEMETRY: "on",
  });
  // Same build, telemetry not enabled: the deploy-option switch of D-203 §5.
  start("app-disabled", [".output/server/index.mjs"], {
    ...commonEnv,
    PORT: String(DISABLED_PORT),
  });

  await waitForHttp(COLLECTOR + "/health");
  await waitForHttp(APP + "/api/items");
  await waitForHttp(DISABLED + "/api/items");

  const { child: chrome, client } = await launchChrome({
    chrome: CHROME,
    profileDir: join(WORK, "chrome-profile"),
    homeDir: join(WORK, "chrome-home"),
    sysroot: join(TOOLING, "browser/sysroot"),
    fontconfigFile: join(TOOLING, "browser/fonts.conf"),
  });
  children.push(chrome);

  const page = await openPage(client, APP + "/");
  let pageResult = null;
  const pageUntil = Date.now() + 25000;
  while (Date.now() < pageUntil && pageResult === null) {
    pageResult = await page.evaluate("window.__SPIKE ?? null");
    if (pageResult === null) await sleep(200);
  }
  if (pageResult === null) {
    throw new Error(
      "page never reported a result; console=" +
        JSON.stringify(page.consoleEntries.slice(-6)) +
        " errors=" +
        JSON.stringify(page.pageErrors),
    );
  }
  await page.screenshot(join(RESULTS, "browser.png"));
  check(
    "browser_fetch_succeeded",
    pageResult.status === 200 && pageResult.items === 3,
    JSON.stringify(pageResult),
  );

  const { spans, web, server, db } = await waitForCorrelatedTrace();
  check("fe_span_exported", web.via === "ingestion", "via=" + web.via + " name=" + web.name);
  check(
    "single_trace_id",
    web.traceId === server.traceId && db !== undefined && db.traceId === web.traceId,
    "web=" + web.traceId + " server=" + server.traceId + " db=" + db?.traceId,
  );
  check(
    "server_parent_is_fetch",
    server.parentSpanId === web.spanId,
    "server.parent=" + server.parentSpanId + " fetch.span=" + web.spanId,
  );
  check(
    "db_parent_is_request",
    db !== undefined && db.parentSpanId === server.spanId,
    "db.parent=" + db?.parentSpanId + " server.span=" + server.spanId,
  );
  const serverKeys = Object.keys(server.attributes);
  check(
    "span_attributes_value_free",
    serverKeys.every((key) => VALUE_FREE_SPAN_KEYS.has(key)) &&
      !serverKeys.some((key) => key.includes("url") || key.includes("header")),
    "attrs=" + serverKeys.join(","),
  );

  const probeChecks = await runGateProbes({
    origin: ORIGIN,
    enabledBase: APP,
    disabledBase: DISABLED,
    collectorBase: COLLECTOR,
    spansPerMinute: SPANS_PER_MINUTE,
  });
  checks.push(...probeChecks);

  const correlated = spans
    .filter((span) => span.traceId === web.traceId)
    .map(({ traceId, spanId, parentSpanId, name, serviceName, attributes, via }) => ({
      traceId,
      spanId,
      parentSpanId,
      name,
      serviceName,
      attributes,
      via,
    }));
  writeFileSync(
    join(RESULTS, "report.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        trace: { traceId: web.traceId, spans: correlated },
        checks,
      },
      null,
      2,
    ) + "\n",
  );
}

try {
  await main();
} catch (error) {
  check("runner", false, error instanceof Error ? error.message : String(error));
} finally {
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  await sleep(400);
  for (const child of children) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

const failed = checks.filter((entry) => !entry.ok);
for (const entry of checks) {
  console.log((entry.ok ? "PASS " : "FAIL ") + entry.name + " · " + entry.detail);
}
console.log(
  failed.length === 0
    ? "\nAll " + checks.length + " checks passed. Artifacts: results/report.json, results/browser.png"
    : "\n" + failed.length + " of " + checks.length + " checks failed.",
);
process.exitCode = failed.length === 0 ? 0 : 1;
