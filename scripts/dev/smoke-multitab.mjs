// IDE multi-tab smoke test: two projects, two browser tabs, one kernel per tab.
//
// This is the acceptance run for the "several projects at once" feature. It drives the
// real Studio through CDP and asserts the four things that only break with two tabs:
//   1. each tab's preview is served by ITS kernel (both dev servers bind 5173 in their
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
import { launchChrome, openPage } from "./cdp.mjs";
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
const ARTIFACTS_ROOT = path.join(TOOLING, "smoke-multitab");
const ARTIFACTS = process.env.SMOKE_ARTIFACTS || path.join(ARTIFACTS_ROOT, String(Date.now()));
const KEEP_ARTIFACTS = process.argv.includes("--keep-artifacts");
const CHROME = process.env.FACILIS_CHROME || path.join(TOOLING, "browser/chrome/chrome");
const SYSROOT = process.env.FACILIS_BROWSER_SYSROOT || path.join(TOOLING, "browser/sysroot");
const FONTCONFIG = process.env.FACILIS_FONTCONFIG || path.join(TOOLING, "browser/fonts.conf");
const ALPHA = "/home/user/projects/alpha";
const BETA = "/home/user/projects/beta";
const GAMMA = "/home/user/projects/gamma";

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

async function reloadPreview(page) {
  return page.evaluate(
    "(() => { const f = [...document.querySelectorAll('iframe')].find((f) => /preview/.test(f.src || ''));" +
      " if (!f) return false; f.src = f.src.split('?')[0] + '?r=' + Date.now(); return true; })()",
  );
}

// `dir` is optional so a check can prove the label follows the DIRECTORY, not the form
// name: the tab is given one and then labelled by the other (D-035).
async function createProject(page, name, runInit, dir) {
  const target = dir ? JSON.stringify(dir) : "c.defaultDirFor(" + JSON.stringify(name) + ")";
  return page.evaluate(
    "(async () => { const c = window.__ide;" +
      " const dir = " +
      target +
      ";" +
      " await c.createProject({ dir, runInit: " +
      (runInit ? "true" : "false") +
      " });" +
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
    // ---- tab A: a React project, running -----------------------------------
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
    const prevA = await preview(tabA);
    check(
      prevA.found && /Vite \+ React/.test(prevA.text),
      "tab A preview is the React app",
      prevA.text.slice(0, 60),
    );

    // The run belongs to the open folder: alpha's row is what the replacement has to clear.
    const alphaPorts = await tabA.evaluate(
      "window.__ide.getSnapshot().ports.map((p) => p.port)",
    );
    check(alphaPorts.length === 1, "alpha's dev server is in the Ports view", String(alphaPorts));

    // A second project, created here and RUN: it must reach OPFS (so tab B can open it)
    // without being claimed by this tab. Creating it also proves one project per tab
    // (D-035): beta REPLACES alpha in this tab instead of stacking a second root, and the
    // replaced project's run goes with its folder — no phantom Ports row (two live
    // listeners would bind two ports) and no preview tab bound to a server that is gone.
    const dirB = await createProject(tabA, "beta", true);
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
    const betaUp = await waitFor(
      tabA,
      "window.__ide.getSnapshot().ports.length === 1" +
        " && window.__ide.getSnapshot().previewTabs.length === 1",
      PREVIEW_TIMEOUT_MS,
      "beta preview",
    );
    check(betaUp, "beta runs after replacing alpha in the same tab");
    const betaPorts = await tabA.evaluate(
      "window.__ide.getSnapshot().ports.map((p) => p.port)",
    );
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
    const prevB = await preview(tabB);
    check(
      prevB.found && /Vite \+ Vue/.test(prevB.text),
      "tab B preview is the Vue app",
      prevB.text.slice(0, 60),
    );
    const snapB = await snapshot(tabB);
    check(/beta/.test(snapB.docTitle), "tab B's browser title names beta", snapB.docTitle);

    // ---- routing: both previews still theirs, after both kernels exist ----
    const prevA2 = await preview(tabA);
    check(/Vite \+ React/.test(prevA2.text), "tab A preview stays the React app with B running");
    check(!/Vite \+ Vue/.test(prevA2.text), "tab A did not pick up tab B's kernel");
    await reloadPreview(tabA);
    await sleep(5000);
    const prevA3 = await preview(tabA);
    check(
      /Vite \+ React/.test(prevA3.text) && !/Vite \+ Vue/.test(prevA3.text),
      "a reloaded preview in tab A is served by tab A's kernel",
      prevA3.text.slice(0, 60),
    );
    await reloadPreview(tabB);
    await sleep(5000);
    const prevB2 = await preview(tabB);
    check(
      /Vite \+ Vue/.test(prevB2.text) && !/Vite \+ React/.test(prevB2.text),
      "a reloaded preview in tab B is served by tab B's kernel",
      prevB2.text.slice(0, 60),
    );
    await tabA.screenshot(path.join(ARTIFACTS, "01-tab-a-react.png"));
    await tabB.screenshot(path.join(ARTIFACTS, "02-tab-b-vue.png"));

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
    check(
      typeof betaPkg === "string" && betaPkg.includes('"vue"'),
      "the project is its real contents (bytes from OPFS, not just the directory)",
    );
    // ---- "Open in a new tab" from Home ------------------------------------
    const dirG = await createProject(tabA, "gamma", false);
    check(dirG === GAMMA, "tab A creates gamma", dirG);
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
