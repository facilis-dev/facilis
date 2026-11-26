// IDE prerender smoke gate (issue #85, D-202): route-level prerendering + hydration at
// scaling size — 50 public static pages in a full-stack (todo template) project.
//
// Standalone gate, same shape as scripts/dev/smoke-multitab.mjs: own check() accumulator,
// own dev server, raw CDP via scripts/dev/cdp.mjs (no Playwright), artifact retention via
// scripts/dev/run-artifacts.mjs, exit 1 on any FAIL.
//
// Flow:
//   1. boot the Studio and create the default todo project through the New project dialog;
//   2. write a deterministic 50-page fixture through the kernel VFS (vv-write), declare every
//      page in facilis.config.ts prerender.routes, and re-analyze the project graph;
//   3. select a fixture page in the graph satellite and click [data-testid=prerender-run-action]:
//      the in-VM "npm run build" must report "Prerender ready in {s}s" under 180 s — the
//      ~50-route scaling question D-202 left open (docs/DEV.md §6.2);
//   4. the opened preview hydrates the stored HTML: badge "Prerendered", x-facilis-render
//      header, prerender-data island, the page marker in #root, zero hydration errors;
//   5. an UNdeclared route (/todos) still serves the empty SPA shell (no header, "SPA shell");
//   6. declaring the auth-guarded /todos fails the build with "prerender-ineligible" and the
//      dev server keeps serving.
//
// Usage: node scripts/dev/smoke-prerender.mjs [--url http://127.0.0.1:5199/] [--keep-artifacts]
// Prerequisites: pnpm ide:wasm / ide:assets / ide:browser (docs/DEV.md), and the IDE action
// under test (prerender-run-action, preview-render-badge, the toasts) must have landed.
//
// UI contract assumed (issue #85 brief): testids prerender-run-action / preview-render-badge,
// toast substrings "Prerender ready in" and "prerender-ineligible" (matched as substrings so
// minor copy changes do not break the gate). The badge is accepted in the IDE preview panel
// OR in the framed document ("preview body" is ambiguous); whichever carries it is recorded.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, openPage } from "./cdp.mjs";
import { pruneSmokeArtifacts } from "./run-artifacts.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOOLING = process.env.FACILIS_TOOLING_DIR || "/tmp/facilis-dev";
const argValue = (name, fallback) => {
  const index = process.argv.indexOf("--" + name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const URL_ = argValue("url", process.env.STUDIO_URL || "");
// 5202: clear of smoke-ide (5199) and smoke-multitab (5201) so gates can run side by side.
const PORT = Number(process.env.SMOKE_PORT || 5202);
// Budgets mirror docs/DEV.md: boot 180 s, preview 300 s, framework probe 120 s.
const BOOT_TIMEOUT_MS = Number(process.env.BOOT_TIMEOUT_MS || 180000);
const PREVIEW_TIMEOUT_MS = Number(process.env.PREVIEW_TIMEOUT_MS || 300000);
const HEALTH_TIMEOUT_MS = Number(process.env.FACILIS_PROBE_TIMEOUT_MS || 120000);
// The in-VM build of 50 routes is the scaling question: generous wall-clock budgets, and
// the toast's own build seconds must stay under BUILD_BUDGET_S.
const BUILD_TOAST_TIMEOUT_MS = Number(process.env.PRERENDER_BUILD_TIMEOUT_MS || 600000);
const FAILURE_TOAST_TIMEOUT_MS = Number(process.env.PRERENDER_FAILURE_TIMEOUT_MS || 240000);
// Measured: a full client+SSR vite build of the ~50-route full-stack fixture takes
// ~17 s in-VM (DEV.md §6.2) - D-202's scaling question, answered. The ceiling guards a
// runaway; the diagnostics carry the measured number on every run.
const BUILD_BUDGET_S = 180;
const ARTIFACTS_ROOT = path.join(TOOLING, "smoke-artifacts");
const ARTIFACTS = process.env.SMOKE_ARTIFACTS || path.join(ARTIFACTS_ROOT, String(Date.now()));
const KEEP_ARTIFACTS = process.argv.includes("--keep-artifacts");
// A dev build installs the workspace packages locally by default (issue #41, D-196);
// FACILIS_IDE_LOCAL_PACKAGES=0 runs against a pinned npm release instead.
const LOCAL_PACKAGES = process.env.FACILIS_IDE_LOCAL_PACKAGES !== "0";
const CHROME = process.env.FACILIS_CHROME || path.join(TOOLING, "browser/chrome/chrome");
const SYSROOT = process.env.FACILIS_BROWSER_SYSROOT || path.join(TOOLING, "browser/sysroot");
const FONTCONFIG = process.env.FACILIS_FONTCONFIG || path.join(TOOLING, "browser/fonts.conf");
const PROJECT_NAME = "prerender-smoke";
const PROJECT_ROOT = "/home/user/projects/" + PROJECT_NAME;
const ROUTE_COUNT = 50;
const ROUTES = Array.from({ length: ROUTE_COUNT }, (_, i) => "/p" + String(i).padStart(2, "0"));
const MARKER_PREFIX = "facilis-prerender-marker-";
const markerFor = (route) => MARKER_PREFIX + route.slice(1);

const failures = [];
const checks = [];
const check = (ok, label, detail = "") => {
  console.log((ok ? "PASS " : "FAIL ") + label + (detail ? "  " + detail : ""));
  checks.push({ label, ok, detail });
  if (!ok) failures.push(label);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHttp(url, limitMs) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      /* server not listening yet */
    }
    await sleep(500);
  }
  throw new Error("dev server did not answer " + url + " within " + limitMs + "ms");
}

async function freePort(from) {
  for (let port = from; port < from + 20; port++) {
    const free = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port, "127.0.0.1");
    });
    if (free) return port;
  }
  throw new Error("no free port in " + from + ".." + (from + 19));
}

async function startDevServer() {
  if (URL_) return { url: URL_.endsWith("/") ? URL_ : URL_ + "/", child: null };
  const port = await freePort(PORT);
  const url = "http://127.0.0.1:" + port + "/";
  // detached + a negative-pid kill: signing off the pnpm wrapper alone leaves vite running,
  // which leaks the port and poisons the next run (smoke-ide.mjs).
  const child = spawn(
    "pnpm",
    [
      "--filter",
      "@facilis.dev/ide",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  let log = "";
  child.stdout.on("data", (chunk) => (log += chunk.toString()));
  child.stderr.on("data", (chunk) => (log += chunk.toString()));
  child.on("exit", (code) => {
    if (code !== 0) console.error("vite exited with " + code + "\n" + log.slice(-2000));
  });
  await waitForHttp(url, 120000);
  return { url, child, port };
}

function stopDevServer(child) {
  if (!child) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function waitFor(page, expression, limitMs, label) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    try {
      if (await page.evaluate(expression)) return true;
    } catch {
      /* navigating */
    }
    await sleep(500);
  }
  console.log("TIMEOUT " + label);
  return false;
}

const KERNEL_READY = "Boolean(window.__ide && window.__ide.getSnapshot().kernelReady)";
const bootMark = (name) =>
  "Boolean(window.__vvBoot && window.__vvBoot.some((m) => m.name === " +
  JSON.stringify(name) +
  "))";

// ── page-side helpers (expressions evaluated in the IDE document) ─────────────────────────

const clickText = (text, exact = false) =>
  "(() => { const els = [...document.querySelectorAll('button,[role=button],a,[role=tab]')];" +
  " const wanted = " +
  JSON.stringify(text) +
  ";" +
  " const hit = els.find((el) => { const s = (el.innerText || '').trim(); return " +
  String(exact) +
  " ? s === wanted : s.includes(wanted); });" +
  " if (!hit) return 'NOTFOUND'; hit.click(); return 'OK'; })()";

const clickAria = (label) =>
  "(() => { const b = [...document.querySelectorAll('button')].find(" +
  "(x) => (x.getAttribute('aria-label') || '') === " +
  JSON.stringify(label) +
  ");" +
  " if (!b) return 'NOTFOUND'; b.click(); return 'OK'; })()";

const clickTestId = (testId) =>
  "(() => { const el = document.querySelector('[data-testid=" +
  JSON.stringify(testId) +
  "]');" +
  " if (!el) return 'NOTFOUND'; el.click(); return 'OK'; })()";

// The preview iframe is the one whose src matches /preview/ (smoke-facilis.mjs). The framed
// document is same-origin, so contentDocument is the app itself — read #root too: a filled
// #root is the prerendered/hydrated body, an empty one the SPA shell before client render.
const PREVIEW_STATE =
  "(() => { const f = [...document.querySelectorAll('iframe')].find((x) => /preview/.test(x.src || ''));" +
  " if (!f) return { found: false, src: '', text: '', rootText: '', rootChildren: 0 };" +
  " let text = '', rootText = '', rootChildren = 0;" +
  " try { const doc = f.contentDocument;" +
  " if (doc && doc.body) text = doc.body.innerText || '';" +
  " const root = doc && doc.getElementById('root');" +
  " if (root) { rootText = root.innerText || ''; rootChildren = root.childElementCount; } }" +
  " catch { /* cross-origin or detached: poll again */ }" +
  " return { found: true, src: f.src || '', text: text.slice(0, 4000), rootText: rootText.slice(0, 4000), rootChildren }; })()";

// The render badge may sit in the IDE preview panel or in the framed document; accept either
// and record which one carried it (the brief says "preview body" without naming the document).
const BADGE_STATE =
  "(() => { const pick = (doc) => { const el = doc && doc.querySelector('[data-testid=\"preview-render-badge\"]');" +
  " return el ? (el.innerText || el.textContent || '').trim() : null; };" +
  " const ide = pick(document); let guest = null;" +
  " try { const f = [...document.querySelectorAll('iframe')].find((x) => /preview/.test(x.src || ''));" +
  " guest = pick(f && f.contentDocument); } catch { /* detached frame */ }" +
  " return { ide, guest }; })()";

const markerInRoot = (marker) =>
  "(() => { const f = [...document.querySelectorAll('iframe')].find((x) => /preview/.test(x.src || ''));" +
  " if (!f) return false; try { const r = f.contentDocument && f.contentDocument.getElementById('root');" +
  " return Boolean(r) && (r.innerText || '').includes(" +
  JSON.stringify(marker) +
  "); } catch { return false; } })()";

const previewHasText =
  "(() => { const f = [...document.querySelectorAll('iframe')].find((x) => /preview/.test(x.src || ''));" +
  " if (!f) return false; try { return ((f.contentDocument && f.contentDocument.body &&" +
  " f.contentDocument.body.innerText) || '').length > 0; } catch { return false; } })()";

const runActionEnabled =
  "(() => { const b = document.querySelector('[data-testid=\"prerender-run-action\"]');" +
  " return Boolean(b) && !b.disabled; })()";

const TERMINAL_TEXT =
  "(() => { try { const rows = [...document.querySelectorAll('.xterm-rows > div')].map((row) => row.textContent || '');" +
  " if (rows.length > 0) return rows.join(String.fromCharCode(10)).slice(-12000);" +
  " const host = document.querySelector('.xterm'); return host ? (host.textContent || '').slice(-12000) : '';" +
  " } catch { return ''; } })()";

async function readText(page, abs) {
  return page.evaluate(
    "window.__ide.bridge.request('vv-read', { path: " +
      JSON.stringify(abs) +
      " }).then((r) => (r.ok ? r.contents : null))",
  );
}

async function writeFile(page, abs, contents) {
  return page.evaluate(
    "window.__ide.bridge.request('vv-write', { path: " +
      JSON.stringify(abs) +
      ", contents: " +
      JSON.stringify(contents) +
      " }).then((r) => !!r.ok)",
  );
}

// One evaluate for the whole fixture: 52 bridge round-trips inside the page beat 52 CDP
// round-trips from Node, and the write order stays deterministic.
async function writeFiles(page, files) {
  return page.evaluate(
    "(async () => { const files = " +
      JSON.stringify(files) +
      "; const failed = [];" +
      " for (const f of files) { const r = await window.__ide.bridge.request('vv-write'," +
      " { path: f.path, contents: f.contents }); if (!r.ok) failed.push(f.path); }" +
      " return failed; })()",
  );
}

// The preview base keeps the kernel token OUT (query stripped) but stays on the IDE origin
// under /preview/<port>/, so the Service Worker routes the fetch into this tab's VM — the
// dev-base.ts / sameOriginPreviewUrl pattern smoke-facilis.mjs uses for its probes.
async function previewBase(page) {
  const state = await page.evaluate(PREVIEW_STATE);
  if (!state.found || !state.src) return "";
  try {
    const url = new URL(state.src);
    url.search = "";
    url.hash = "";
    return url.href.endsWith("/") ? url.href : url.href + "/";
  } catch {
    return "";
  }
}

// The content-type guard matters: before the SW routes the frame, the studio's own SPA
// fallback answers HTML on every path — a 200 alone would prove nothing (smoke-facilis.mjs).
async function waitForHealth(page, limitMs) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    const base = await previewBase(page).catch(() => "");
    if (base) {
      const ok = await page
        .evaluate(
          "fetch(" +
            JSON.stringify(base + "__facilis/health") +
            ').then((r) => r.ok && !(r.headers.get("content-type") || "").includes("text/html")).catch(() => false)',
        )
        .catch(() => false);
      if (ok === true) return base;
    }
    await sleep(500);
  }
  return "";
}

async function fetchHtml(page, url) {
  return page.evaluate(
    "(async () => { try { const r = await fetch(" +
      JSON.stringify(url) +
      ", { headers: { Accept: 'text/html' } });" +
      // The preview SW injects a ~30 KB CDP/WS shim into every HTML head: a small slice
      // would cut before the island, the marker and the shell's #root (issue #85 gate).
      " return { status: r.status, render: r.headers.get('x-facilis-render'), body: (await r.text()).slice(0, 200000) };" +
      " } catch (e) { return { error: String(e) }; } })()",
  );
}

async function waitForBadge(page, text, limitMs) {
  const until = Date.now() + limitMs;
  let last = { ide: null, guest: null };
  while (Date.now() < until) {
    try {
      last = await page.evaluate(BADGE_STATE);
      if (last.ide === text || last.guest === text) return { ...last, matched: true };
    } catch {
      /* navigating */
    }
    await sleep(250);
  }
  return { ...last, matched: false };
}

// On a toast timeout the answer lives in the BUILD terminal (a background tab) and the
// kernel's process table, not in the active dev terminal: capture both before failing.
async function captureStall(page, diagnostics) {
  await page.evaluate(clickText("prerender build")).catch(() => {});
  await sleep(600);
  diagnostics.terminalText = String((await page.evaluate(TERMINAL_TEXT)) || "").slice(-12000);
  diagnostics.vmProcs = await page
    .evaluate(
      "(async () => { try { const d = await window.__vv.diag();" +
        " return (d.procs || []).map((p) => [p.pid, (p.cmd || '').slice(0, 40)," +
        " Math.round((p.sinceOutputMs || 0) / 1000), p.booted].join('|')); }" +
        " catch (e) { return [String(e)]; } })()",
    )
    .catch(() => null);
  fs.writeFileSync(
    path.join(ARTIFACTS, "prerender-diagnostics.json"),
    JSON.stringify(diagnostics, null, 2),
  );
}

// Toasts are transient: poll fast (200 ms) and match the STABLE substring, not the full
// copy, so a wording tweak does not break the gate. Returns the matching line, or null.
async function waitForToast(page, substring, limitMs) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    try {
      const line = await page.evaluate(
        "(() => { const lines = (document.body.innerText || '').split('\\n');" +
          " const hit = lines.find((l) => l.includes(" +
          JSON.stringify(substring) +
          "));" +
          " return hit ? hit.trim().slice(0, 300) : null; })()",
      );
      if (line) return line;
    } catch {
      /* navigating */
    }
    await sleep(200);
  }
  return null;
}

// The graph panel re-analyzes on mount and on its toolbar refresh (ProjectGraphPanel.tsx);
// the refresh button is the same path the prerender toggle uses after a declaration write.
async function refreshAnalysis(page) {
  await page.evaluate("window.__ide.openProjectGraph()");
  const clicked = await page.evaluate(clickAria("Re-analyze the project"));
  if (clicked !== "OK") return false;
  // Let React flip the button to its disabled (refreshing) state before waiting it out.
  await sleep(400);
  return waitFor(
    page,
    "(() => { const b = [...document.querySelectorAll('button')].find(" +
      "(x) => (x.getAttribute('aria-label') || '') === 'Re-analyze the project');" +
      " return Boolean(b) && !b.disabled; })()",
    60000,
    "re-analysis",
  );
}

// The controller re-indexes the VFS ~60 ms after the last write (bumpTree), and the graph's
// source cache is keyed by the files-array identity: re-analyzing before the new index lands
// reads the OLD snapshot (stale app.tsx, missing pages). Stamp the pre-write array, then wait
// for a fresh one — with the new page present when the write created files.
async function waitForReindex(page, markerAbsPath) {
  return waitFor(
    page,
    "(() => { const f = window.__ide.getSnapshot().files;" +
      " if (f === window.__preWriteFiles) return false;" +
      (markerAbsPath
        ? " return f.some((p) => p === " + JSON.stringify(markerAbsPath) + ");"
        : " return true;") +
      " })()",
    30000,
    "VFS re-index",
  );
}

// The canvas surface ships an accessible mirror of the graph (#182): one real button per node,
// grouped by domain/lane inside an sr-only list. The overview button drills into its domain and
// selects the node, opening the inspector. The build is project-wide, so every page node offers
// the same action; the gate navigates the preview to the declared route it asserts afterwards.
async function selectAnyPageNode(page) {
  return waitFor(
    page,
    "(() => { const n = document.querySelector('[data-testid=\"project-graph-page\"]');" +
      " if (!n) return false; n.click(); return true; })()",
    30000,
    "a page node in the accessible graph list",
  );
}

// Product-faithful preview navigation (PreviewPanel's address bar uses the same session API).
async function navigatePreview(page, route) {
  return page.evaluate(
    "(() => { const s = window.__ide.getSnapshot();" +
      " const tab = s.previewTabs.find((t) => t.port !== null); if (!tab) return false;" +
      " window.__ide.preview.navigatePreviewPath(tab.id, " +
      JSON.stringify(route) +
      ");" +
      " return true; })()",
  );
}

// ── host-side helpers ──────────────────────────────────────────────────────────────────────

// Host proxy for the build's memory cost: the WebContainer runs inside Chrome's renderer, so
// the Chrome process tree's VmRSS bounds the guest's physical memory. The guest cannot report
// it itself (process.memoryUsage is emulated, __vv.diag heapBytes: -1 — docs/DEV.md §6.2).
function readTreeRssMB(pid) {
  if (process.platform !== "linux" || !pid) return null;
  try {
    const seen = new Set();
    const queue = [pid];
    let totalKB = 0;
    while (queue.length > 0) {
      const current = queue.shift();
      if (seen.has(current)) continue;
      seen.add(current);
      const status = fs.readFileSync("/proc/" + current + "/status", "utf8");
      const match = status.match(/^VmRSS:\s+(\d+) kB/m);
      if (match) totalKB += Number(match[1]);
      try {
        const children = fs
          .readFileSync("/proc/" + current + "/task/" + current + "/children", "utf8")
          .trim();
        if (children) for (const child of children.split(/\s+/)) queue.push(Number(child));
      } catch {
        /* leaf process: no children file */
      }
    }
    return Math.round(totalKB / 1024);
  } catch {
    return null;
  }
}

// main.tsx logs console.error("Recoverable hydration error:", error) via onRecoverableError;
// React's recoverable hydration failures are #418/#423/#425. attachPage instruments the
// console BEFORE the first navigation, and the preview is same-origin, so its entries land
// in the same accumulator — no extra listener is needed.
const HYDRATION_ERROR = /hydrat|#418|#423|#425/i;
function collectHydrationErrors(page) {
  const fromConsole = page.consoleEntries
    .filter((entry) => entry.type === "error" && HYDRATION_ERROR.test(entry.text))
    .map((entry) => entry.text);
  const fromExceptions = page.pageErrors.filter((text) => HYDRATION_ERROR.test(text));
  return fromConsole.concat(fromExceptions);
}

async function captureEvidence(page, diagnostics) {
  try {
    await page.screenshot(path.join(ARTIFACTS, "99-failure.png"));
    diagnostics.screenshot = "99-failure.png";
  } catch {
    // Evidence only: a screenshot failure must not change the verdict.
  }
  try {
    diagnostics.terminalText = String((await page.evaluate(TERMINAL_TEXT)) || "").slice(-12000);
  } catch {
    // Same: best effort.
  }
}

// ── deterministic fixture ──────────────────────────────────────────────────────────────────

// A fixture page is deliberately plain: no API calls, no guards, no t() — nothing that could
// differ between the build-time render and the client hydration render (D-202 eligibility:
// public, static, param-free, resolving to a src/pages/ component).
function fixturePageSource(index) {
  const id = "p" + String(index).padStart(2, "0");
  const component = "PageP" + String(index).padStart(2, "0");
  return (
    "// Static prerender fixture (smoke-prerender): no API calls, no guards, no locale\n" +
    "// dependency, so the build-time HTML and the client hydration render are identical.\n" +
    "export function " +
    component +
    "() {\n" +
    "  return (\n" +
    "    <div>\n" +
    "      <h1>Prerender fixture " +
    id +
    "</h1>\n" +
    "      <p>" +
    MARKER_PREFIX +
    id +
    "</p>\n" +
    "    </div>\n" +
    "  );\n" +
    "}\n"
  );
}

// Keep every template byte: anchor on the last page import and on the catch-all route (both
// survive the IDE's HMR-hint injection, template-overrides.ts). The fixture routes sit at the
// TOP level — outside AppLayout (which reads the session) and outside any guard — so the
// analyzer sees unambiguously public static pages. Null when an anchor is missing: fail
// closed rather than guess a route table (the prerender-declaration.ts principle).
function fixtureAppTsx(source) {
  const importAnchor = 'import { TodosPage } from "./pages/todos.tsx";';
  const routeAnchor = '        <Route path="*" element={<NotFoundPage />} />';
  if (!source.includes(importAnchor) || !source.includes(routeAnchor)) return null;
  const imports = ROUTES.map((route) => {
    const id = route.slice(1);
    return "import { Page" + id.toUpperCase() + ' } from "./pages/' + id + '.tsx";';
  }).join("\n");
  const routes = ROUTES.map((route) => {
    const id = route.slice(1);
    return '        <Route path="' + route + '" element={<Page' + id.toUpperCase() + " />} />";
  }).join("\n");
  return source
    .replace(importAnchor, importAnchor + "\n" + imports)
    .replace(routeAnchor, routes + "\n" + routeAnchor);
}

// Declare the fixture routes in the config's prerender allowlist. Since #161 the todo
// template ships its own prerender section: inserting a second `prerender:` key would be a
// duplicate object key and the LAST one (the template's) would silently win, so when a
// section exists its routes array is replaced in place. Without a section, insert one right
// after defineConfig's opening brace — the same insertion point setConfigPrerenderRoute uses
// (prerender-declaration.ts). Every other byte of the generated config is preserved (it
// carries the VM nitro runner override, not the example's). Null on a missing anchor: fail
// closed rather than guess (the prerender-declaration.ts principle).
function fixtureConfig(source) {
  const entries = ROUTES.map((route) => '      "' + route + '",').join("\n");
  const existing = source.match(/prerender:\s*\{\s*routes:\s*\[/);
  if (existing) {
    const open = existing.index + existing[0].length;
    const close = source.indexOf("]", open);
    if (close === -1) return null;
    return source.slice(0, open) + "\n" + entries + "\n    " + source.slice(close);
  }
  const anchor = "export default defineConfig({";
  if (!source.includes(anchor)) return null;
  const section = "\n  prerender: {\n    routes: [\n" + entries + "\n    ],\n  },";
  return source.replace(anchor, anchor + section);
}

// Failure path: declare the RequireAuth-guarded /todos. The route array's shape is the one
// fixtureConfig wrote, so the insertion anchor is deterministic.
function addGuardedRoute(source) {
  const match = source.match(/prerender:\s*\{\s*routes:\s*\[/);
  if (!match) return null;
  const at = match.index + match[0].length;
  return source.slice(0, at) + '\n      "/todos",' + source.slice(at);
}

// ── the run ────────────────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  console.log("artifacts: " + ARTIFACTS);

  // The dev route serves the packages' built dist/, so build the workspace packages first
  // (issue #41). Skipped when reusing an external server (--url): the operator owns its build.
  if (LOCAL_PACKAGES && !URL_) {
    console.log("building workspace packages for the local install...");
    const build = spawnSync("pnpm", ["exec", "turbo", "run", "build", "--filter=./packages/*"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
    if (build.status !== 0) throw new Error("workspace package build failed before the smoke");
  }

  const dev = await startDevServer();
  console.log("studio url: " + dev.url);
  if (!fs.existsSync(CHROME))
    throw new Error("chrome not found: " + CHROME + " (run scripts/dev/fetch-browser.sh)");
  const chrome = await launchChrome({
    chrome: CHROME,
    profileDir: path.join(ARTIFACTS, "profile"),
    homeDir: path.join(ARTIFACTS, "home"),
    sysroot: fs.existsSync(SYSROOT) ? SYSROOT : "",
    fontconfigFile: fs.existsSync(FONTCONFIG) ? FONTCONFIG : "",
  });
  const diagnostics = {
    routes: ROUTE_COUNT,
    buildSeconds: null,
    rssBeforeMB: null,
    rssAfterMB: null,
  };
  let page = null;
  try {
    page = await openPage(chrome.client, dev.url);

    // ---- 1. boot + create the full-stack project through the dialog --------------------
    check(await waitFor(page, KERNEL_READY, BOOT_TIMEOUT_MS, "kernel"), "IDE kernel boots");
    check((await page.evaluate(clickText("New project"))) === "OK", "new-project dialog opens");
    await sleep(400);
    const named = await page.evaluate(
      "(() => { const input = document.querySelector('input[placeholder=my-app]');" +
        " if (!input) return 'NOTFOUND';" +
        " const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;" +
        " set.call(input, " +
        JSON.stringify(PROJECT_NAME) +
        ");" +
        " input.dispatchEvent(new Event('input', { bubbles: true })); return 'OK'; })()",
    );
    check(named === "OK", "project name filled");
    const createReady = await waitFor(
      page,
      "Boolean([...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Create' && !b.disabled))",
      15000,
      "Create enabled",
    );
    check(createReady, "'Create' button enabled");
    let created = false;
    if (createReady) {
      // install-start doubles as "the Create handler fired"; retrying the click is cheaper
      // than a 5-minute preview timeout that looks like a product bug (smoke-ide.mjs).
      for (let attempt = 0; attempt < 2 && !created; attempt++) {
        await page.evaluate(clickText("Create", true));
        created = await waitFor(page, bootMark("install-start"), 15000, "install-start");
      }
    }
    check(created, "todo project created through the dialog");
    check(
      await waitFor(
        page,
        "window.__ide.getSnapshot().workspaceFolders.some((f) => f.rootPath === " +
          JSON.stringify(PROJECT_ROOT) +
          ")",
        60000,
        "project open",
      ),
      "project opens at " + PROJECT_ROOT,
    );
    check(
      await waitFor(page, bootMark("preview-paint"), PREVIEW_TIMEOUT_MS, "preview paint"),
      "dev server paints the preview",
    );
    const base = await waitForHealth(page, HEALTH_TIMEOUT_MS);
    check(base !== "", "dev server answers __facilis/health (JSON, not the SPA fallback)");
    if (base === "") throw new Error("no serving preview: cannot continue");
    await page.screenshot(path.join(ARTIFACTS, "01-boot.png"));

    // ---- 2. the scaling fixture: 50 public static pages, declared ----------------------
    const appSource = await readText(page, PROJECT_ROOT + "/src/app.tsx");
    const configSource = await readText(page, PROJECT_ROOT + "/facilis.config.ts");
    check(
      typeof appSource === "string" && typeof configSource === "string",
      "template app.tsx and facilis.config.ts readable through the VFS",
    );
    const nextApp = typeof appSource === "string" ? fixtureAppTsx(appSource) : null;
    const nextConfig = typeof configSource === "string" ? fixtureConfig(configSource) : null;
    check(nextApp !== null, "fixture routes anchored into the template route table");
    check(nextConfig !== null, "prerender section anchored into facilis.config.ts");
    if (nextApp === null || nextConfig === null) throw new Error("fixture anchors missing");
    const files = ROUTES.map((route, index) => ({
      path: PROJECT_ROOT + "/src/pages/" + route.slice(1) + ".tsx",
      contents: fixturePageSource(index),
    }));
    files.push({ path: PROJECT_ROOT + "/src/app.tsx", contents: nextApp });
    files.push({ path: PROJECT_ROOT + "/facilis.config.ts", contents: nextConfig });
    await page.evaluate("window.__preWriteFiles = window.__ide.getSnapshot().files");
    const failedWrites = await writeFiles(page, files);
    check(
      Array.isArray(failedWrites) && failedWrites.length === 0,
      "fixture written through the kernel VFS (" + files.length + " files)",
      Array.isArray(failedWrites) ? failedWrites.join(",") : String(failedWrites),
    );
    check(
      await waitForReindex(page, PROJECT_ROOT + "/src/pages/p00.tsx"),
      "VFS re-index lists the fixture pages",
    );
    check(await refreshAnalysis(page), "graph re-analyzes after the fixture writes");
    // The stats line is derived from the whole view model; the DOM card count is not
    // (React Flow culls off-viewport cards), so assert the fixture through the stats.
    check(
      await waitFor(
        page,
        "(() => { const m = document.body.innerText.match(/(\\d+) pages/);" +
          " return m ? Number(m[1]) : 0; })() >= " +
          ROUTE_COUNT,
        60000,
        "fixture pages in graph stats",
      ),
      "graph stats report the " + ROUTE_COUNT + " fixture pages",
    );
    await page.screenshot(path.join(ARTIFACTS, "02-fixture-graph.png"));

    // ---- 3. run the prerender build from the page satellite ----------------------------
    check(await selectAnyPageNode(page), "a page node selected in the graph");
    const actionReady = await waitFor(page, runActionEnabled, 15000, "run action enabled");
    check(actionReady, "prerender-run-action offered on the page satellite");
    if (!actionReady) throw new Error("prerender-run-action not available");
    diagnostics.rssBeforeMB = readTreeRssMB(chrome.child.pid);
    const startedAt = Date.now();
    await page.evaluate(clickTestId("prerender-run-action"));
    // While the managed terminal installs/builds, the action is disabled (UI contract).
    check(
      await waitFor(
        page,
        "(() => { const b = document.querySelector('[data-testid=\"prerender-run-action\"]');" +
          " return Boolean(b) && b.disabled; })()",
        10000,
        "action disabled while building",
      ),
      "action disabled while the build runs",
    );
    diagnostics.buildingLabel = await page
      .evaluate(
        "(() => { const b = document.querySelector('[data-testid=\"prerender-run-action\"]');" +
          " return b ? (b.innerText || '').trim().slice(0, 120) : null; })()",
      )
      .catch(() => null);
    const toast = await waitForToast(page, "Prerender ready in", BUILD_TOAST_TIMEOUT_MS);
    diagnostics.buildWallMs = Date.now() - startedAt;
    diagnostics.successToast = toast;
    check(
      toast !== null,
      "success toast 'Prerender ready in' appears",
      toast || "timeout after " + BUILD_TOAST_TIMEOUT_MS + "ms",
    );
    if (toast === null) await captureStall(page, diagnostics);
    const secondsMatch =
      toast === null ? null : toast.match(/Prerender ready in\s+(\d+(?:\.\d+)?)\s*s/);
    diagnostics.buildSeconds = secondsMatch ? Number(secondsMatch[1]) : null;
    check(diagnostics.buildSeconds !== null, "toast carries the build seconds", toast || "");
    check(
      diagnostics.buildSeconds !== null && diagnostics.buildSeconds < BUILD_BUDGET_S,
      ROUTE_COUNT + "-route in-VM build under " + BUILD_BUDGET_S + "s (D-202 scaling)",
      diagnostics.buildSeconds === null ? "no seconds parsed" : diagnostics.buildSeconds + "s",
    );
    diagnostics.rssAfterMB = readTreeRssMB(chrome.child.pid);
    if (diagnostics.rssBeforeMB === null || diagnostics.rssAfterMB === null) {
      console.log(
        "NOTE: host RSS proxy unavailable; guest memory is unobservable in-VM (DEV.md §6.2)",
      );
    }
    fs.writeFileSync(
      path.join(ARTIFACTS, "prerender-diagnostics.json"),
      JSON.stringify(diagnostics, null, 2),
    );
    await page.screenshot(path.join(ARTIFACTS, "03-build-done.png"));

    // ---- 4. the preview hydrates the prerendered HTML ----------------------------------
    // The action opened the preview on the selected page; assert the declared route itself.
    check(await navigatePreview(page, "/p00"), "preview navigates to /p00");
    const opened = await waitFor(
      page,
      "(() => { const f = [...document.querySelectorAll('iframe')].find((x) => /preview/.test(x.src || ''));" +
        " if (!f) return false; try { return new URL(f.src).pathname.endsWith('/p00'); } catch { return false; } })()",
      60000,
      "preview opens /p00",
    );
    check(opened, "the preview shows /p00");
    check(
      await waitFor(page, markerInRoot(markerFor("/p00")), 60000, "hydration marker"),
      "preview #root hydrates the prerendered marker",
    );
    const badge = await waitForBadge(page, "Prerendered", 30000);
    check(badge.matched, "preview badge reads 'Prerendered'", JSON.stringify(badge));
    const served = await fetchHtml(page, base + "p00");
    check(
      served.status === 200,
      "declared route answers 200 to an HTML navigation",
      JSON.stringify({ status: served.status, error: served.error }),
    );
    check(
      served.render === "prerender",
      "x-facilis-render: prerender on the declared route",
      String(served.render),
    );
    check(
      typeof served.body === "string" && served.body.includes('id="prerender-data"'),
      "prerendered HTML carries the prerender-data island",
    );
    check(
      typeof served.body === "string" && served.body.includes(markerFor("/p00")),
      "prerendered HTML carries the page marker",
    );
    const hydrationErrors = collectHydrationErrors(page);
    check(
      hydrationErrors.length === 0,
      "zero recoverable hydration errors (React #418/#423/#425)",
      hydrationErrors.slice(0, 3).join(" | "),
    );

    // ---- 5. an UNdeclared route stays the SPA shell -------------------------------------
    const shell = await fetchHtml(page, base + "todos");
    check(
      shell.status === 200,
      "undeclared /todos answers 200",
      String(shell.status ?? shell.error),
    );
    check(shell.render === null, "no x-facilis-render header on the shell", String(shell.render));
    check(
      typeof shell.body === "string" && /<div id="root">\s*<\/div>/.test(shell.body),
      "shell HTML has the empty #root",
    );
    check(await navigatePreview(page, "/todos"), "preview navigates to /todos");
    const shellBadge = await waitForBadge(page, "SPA shell", 30000);
    check(
      shellBadge.matched,
      "preview badge reads 'SPA shell' on the undeclared route",
      JSON.stringify(shellBadge),
    );
    await page.screenshot(path.join(ARTIFACTS, "04-shell.png"));

    // ---- 6. declaring an auth-guarded route fails the build, server survives -----------
    const currentConfig = await readText(page, PROJECT_ROOT + "/facilis.config.ts");
    const guardedConfig = typeof currentConfig === "string" ? addGuardedRoute(currentConfig) : null;
    check(guardedConfig !== null, "auth-guarded /todos added to prerender.routes");
    if (guardedConfig !== null) {
      await page.evaluate("window.__preWriteFiles = window.__ide.getSnapshot().files");
      check(
        await writeFile(page, PROJECT_ROOT + "/facilis.config.ts", guardedConfig),
        "guarded declaration written through the VFS",
      );
      check(await waitForReindex(page, null), "VFS re-index after the guarded declaration");
      check(await refreshAnalysis(page), "graph re-analyzes the guarded declaration");
      // The step-3 selection survives the re-analysis; the canvas culls cards, so do not
      // depend on re-selecting one here - the satellite still offers the project-wide action.
      const rearmed = await waitFor(page, runActionEnabled, 15000, "run action re-enabled");
      check(rearmed, "prerender-run-action enabled again");
      if (rearmed) {
        await page.evaluate(clickTestId("prerender-run-action"));
        const errorToast = await waitForToast(
          page,
          "prerender-ineligible",
          FAILURE_TOAST_TIMEOUT_MS,
        );
        diagnostics.failureToast = errorToast;
        check(
          errorToast !== null,
          "error toast carries 'prerender-ineligible'",
          errorToast || "timeout after " + FAILURE_TOAST_TIMEOUT_MS + "ms",
        );
        if (errorToast === null) await captureStall(page, diagnostics);
      }
    }
    // Reuse the ROOT base captured at boot: previewBase() derives from the iframe's
    // current path, which is /todos now - health lives at the server root only.
    const healthAfter = await page.evaluate(
      "fetch(" +
        JSON.stringify(base + "__facilis/health") +
        ').then((r) => r.ok && !(r.headers.get("content-type") || "").includes("text/html")).catch(() => false)',
    );
    check(healthAfter === true, "dev server still answers __facilis/health after the failed build");
    check(
      await waitFor(page, previewHasText, 30000, "preview still loads"),
      "preview still loads after the failed build (dev server unaffected)",
    );
    await page.screenshot(path.join(ARTIFACTS, "05-final.png"));
    if (failures.length > 0) await captureEvidence(page, diagnostics);
    fs.writeFileSync(
      path.join(ARTIFACTS, "prerender-diagnostics.json"),
      JSON.stringify(diagnostics, null, 2),
    );
    fs.writeFileSync(
      path.join(ARTIFACTS, "report.json"),
      JSON.stringify({ url: dev.url, checks, failures, diagnostics }, null, 2),
    );
  } catch (error) {
    check(false, "smoke ran to completion", String(error));
    if (page) await captureEvidence(page, diagnostics);
    try {
      fs.writeFileSync(
        path.join(ARTIFACTS, "prerender-diagnostics.json"),
        JSON.stringify(diagnostics, null, 2),
      );
      fs.writeFileSync(
        path.join(ARTIFACTS, "report.json"),
        JSON.stringify({ url: dev.url, checks, failures, diagnostics }, null, 2),
      );
    } catch {
      // Evidence only.
    }
  } finally {
    chrome.client.close();
    chrome.child.kill("SIGKILL");
    stopDevServer(dev.child);
  }
  pruneSmokeArtifacts({
    root: ARTIFACTS_ROOT,
    artifacts: ARTIFACTS,
    keepArtifacts: KEEP_ARTIFACTS,
  });
  if (failures.length > 0) {
    console.error("\nPRERENDER SMOKE FAILED (" + failures.length + "): " + failures.join(", "));
    process.exit(1);
  }
  console.log("\nPRERENDER SMOKE PASSED - artifacts in " + ARTIFACTS);
}

await main();
