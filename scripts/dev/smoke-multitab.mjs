// IDE multi-tab smoke test: two projects, two browser tabs, one kernel per tab.
//
// This is the acceptance run for the "several projects at once" feature. It drives the
// real Studio through CDP and asserts the four things that only break with two tabs:
//   1. each tab's preview is served by ITS kernel (both dev servers bind 3000 in their
//      own VM, so the port in the URL identifies nothing — the SW routes by preview frame);
//   2. the per-origin OPFS index survives two kernels mirroring into it (a write in one
//      tab used to drop the other tab's whole project from the index);
//   3. one project cannot be open in two tabs (a Web Lock, surfaced as a toast);
//   4. "open in a new tab" from Home boots the new tab straight onto that project;
//   5. the recent-projects registry is per origin, so a project created in one tab is not
//      dropped by another tab writing its own (stale) list over it.
//   6. a tab's boot restore defers every project Home knows about and hydrates one only
//      when its tab opens it (BootOptions.deferRestoreRoots): the files come back, and a
//      project the tab never opened stays out of its VFS.
//   7. a tab holds ONE project: opening another replaces the tab's root instead of stacking
//      a second one, and the label is the folder name, never a form/kernel title (D-035);
//      the replaced project's dev server goes with its folder (no phantom Ports row).
//
// Usage: node scripts/dev/smoke-multitab.mjs [--url http://127.0.0.1:5199/] [--keep-artifacts]
//
// Retention matches scripts/dev/smoke-ide.mjs: the newest SMOKE_KEEP_RUNS (default 5)
// dirs are kept and older ones are pruned at the end of a run unless --keep-artifacts or
// a pinned SMOKE_ARTIFACTS skips pruning (scripts/dev/run-artifacts.mjs).
//
// Prerequisites are the same as scripts/dev/smoke-ide.mjs (docs/DEV.md): the wasm kernel,
// the vendored assets and a fetched browser. Exit code 0 = all checks passed.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachPage, launchChrome, openPage } from "./cdp.mjs";
import { pruneSmokeArtifacts } from "./run-artifacts.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOOLING = process.env.FACILIS_TOOLING_DIR || "/tmp/facilis-dev";
const argValue = (name, fallback) => {
  const index = process.argv.indexOf("--" + name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const URL_ = argValue("url", process.env.STUDIO_URL || "");
const PORT = Number(process.env.SMOKE_PORT || 5201);
const BOOT_TIMEOUT_MS = Number(process.env.BOOT_TIMEOUT_MS || 180000);
const PREVIEW_TIMEOUT_MS = Number(process.env.PREVIEW_TIMEOUT_MS || 240000);
const BUILD_TIMEOUT_MS = Number(process.env.BUILD_TIMEOUT_MS || 240000);
const ARTIFACTS_ROOT = path.join(TOOLING, "smoke-multitab");
const ARTIFACTS = process.env.SMOKE_ARTIFACTS || path.join(ARTIFACTS_ROOT, String(Date.now()));
const KEEP_ARTIFACTS = process.argv.includes("--keep-artifacts");
const CHROME = process.env.FACILIS_CHROME || path.join(TOOLING, "browser/chrome/chrome");
const SYSROOT = process.env.FACILIS_BROWSER_SYSROOT || path.join(TOOLING, "browser/sysroot");
const FONTCONFIG = process.env.FACILIS_FONTCONFIG || path.join(TOOLING, "browser/fonts.conf");
const ALPHA = "/home/user/projects/alpha";
const BETA = "/home/user/projects/beta";
const GAMMA = "/home/user/projects/gamma";
const DOCS = "/home/user/projects/docs";

// The creation path the IDE ships (D-051/D-168), not a vanilla Vite template: alpha is
// the default todo project (its preview is the login page) and beta is the static
// showcase (its preview is the studio home). The two previews must stay DIFFERENT so
// content proves which kernel served the frame — both manifests bind port 3000.
const TODO_PREVIEW = /Log in/;
const SHOWCASE_PREVIEW = /We design brands people remember/;
// The docs home hero is the settle mark: the sidebar tree sits in a collapsed details at
// the headless viewport (800x600 < lg), so innerText never shows it — textContent does.
const DOCS_PREVIEW = /Docs your readers can navigate/;

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

const projectUrl = (base, rootPath) => base + "?project=" + encodeURIComponent(rootPath);

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

async function snapshot(page) {
  return page.evaluate(
    "(() => { const s = window.__ide.getSnapshot(); return {" +
      " folders: s.workspaceFolders.map((f) => f.rootPath)," +
      " title: s.projectTitle," +
      " kernelReady: s.kernelReady," +
      " marks: (window.__vvBoot || []).map((m) => m.name)," +
      " docTitle: document.title }; })()",
  );
}

// The framed document's text, which is what a user sees. Same-origin previews only.
async function preview(page) {
  return page.evaluate(
    "(() => { const f = [...document.querySelectorAll('iframe')].find((f) => /preview/.test(f.src || ''));" +
      " if (!f) return { found: false, text: '', src: '' };" +
      " let text = ''; try { text = (f.contentDocument && f.contentDocument.body && f.contentDocument.body.innerText) || ''; } catch (e) { text = 'ERR ' + e; }" +
      " return { found: true, src: f.src, text: text.slice(0, 400) }; })()",
  );
}

// The Facilis app boots through a session probe and a redirect: the first paint can be
// the shell with an EMPTY outlet (Navigate renders nothing while /login mounts), so the
// content is polled until it settles — a vanilla template's static first paint hid this.
async function waitForPreview(page, pattern, limitMs, label) {
  const until = Date.now() + limitMs;
  let last = { found: false, text: "", src: "" };
  while (Date.now() < until) {
    last = await preview(page);
    if (last.found && pattern.test(last.text)) return last;
    await sleep(500);
  }
  console.log("TIMEOUT " + label);
  return last;
}

async function reloadPreview(page) {
  return page.evaluate(
    "(() => { const f = [...document.querySelectorAll('iframe')].find((f) => /preview/.test(f.src || ''));" +
      " if (!f) return false; f.src = f.src.split('?')[0] + '?r=' + Date.now(); return true; })()",
  );
}

// An in-VM `npm run build` through the kernel's generic spawn channel — the same
// mechanism the framework gate's install postflight uses (framework-gate.ts), without a
// terminal tab. The build writes the .facilis/prerender.json stamp the dev middleware
// serves stored HTML from (D-202 §5), so a prerender serving check must build first.
// Resolves on proc-exit; the output tail carries the framework failure code (e.g.
// prerender-ineligible) when the build fails, and a timeout resolves instead of hanging.
async function runInVmBuild(page, root, execId) {
  return page.evaluate(
    "(async () => { const b = window.__ide.bridge;" +
      " return await new Promise((resolve) => {" +
      " let tail = '';" +
      " const id = " + JSON.stringify(execId) + ";" +
      " const offOut = b.on('proc-out', (m) => { if (m.execId === id && typeof m.chunk === 'string') tail = (tail + m.chunk).slice(-2000); });" +
      " const offExit = b.on('proc-exit', (m) => { if (m.execId !== id) return; clearTimeout(timer); offOut(); offExit(); resolve({ code: Number(m.code), timeout: false, tail }); });" +
      " const timer = setTimeout(() => { offOut(); offExit(); resolve({ code: null, timeout: true, tail }); }, " + BUILD_TIMEOUT_MS + ");" +
      " b.post('proc-spawn', { execId: id, command: 'npm', args: ['run', 'build'], cwd: " + JSON.stringify(root) + " });" +
      " }); })()",
  );
}

// The raw HTML the dev server serves for a preview path, fetched FROM WITHIN the preview
// iframe: the Service Worker routes a request by the client (frame) that issued it
// (routeByClient in ide/public/sw.js, D-132), so a fetch from the IDE page would not reach
// this tab's kernel. The Accept header marks it as an HTML navigation for the prerender
// dev middleware. The port comes from the frame's own /preview/<port>/ URL.
async function previewHtml(page, path) {
  return page.evaluate(
    "(async () => { const f = [...document.querySelectorAll('iframe')].find((f) => /preview/.test(f.src || ''));" +
      " if (!f || !f.contentWindow) return { found: false, status: 0, body: '' };" +
      " const m = (f.src || '').match(/\\/preview\\/(\\d+)\\//);" +
      " if (!m) return { found: false, status: 0, body: '' };" +
      " try { const r = await f.contentWindow.fetch(location.origin + '/preview/' + m[1] + " + JSON.stringify(path) + ", { headers: { Accept: 'text/html' } });" +
      " const body = await r.text();" +
      " return { found: true, status: r.status, body: body.slice(0, 40000) }; }" +
      " catch (e) { return { found: true, status: 0, body: 'ERR ' + e }; } })()",
  );
}

// `dir` is optional so a check can prove the label follows the DIRECTORY, not the form
// name: the tab is given one and then labelled by the other (D-035). `template` is the
// registry key (D-168); omitted means the default todo template, exactly like Home.
async function createProject(page, name, runInit, dir, template) {
  const target = dir ? JSON.stringify(dir) : "c.defaultDirFor(" + JSON.stringify(name) + ")";
  const input =
    "{ dir, runInit: " +
    (runInit ? "true" : "false") +
    (template ? ", template: " + JSON.stringify(template) : "") +
    " }";
  return page.evaluate(
    "(async () => { const c = window.__ide;" +
      " const dir = " +
      target +
      ";" +
      " await c.createProject(" +
      input +
      ");" +
      " return dir; })()",
  );
}

async function closeFolder(page, rootPath) {
  return page.evaluate("window.__ide.closeFolder(" + JSON.stringify("wf:" + rootPath) + ")");
}

async function readText(page, abs) {
  return page.evaluate(
    "window.__ide.bridge.request('vv-read', { path: " +
      JSON.stringify(abs) +
      " }).then((r) => (r.ok ? r.contents : null))",
  );
}

async function writeProbe(page, abs, contents) {
  return page.evaluate(
    "window.__ide.bridge.request('vv-write', { path: " +
      JSON.stringify(abs) +
      ", contents: " +
      JSON.stringify(contents) +
      " }).then((r) => !!r.ok)",
  );
}

async function stat(page, abs) {
  return page.evaluate(
    "window.__ide.bridge.request('vv-stat', { path: " +
      JSON.stringify(abs) +
      " }).then((r) => ({ ok: !!r.ok, exists: !!r.exists }))",
  );
}

// Wait for an existence, not for a single sample: JS in the OLD document keeps answering
// Runtime.evaluate for a moment after Page.reload, so "kernelReady" can be the previous
// boot's. The caller first proves it is the new document (timeOrigin changed), then this
// bounds how long a legitimately-slow restore may take.
async function waitForPath(page, abs, limitMs) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    try {
      if ((await stat(page, abs)).exists) return true;
    } catch {
      /* navigating */
    }
    await sleep(500);
  }
  return false;
}

async function flushMirror(page) {
  await page.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
  await sleep(1500);
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  console.log("artifacts: " + ARTIFACTS);
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
  const tabs = [];
  try {
    // ---- tab A: the default todo project, running -----------------------------------
    const tabA = await openPage(chrome.client, dev.url);
    tabs.push(tabA);
    check(await waitFor(tabA, KERNEL_READY, BOOT_TIMEOUT_MS, "A kernel"), "tab A boots its kernel");
    const dirA = await createProject(tabA, "alpha", true);
    check(dirA === ALPHA, "tab A creates alpha", dirA);
    const paramAfterCreate = await tabA.evaluate(
      "new URLSearchParams(location.search).get('project')",
    );
    check(
      paramAfterCreate === ALPHA,
      "opening a project names it in the tab's URL (a reload lands back on it)",
      String(paramAfterCreate),
    );
    const paintedA = await waitFor(
      tabA,
      "Boolean(window.__vvBoot && window.__vvBoot.some((m) => m.name === 'preview-paint'))",
      PREVIEW_TIMEOUT_MS,
      "A preview",
    );
    check(paintedA, "tab A runs alpha and paints its preview");
    const prevA = await waitForPreview(tabA, TODO_PREVIEW, 30000, "A login content");
    check(
      prevA.found && TODO_PREVIEW.test(prevA.text),
      "tab A preview is the todo app's login page",
      prevA.text.slice(0, 60),
    );

    // The run belongs to the open folder: alpha's row is what the replacement has to clear.
    const alphaPorts = await tabA.evaluate("window.__ide.getSnapshot().ports.map((p) => p.port)");
    check(alphaPorts.length === 1, "alpha's dev server is in the Ports view", String(alphaPorts));

    // A second project, created here and RUN: it must reach OPFS (so tab B can open it)
    // without being claimed by this tab. Creating it also proves one project per tab
    // (D-035): beta REPLACES alpha in this tab instead of stacking a second root, and the
    // replaced project's run goes with its folder — no phantom Ports row (two live
    // listeners would bind two ports) and no preview tab bound to a server that is gone.
    const dirB = await createProject(tabA, "beta", true, undefined, "showcase");
    check(dirB === BETA, "tab A creates beta", dirB);
    const afterBeta = await snapshot(tabA);
    check(
      afterBeta.folders.length === 1 && afterBeta.folders[0] === BETA,
      "a tab holds one project: creating beta replaced alpha",
      afterBeta.folders.join(","),
    );
    check(
      afterBeta.title === "beta",
      "the tab labels the project by its folder name",
      afterBeta.title,
    );
    // D-124: replacing a project closes its run terminal; the fallback switch to the
    // boot shell must not pop the bottom panel open. An open panel collapsed the
    // project-graph canvas at this viewport and culled the todos node (issue #180).
    check(
      await tabA.evaluate("window.__ide.getSnapshot().panelCollapsed === true"),
      "replacing a project does not open the bottom panel (D-124)",
    );
    const betaUp = await waitFor(
      tabA,
      "window.__ide.getSnapshot().ports.length === 1" +
        " && window.__ide.getSnapshot().previewTabs.length === 1",
      PREVIEW_TIMEOUT_MS,
      "beta preview",
    );
    check(betaUp, "beta runs after replacing alpha in the same tab");
    const betaPorts = await tabA.evaluate("window.__ide.getSnapshot().ports.map((p) => p.port)");
    check(
      betaPorts.length === 1,
      "the replaced project's dev server stopped: one Ports row, not two",
      JSON.stringify({ before: alphaPorts, after: betaPorts }),
    );
    const betaPreviews = await tabA.evaluate(
      "window.__ide.getSnapshot().previewTabs.map((t) => t.port)",
    );
    check(
      betaPreviews.length === 1 && betaPreviews[0] === betaPorts[0],
      "the preview panel kept only the open project's tab",
      JSON.stringify(betaPreviews),
    );
    await closeFolder(tabA, BETA);
    await flushMirror(tabA);
    check((await snapshot(tabA)).folders.length === 0, "beta is created but not open in tab A");
    check(
      (await tabA.evaluate("window.__ide.getSnapshot().ports.length")) === 0,
      "closing the tab's project stops its dev server: no Ports row stays behind",
    );
    check(
      (await tabA.evaluate("window.__ide.getSnapshot().previewTabs.length")) === 0,
      "closing the tab's project closes its preview tab",
    );
    check(
      (await tabA.evaluate("new URLSearchParams(location.search).get('project')")) === null,
      "a tab with no project drops its ?project=",
    );
    // The refusal test below needs tab A holding alpha again — and RUNNING again: the run
    // that was serving alpha died with the folder it belonged to (checked above). Reopen it
    // the way Home does (a recent row), so the run manifest is registered before Run.
    await tabA.evaluate(
      "(async () => { const c = window.__ide;" +
        " const meta = c.getSnapshot().recentProjects.find((p) => p.rootPath === " +
        JSON.stringify(ALPHA) +
        ");" +
        " await c.openProject(meta);" +
        " c.runProject(meta.rootPath); })()",
    );
    check(
      await waitFor(
        tabA,
        "window.__ide.getSnapshot().workspaceFolders.length === 1",
        15000,
        "A reopens alpha",
      ),
      "alpha reopens in tab A",
    );
    check(
      (await tabA.evaluate("new URLSearchParams(location.search).get('project')")) === ALPHA,
      "the URL follows the tab's active project",
    );
    check(
      await waitFor(
        tabA,
        "window.__ide.getSnapshot().ports.length === 1" +
          " && window.__ide.getSnapshot().previewTabs.length === 1",
        PREVIEW_TIMEOUT_MS,
        "A reruns alpha",
      ),
      "alpha runs again after being reopened",
    );


    // ---- tab B: beta, opened by URL in its own kernel ----------------------
    const tabB = await openPage(chrome.client, projectUrl(dev.url, BETA));
    tabs.push(tabB);
    check(
      await waitFor(tabB, KERNEL_READY, BOOT_TIMEOUT_MS, "B kernel"),
      "tab B boots its own kernel",
    );
    check(
      await waitFor(
        tabB,
        "window.__ide.getSnapshot().workspaceFolders.length === 1",
        60000,
        "B opens beta",
      ),
      "?project= opens beta in tab B",
    );
    const paintedB = await waitFor(
      tabB,
      "Boolean(window.__vvBoot && window.__vvBoot.some((m) => m.name === 'preview-paint'))",
      PREVIEW_TIMEOUT_MS,
      "B preview",
    );
    check(paintedB, "tab B runs beta and paints its preview");
    const prevB = await waitForPreview(tabB, SHOWCASE_PREVIEW, 30000, "B showcase content");
    check(
      prevB.found && SHOWCASE_PREVIEW.test(prevB.text),
      "tab B preview is the showcase app",
      prevB.text.slice(0, 60),
    );
    const snapB = await snapshot(tabB);
    check(/beta/.test(snapB.docTitle), "tab B's browser title names beta", snapB.docTitle);

    // ---- routing: both previews still theirs, after both kernels exist ----
    const prevA2 = await waitForPreview(tabA, TODO_PREVIEW, 30000, "A content with B running");
    check(TODO_PREVIEW.test(prevA2.text), "tab A preview stays the todo app with B running");
    check(!SHOWCASE_PREVIEW.test(prevA2.text), "tab A did not pick up tab B's kernel");
    await reloadPreview(tabA);
    await sleep(5000);
    const prevA3 = await waitForPreview(tabA, TODO_PREVIEW, 30000, "A reloaded content");
    check(
      TODO_PREVIEW.test(prevA3.text) && !SHOWCASE_PREVIEW.test(prevA3.text),
      "a reloaded preview in tab A is served by tab A's kernel",
      prevA3.text.slice(0, 60),
    );
    await reloadPreview(tabB);
    await sleep(5000);
    const prevB2 = await waitForPreview(tabB, SHOWCASE_PREVIEW, 30000, "B reloaded content");
    check(
      SHOWCASE_PREVIEW.test(prevB2.text) && !TODO_PREVIEW.test(prevB2.text),
      "a reloaded preview in tab B is served by tab B's kernel",
      prevB2.text.slice(0, 60),
    );
    await tabA.screenshot(path.join(ARTIFACTS, "01-tab-a-todo.png"));
    await tabB.screenshot(path.join(ARTIFACTS, "02-tab-b-showcase.png"));

    // React Flow measures its cards on animation frames, which a hidden tab pauses: the
    // cards stay visibility:hidden and innerText reads empty. Drive the graph in the tab a
    // user would be looking at (issue #180).
    await tabB.send("Page.bringToFront");
    // ---- prerender toggle (D-202, issue #84): the static showcase has eligible pages ----
    // The example ships '/' and '/contact' declared (issue #86); the toggle exercises the
    // undeclared '/features' page. The full round trip on the vite.config.ts surface:
    // toggle on -> the route is appended to the shipped allowlist through the kernel VFS
    // and the graph re-analyzes without a reload; toggle off -> the shipped allowlist is
    // restored. No facilis.config.ts exists in a static project.
    await tabB.evaluate(
      "(() => { const b = [...document.querySelectorAll('button')].find(" +
        "(x) => (x.getAttribute('aria-label') || '') === 'Project graph');" +
        " if (b) b.click(); })()",
    );
    check(
      await waitFor(
        tabB,
        "document.querySelectorAll('[data-testid=\"project-graph-page\"]').length > 0",
        60000,
        "B graph pages",
      ),
      "prerender: showcase graph renders pages",
    );
    // React Flow culls off-viewport nodes: fit the whole graph first so every page card
    // is in the DOM, then select the features page (static, no calls -> eligible).
    await tabB.evaluate(
      "(() => { const b = [...document.querySelectorAll('button')].find(" +
        "(x) => (x.getAttribute('aria-label') || '') === 'Fit to view');" +
        " if (b) b.click(); })()",
    );
    check(
      await waitFor(
        tabB,
        "(() => { const n = [...document.querySelectorAll('[data-testid=\"project-graph-page\"]')]" +
          ".find((x) => (x.innerText || '').includes('src/pages/features.tsx'));" +
          " if (!n) return false; n.click(); return true; })()",
        15000,
        "B features node",
      ),
      "prerender: features page selected",
    );
    check(
      await waitFor(
        tabB,
        "(() => { const t = document.querySelector('[data-testid=\"project-graph-prerender-toggle\"]');" +
          " return Boolean(t) && !t.disabled && t.getAttribute('aria-checked') === 'false'; })()",
        15000,
        "B eligible toggle",
      ),
      "prerender: eligible page offers an enabled, off toggle",
    );
    await tabB.evaluate(
      "document.querySelector('[data-testid=\"project-graph-prerender-toggle\"]').click()",
    );
    check(
      await waitFor(
        tabB,
        "(() => { const t = document.querySelector('[data-testid=\"project-graph-prerender-toggle\"]');" +
          " return Boolean(t) && t.getAttribute('aria-checked') === 'true'; })()",
        30000,
        "B toggle on",
      ),
      "prerender: toggle on re-analyzes without a reload",
    );
    const viteOn = await readText(tabB, BETA + "/vite.config.ts");
    check(
      typeof viteOn === "string" &&
        viteOn.includes('import { prerender } from "@facilis.dev/nitro/prerender";') &&
        viteOn.includes('routes: ["/", "/contact", "/features"]'),
      "prerender: toggle appends to the shipped allowlist through the kernel",
      (viteOn || "").slice(0, 200),
    );
    await tabB.screenshot(path.join(ARTIFACTS, "02b-prerender-on.png"));
    await tabB.evaluate(
      "document.querySelector('[data-testid=\"project-graph-prerender-toggle\"]').click()",
    );
    check(
      await waitFor(
        tabB,
        "(() => { const t = document.querySelector('[data-testid=\"project-graph-prerender-toggle\"]');" +
          " return Boolean(t) && t.getAttribute('aria-checked') === 'false'; })()",
        30000,
        "B toggle off",
      ),
      "prerender: toggle off removes the declaration",
    );
    const viteOff = await readText(tabB, BETA + "/vite.config.ts");
    check(
      typeof viteOff === "string" &&
        viteOff.includes('routes: ["/", "/contact"]') &&
        !viteOff.includes('"/features"'),
      "prerender: shipped allowlist restored after toggle-off",
      (viteOff || "").slice(0, 200),
    );


    // ---- one project, one tab ---------------------------------------------
    const tabC = await openPage(chrome.client, projectUrl(dev.url, ALPHA));
    tabs.push(tabC);
    check(await waitFor(tabC, KERNEL_READY, BOOT_TIMEOUT_MS, "C kernel"), "tab C boots");
    await waitFor(
      tabC,
      "document.body.innerText.includes('already open in another tab')",
      30000,
      "C refusal toast",
    );
    const refusal = await tabC.evaluate(
      "document.body.innerText.includes('already open in another tab')",
    );
    check(refusal, "a second tab REFUSES a project already open elsewhere");
    check((await snapshot(tabC)).folders.length === 0, "tab C leaves no folder open");
    // The boot restore is scoped, and the package-manager cache is scoped per file:
    // a tab that opens no project carries neither the projects nor the cache in its
    // VFS — they stay on OPFS, still indexed.
    const homeState = await tabC.evaluate(
      "(async () => {" +
        " const diag = await window.__vv.diag();" +
        " const origin = await navigator.storage.getDirectory();" +
        " const vv = await origin.getDirectoryHandle('vv-vfs');" +
        " const entries = JSON.parse(await (await (await vv.getFileHandle('manifest.json')).getFile()).text());" +
        " const files = (prefix) => entries.filter(([p, m]) => m.k === 'file' && p.startsWith(prefix));" +
        " const vfs = diag.vfs || {};" +
        " return { vfsFiles: vfs.files, vfsBytes: vfs.bytes, deferred: vfs.deferred, cacheFiles: files('/home/user/.cache/').length, projectFiles: files('/home/user/projects/').length };" +
        " })()",
    );
    check(
      homeState.cacheFiles > 0 && homeState.projectFiles > 0,
      "the origin has a persisted package-manager cache and projects",
      JSON.stringify(homeState),
    );
    check(
      homeState.deferred >= homeState.cacheFiles + homeState.projectFiles,
      "a tab that opens no project leaves both on OPFS",
      JSON.stringify({
        deferred: homeState.deferred,
        cacheFiles: homeState.cacheFiles,
        projectFiles: homeState.projectFiles,
      }),
    );
    check(
      homeState.vfsFiles < 100 && homeState.vfsBytes < 2 * 1024 * 1024,
      "so its VFS carries neither the projects nor the cache",
      JSON.stringify({ files: homeState.vfsFiles, bytes: homeState.vfsBytes }),
    );
    // One deferred cache file, asked for by name: it becomes readable with its real
    // size, and nothing else is replayed with it.
    const lazyCache = await tabC.evaluate(
      "(async () => {" +
        " const origin = await navigator.storage.getDirectory();" +
        " const vv = await origin.getDirectoryHandle('vv-vfs');" +
        " const entries = JSON.parse(await (await (await vv.getFileHandle('manifest.json')).getFile()).text());" +
        " const path = entries.find(([p, m]) => m.k === 'file' && p.startsWith('/home/user/.cache/npm/') && !p.endsWith('/CACHEDIR.TAG'))[0];" +
        " const before = (await window.__vv.diag()).vfs.files;" +
        " const st = await window.__ide.bridge.request('vv-stat', { path });" +
        " const after = (await window.__vv.diag()).vfs.files;" +
        " const read = await window.__ide.bridge.request('vv-read-bytes', { path });" +
        " return { path, exists: !!st.exists, size: st.size, before, after, bytes: read.ok && read.bytes ? read.bytes.length : -1 };" +
        " })()",
    );
    check(
      lazyCache.exists && lazyCache.bytes > 0 && lazyCache.bytes === lazyCache.size,
      "a deferred cache file is readable on demand",
      lazyCache.path,
    );
    check(
      lazyCache.after === lazyCache.before + 1,
      "only the requested cache file is replayed into the VFS",
      lazyCache.before + "->" + lazyCache.after,
    );
    check(
      (await tabC.evaluate("new URLSearchParams(location.search).get('project')")) === null,
      "a tab with no project has no ?project= in its URL",
    );
    check((await snapshot(tabA)).folders.includes(ALPHA), "tab A still owns alpha");

    // ---- the shared OPFS index survives both kernels ---------------
    check(
      await writeProbe(tabA, ALPHA + "/smoke-probe.txt", "from tab A\n"),
      "tab A writes a file",
    );
    await flushMirror(tabA);
    const betaBefore = await stat(tabA, BETA);
    check(betaBefore.exists, "tab A's VFS still sees beta");

    // Reload tab B: it must find its project in the OPFS index again (before the merge
    // fix, tab A's single write erased every beta path from the index).
    const timeOriginBefore = await tabB.evaluate("performance.timeOrigin");
    await tabB.send("Page.reload", {});
    check(
      await waitFor(
        tabB,
        "performance.timeOrigin !== " + JSON.stringify(timeOriginBefore) + " && " + KERNEL_READY,
        BOOT_TIMEOUT_MS,
        "B reload",
      ),
      "tab B reboots into a fresh document",
    );
    // The boot restore left beta on OPFS (BootOptions.deferRestoreRoots); opening it
    // hydrated the entries tab A had mirrored. That is also the cross-tab index
    // check: tab A's own write to alpha could have erased beta's paths from it.
    check(
      await waitForPath(tabB, BETA, 60000),
      "after a reload beta comes back when its tab opens it",
    );
    const betaPkg = await readText(tabB, BETA + "/package.json");
    // beta is the static showcase: its runtime stays framework-free — no @facilis.dev/*
    // dependency — but the D-202/D-168 amendment allows ONE build-time-only devDependency,
    // the prerender plugin entry. The bytes prove which template was restored.
    let betaPkgOk = false;
    let betaPkgDetail = "unreadable";
    try {
      const pkg = JSON.parse(betaPkg);
      const deps = Object.keys(pkg.dependencies || {});
      const devDeps = Object.keys(pkg.devDependencies || {});
      betaPkgOk =
        deps.includes("react") &&
        !deps.some((name) => name.startsWith("@facilis.dev/")) &&
        devDeps.includes("@facilis.dev/nitro");
      betaPkgDetail = JSON.stringify({
        frameworkDeps: deps.filter((name) => name.startsWith("@facilis.dev/")),
        devDeps,
      });
    } catch {
      /* the detail below reports the failure */
    }
    check(
      betaPkgOk,
      "the project is its real contents (bytes from OPFS, not just the directory)",
      betaPkgDetail,
    );
    // ---- "Open in a new tab" from Home ------------------------------------
    const dirG = await createProject(tabA, "gamma", false);
    check(dirG === GAMMA, "tab A creates gamma", dirG);
    // The opened tab finds gamma on OPFS, so flush the write-behind mirror first (as
    // for beta): ensureProjectOnDisk gives a concurrent flush ~1.2 s, and a tab that
    // finds nothing drops the project from the registry (removeProjectMeta).
    await flushMirror(tabA);
    await closeFolder(tabA, GAMMA);
    await tabA.evaluate("window.__ide.goHome()");
    const rowButton = "Boolean(document.querySelector(\"[aria-label='Open gamma in a new tab']\"))";
    check(
      await waitFor(tabA, rowButton, 30000, "gamma row"),
      "Home lists gamma with an open-in-a-new-tab button",
    );
    // A real click carries user activation; a plain Runtime.evaluate does not, and Chrome
    // blocks window.open without it. userGesture: true is the difference.
    await tabA.send("Runtime.evaluate", {
      expression: "document.querySelector(\"[aria-label='Open gamma in a new tab']\").click()",
      userGesture: true,
      returnByValue: true,
    });
    let opened = null;
    for (let i = 0; i < 20 && !opened; i++) {
      await sleep(250);
      const { targetInfos } = await chrome.client.send("Target.getTargets");
      opened = targetInfos.find(
        (t) => t.type === "page" && t.url.includes("project=") && t.url.includes("gamma"),
      );
    }
    check(
      Boolean(opened),
      "the button opens a tab whose URL names gamma",
      opened ? opened.url : "no target",
    );
    // Property 4 is "boots straight onto that project", not just "names it in the URL":
    // attach to the opened tab and wait for the folder. Then close it — its run would
    // be a third in-VM install the remaining checks do not need.
    if (opened) {
      const tabG = await attachPage(chrome.client, opened.targetId);
      check(
        await waitFor(tabG, KERNEL_READY, BOOT_TIMEOUT_MS, "gamma tab kernel"),
        "the opened tab boots its own kernel",
      );
      check(
        await waitFor(
          tabG,
          "window.__ide.getSnapshot().workspaceFolders.some((f) => f.rootPath === " +
            JSON.stringify(GAMMA) +
            ")",
          60000,
          "gamma tab opens",
        ),
        "the opened tab boots into gamma",
      );
      await chrome.client.send("Target.closeTarget", { targetId: opened.targetId });
    }

    // ---- the registry is per origin, and no tab may write a stale list ------
    // Tab B booted before gamma existed: its in-memory list is stale. A create there
    // used to write that list back and drop gamma from Home while its files stayed on
    // disk ("That directory is not empty." on a re-create).
    check(
      await waitFor(
        tabB,
        // Key on rootPath, not on a display name: the registry stores no name at all
        // (a project is named by its directory), and this check is about the merge.
        "window.__ide.getSnapshot().recentProjects.some((p) => p.rootPath.endsWith('/gamma'))",
        15000,
        "tab B learns gamma",
      ),
      "a tab learns a project another tab created",
    );
    // The form name and the directory disagree: every label must follow the DIRECTORY.
    const dirD = await createProject(tabB, "delta", false, "/home/user/projects/delta-dir");
    check(
      dirD === "/home/user/projects/delta-dir",
      "tab B creates delta in its own directory",
      dirD,
    );
    const labelled = await tabB.evaluate(
      "(() => { const s = window.__ide.getSnapshot(); return { title: s.projectTitle," +
        " name: s.workspaceFolders[0] && s.workspaceFolders[0].name, doc: document.title }; })()",
    );
    check(
      labelled.title === "delta-dir" && labelled.name === "delta-dir",
      "the project is labelled by its folder, not the form name",
      JSON.stringify(labelled),
    );
    check(
      await waitFor(tabB, "/delta-dir/.test(document.title)", 10000, "B delta title"),
      "the browser title names the folder",
      await tabB.evaluate("document.title"),
    );
    await sleep(500);
    const registryNames = await tabA.evaluate(
      "JSON.parse(localStorage.getItem('vv-workspace-projects') || '[]').map((p) => p.rootPath.split('/').pop())",
    );
    check(
      ["alpha", "beta", "gamma", "delta-dir"].every((name) => registryNames.includes(name)),
      "creating in one tab keeps every tab's projects in the registry",
      registryNames.join(","),
    );

    // ---- prerender serving (D-202, issue #86) — LAST, by design ----------------
    // The in-VM builds write dist/.output/.facilis artifacts into the project VFS, and
    // the build/graph activity disturbs tab state: the pristine-state checks above (tab C
    // refusal, deferred-cache replay delta, VFS counts, Web Lock claims) must run before
    // any of that. Both projects were closed/replaced by the gamma and delta flows, so
    // reopen and run them the way Home does (a recent row), then build and read the bytes.
    await tabA.evaluate(
      "(async () => { const c = window.__ide;" +
        " const meta = c.getSnapshot().recentProjects.find((p) => p.rootPath === " +
        JSON.stringify(ALPHA) +
        ");" +
        " await c.openProject(meta);" +
        " c.runProject(meta.rootPath); })()",
    );
    check(
      await waitFor(
        tabA,
        "window.__ide.getSnapshot().workspaceFolders.some((f) => f.rootPath === " +
          JSON.stringify(ALPHA) + ")",
        15000,
        "A reopens alpha for prerender",
      ),
      "alpha reopens in tab A for the prerender phase",
    );
    check(
      await waitFor(
        tabA,
        "window.__ide.getSnapshot().ports.length === 1" +
          " && window.__ide.getSnapshot().previewTabs.length === 1",
        PREVIEW_TIMEOUT_MS,
        "A reruns alpha for prerender",
      ),
      "alpha runs again for the prerender phase",
    );
    await tabB.evaluate(
      "(async () => { const c = window.__ide;" +
        " const meta = c.getSnapshot().recentProjects.find((p) => p.rootPath === " +
        JSON.stringify(BETA) +
        ");" +
        " await c.openProject(meta);" +
        " c.runProject(meta.rootPath); })()",
    );
    check(
      await waitFor(
        tabB,
        "window.__ide.getSnapshot().workspaceFolders.some((f) => f.rootPath === " +
          JSON.stringify(BETA) + ")",
        15000,
        "B reopens beta for prerender",
      ),
      "beta reopens in tab B for the prerender phase (replaces delta)",
    );
    check(
      await waitFor(
        tabB,
        "window.__ide.getSnapshot().ports.length === 1" +
          " && window.__ide.getSnapshot().previewTabs.length === 1",
        PREVIEW_TIMEOUT_MS,
        "B reruns beta for prerender",
      ),
      "beta runs again for the prerender phase",
    );

    // ---- todo prerender (D-202, issue #86): the full-stack template builds in-VM ----
    // /public-stats is declared and calls only a permission: [] route; /todos stays an
    // auth-gated SPA. The build writes the .facilis/prerender.json stamp the dev
    // middleware serves stored HTML from, so build first, then read the served bytes.
    const buildA = await runInVmBuild(tabA, ALPHA, "smoke-build-alpha");
    check(
      buildA.code === 0 && !buildA.timeout,
      "prerender: todo-app builds in-VM (npm run build)",
      buildA.timeout
        ? "timeout; tail: " + buildA.tail
        : buildA.code === 0
          ? ""
          : "exit " + buildA.code + "; tail: " + buildA.tail,
    );
    // Settle the preview frame before fetching through it: the SW remembers the frame
    // against this tab's kernel on its first navigation (D-132).
    await waitForPreview(tabA, TODO_PREVIEW, 30000, "A login before prerender fetch");
    const statsHtml = await previewHtml(tabA, "/public-stats");
    const statsDiag = {
      status: statsHtml.status,
      island: statsHtml.body.includes('id="prerender-data"'),
      dataKey: statsHtml.body.includes('"/api/public-stats"'),
      canonical: statsHtml.body.includes('href="https://todo.example.com/public-stats"'),
      title: /<title>[^<]+<\/title>/.test(statsHtml.body),
    };
    check(
      statsHtml.found &&
        statsHtml.status === 200 &&
        statsDiag.island &&
        statsDiag.dataKey &&
        statsDiag.canonical &&
        statsDiag.title,
      "prerender: /public-stats serves prerendered HTML with its public data island",
      JSON.stringify(statsDiag),
    );
    const todosHtml = await previewHtml(tabA, "/todos");
    check(
      todosHtml.found &&
        todosHtml.status === 200 &&
        !todosHtml.body.includes('id="prerender-data"'),
      "prerender: /todos stays the SPA shell (no island)",
      JSON.stringify({ status: todosHtml.status, island: todosHtml.body.includes('id="prerender-data"') }),
    );
    // Focus the tab before driving its graph: a hidden tab pauses the animation frames
    // React Flow measures its cards on, leaving them visibility:hidden (issue #180).
    await tabA.send("Page.bringToFront");
    // The graph reports /todos ineligible with its reason (fail closed, D-202 §3). Same
    // inspector surface as the showcase toggle block above and smoke-panels.mjs: open the
    // activity, fit so React Flow keeps every node mounted, select the todos page node,
    // then read the toggle state and the eligibility chips (the auth-guarded label is the
    // chip's own text, en-project-graph.ts). No later assertion depends on this tab's
    // layout: the phase runs after every pristine-state check.
    await tabA.evaluate(
      "(() => { const b = [...document.querySelectorAll('button')].find(" +
        "(x) => (x.getAttribute('aria-label') || '') === 'Project graph');" +
        " if (b) b.click(); })()",
    );
    check(
      await waitFor(
        tabA,
        "document.querySelectorAll('[data-testid=\"project-graph-page\"]').length > 0",
        60000,
        "A graph pages",
      ),
      "prerender: todo graph renders pages",
    );
    await tabA.evaluate(
      "(() => { const b = [...document.querySelectorAll('button')].find(" +
        "(x) => (x.getAttribute('aria-label') || '') === 'Fit to view');" +
        " if (b) b.click(); })()",
    );
    check(
      await waitFor(
        tabA,
        "(() => { const n = [...document.querySelectorAll('[data-testid=\"project-graph-page\"]')]" +
          ".find((x) => (x.innerText || '').includes('src/pages/todos.tsx'));" +
          " if (!n) return false; n.click(); return true; })()",
        15000,
        "A todos node",
      ),
      "prerender: todos page selected",
    );
    const todosToggleState = await tabA.evaluate(
      "(() => { const t = document.querySelector('[data-testid=\"project-graph-prerender-toggle\"]');" +
        " const chips = document.querySelector('[data-testid=\"project-graph-prerender-chips\"]');" +
        " return JSON.stringify({ disabled: t ? t.disabled : null," +
        " checked: t ? t.getAttribute('aria-checked') : null," +
        " chips: chips ? chips.innerText : '' }); })()",
    );
    let todosBlocked = false;
    try {
      const state = JSON.parse(todosToggleState);
      todosBlocked =
        state.disabled === true &&
        state.checked === "false" &&
        state.chips.includes("auth-guarded");
    } catch {
      /* the detail below reports the raw state */
    }
    check(
      todosBlocked,
      "prerender: /todos is ineligible (auth-guarded) and its toggle stays disabled",
      todosToggleState,
    );
    await tabA.screenshot(path.join(ARTIFACTS, "02c-todo-prerender.png"));

    // ---- showcase prerender build (D-202, issue #86): the static template ----
    // The shipped allowlist is exactly ['/', '/contact'] again after the toggle round
    // trip. Build in-VM, then read the served bytes: declared routes carry real content,
    // title, canonical and the (possibly empty) data island; undeclared '/features'
    // keeps the shell. Zero-call static pages serialize '{}' — the tag's presence, not
    // data keys, is the contract there.
    const buildB = await runInVmBuild(tabB, BETA, "smoke-build-beta");
    check(
      buildB.code === 0 && !buildB.timeout,
      "prerender: showcase-app builds in-VM (npm run build)",
      buildB.timeout
        ? "timeout; tail: " + buildB.tail
        : buildB.code === 0
          ? ""
          : "exit " + buildB.code + "; tail: " + buildB.tail,
    );
    // Beta was just reopened in this tab; settle the frame so the SW has remembered it
    // against this tab's kernel before fetching through it (D-132).
    await waitForPreview(tabB, SHOWCASE_PREVIEW, 30000, "B showcase before prerender fetch");
    const homeHtml = await previewHtml(tabB, "/");
    const homeDiag = {
      status: homeHtml.status,
      island: homeHtml.body.includes('id="prerender-data"'),
      content: SHOWCASE_PREVIEW.test(homeHtml.body),
      canonical: homeHtml.body.includes('href="https://showcase.example.com/"'),
      title: /<title>[^<]+<\/title>/.test(homeHtml.body),
    };
    check(
      homeHtml.found &&
        homeHtml.status === 200 &&
        homeDiag.island &&
        homeDiag.content &&
        homeDiag.canonical &&
        homeDiag.title,
      "prerender: showcase '/' serves prerendered HTML (content, title, canonical, island)",
      JSON.stringify(homeDiag),
    );
    const contactHtml = await previewHtml(tabB, "/contact");
    const contactDiag = {
      status: contactHtml.status,
      island: contactHtml.body.includes('id="prerender-data"'),
      content: contactHtml.body.includes('id="contact-name"'),
      canonical: contactHtml.body.includes('href="https://showcase.example.com/contact"'),
      title: /<title>[^<]+<\/title>/.test(contactHtml.body),
    };
    check(
      contactHtml.found &&
        contactHtml.status === 200 &&
        contactDiag.island &&
        contactDiag.content &&
        contactDiag.canonical &&
        contactDiag.title,
      "prerender: showcase '/contact' serves prerendered HTML (content, title, canonical, island)",
      JSON.stringify(contactDiag),
    );
    const featuresHtml = await previewHtml(tabB, "/features");
    check(
      featuresHtml.found &&
        featuresHtml.status === 200 &&
        !featuresHtml.body.includes('id="prerender-data"'),
      "prerender: undeclared '/features' serves the shell (no island)",
      JSON.stringify({ status: featuresHtml.status, island: featuresHtml.body.includes('id="prerender-data"') }),
    );
    await tabB.screenshot(path.join(ARTIFACTS, "02d-showcase-prerender.png"));

    // ---- docs template (issue #163): the documentation-site kind boots and prerenders ----
    // Tab B replaces beta with a docs project (the replacement semantics are proven above;
    // this is the last phase). The static docs site must boot with plain vite dev, show the
    // content-tree sidebar, serve a content file added at runtime WITHOUT a React edit, and
    // prerender its declared routes — the same coverage the showcase gets, for the docs kind.
    const dirDocs = await createProject(tabB, "docs", true, undefined, "docs");
    check(dirDocs === DOCS, "tab B creates the docs project", dirDocs);
    check(
      await waitFor(
        tabB,
        "window.__ide.getSnapshot().ports.length === 1" +
          " && window.__ide.getSnapshot().previewTabs.length === 1",
        PREVIEW_TIMEOUT_MS,
        "docs preview",
      ),
      "docs project runs after replacing beta in the same tab",
    );
    const prevD = await waitForPreview(tabB, DOCS_PREVIEW, 30000, "docs home content");
    check(
      prevD.found && DOCS_PREVIEW.test(prevD.text),
      "tab B preview is the docs site home",
      prevD.text.slice(0, 60),
    );
    // textContent, not innerText: the content-tree sidebar is a collapsed details at this
    // viewport, and its pages must still be present in the DOM.
    const previewHas = (text) =>
      "(() => { const f = [...document.querySelectorAll('iframe')].find((f) => /preview/.test(f.src || ''));" +
      " try { return (f.contentDocument.body.textContent || '').includes(" + JSON.stringify(text) + "); } catch (e) { return false; } })()";
    check(
      await waitFor(tabB, previewHas("Getting started") + " && " + previewHas("Guides"), 30000, "docs sidebar tree"),
      "docs: the sidebar is generated from the content tree",
    );

    // AC3: a new content file appears in the sidebar and is reachable at its file-derived
    // route through the catch-all — no React edit, no restart.
    const smokePage =
      "---\ntitle: Smoke Page\ndescription: Added by the smoke.\norder: 9\n---\n\n" +
      "## Smoke heading\n\nA page added without editing React.\n";
    check(
      await writeProbe(tabB, DOCS + "/src/content/docs/smoke-page.md", smokePage),
      "docs: a new content file is written through the kernel",
    );
    check(
      await waitFor(tabB, previewHas("Smoke Page"), 30000, "docs sidebar gains the page"),
      "docs: the sidebar lists the new page without a React edit",
    );
    await tabB.evaluate(
      "(() => { const f = [...document.querySelectorAll('iframe')].find((f) => /preview/.test(f.src || ''));" +
      " f.src = f.src.replace(/\\/preview\\/(\\d+)\\/.*/, '/preview/$1/docs/smoke-page'); })()",
    );
    check(
      await waitFor(tabB, previewHas("A page added without editing React."), 30000, "docs new route"),
      "docs: the new page renders at its file-derived route (catch-all)",
    );

    // Declared docs routes prerender to static HTML in-VM and the dev middleware serves it.
    const buildD = await runInVmBuild(tabB, DOCS, "smoke-build-docs");
    check(
      buildD.code === 0 && !buildD.timeout,
      "prerender: docs-app builds in-VM (npm run build)",
      buildD.timeout
        ? "timeout; tail: " + buildD.tail
        : buildD.code === 0
          ? ""
          : "exit " + buildD.code + "; tail: " + buildD.tail,
    );
    await waitForPreview(tabB, DOCS_PREVIEW, 30000, "B docs before prerender fetch");
    const startHtml = await previewHtml(tabB, "/docs/getting-started");
    const startDiag = {
      status: startHtml.status,
      island: startHtml.body.includes('id="prerender-data"'),
      content: startHtml.body.includes("npm run dev"),
      canonical: startHtml.body.includes('href="https://docs.example.com/docs/getting-started"'),
      title: /<title>[^<]+<\/title>/.test(startHtml.body),
    };
    check(
      startHtml.found &&
        startHtml.status === 200 &&
        startDiag.island &&
        startDiag.content &&
        startDiag.canonical &&
        startDiag.title,
      "prerender: docs '/docs/getting-started' serves prerendered HTML (content, title, canonical, island)",
      JSON.stringify(startDiag),
    );
    // The MDX page's JSX component must be real HTML in the prerendered output too.
    const mdxHtml = await previewHtml(tabB, "/docs/guides/navigation");
    check(
      mdxHtml.found &&
        mdxHtml.status === 200 &&
        mdxHtml.body.includes('id="prerender-data"') &&
        mdxHtml.body.includes("Adding a file updates the sidebar"),
      "prerender: docs MDX route serves prerendered HTML with its rendered component",
      JSON.stringify({ status: mdxHtml.status, island: mdxHtml.body.includes('id="prerender-data"') }),
    );
    const undeclaredHtml = await previewHtml(tabB, "/docs/smoke-page");
    check(
      undeclaredHtml.found &&
        undeclaredHtml.status === 200 &&
        !undeclaredHtml.body.includes('id="prerender-data"'),
      "prerender: undeclared docs route serves the shell (no island)",
      JSON.stringify({ status: undeclaredHtml.status, island: undeclaredHtml.body.includes('id="prerender-data"') }),
    );
    await tabB.screenshot(path.join(ARTIFACTS, "02e-docs-prerender.png"));

    fs.writeFileSync(
      path.join(ARTIFACTS, "report.json"),
      JSON.stringify({ url: dev.url, checks, failures }, null, 2),
    );
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
    console.error("\nMULTI-TAB SMOKE FAILED (" + failures.length + "): " + failures.join(", "));
    process.exit(1);
  }
  console.log("\nMULTI-TAB SMOKE PASSED - artifacts in " + ARTIFACTS);
}

await main();
