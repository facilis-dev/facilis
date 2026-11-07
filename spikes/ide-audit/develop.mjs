#!/usr/bin/env node
/**
 * Spike: write the first real site page into the Studio project and watch the preview.
 *
 * This is the development loop the site is built with: create the project in the IDE, put the
 * source in through the kernel VFS (the same path the editor and the AI patches use), wait for
 * the preview to show it, export the zip back out. Every friction met on the way is logged in
 * the report so it can become a fix.
 *
 * Usage: node spikes/ide-audit/develop.mjs
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChrome, openPage } from "../../scripts/dev/cdp.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOOLING = process.env.FACILIS_TOOLING_DIR || "/tmp/facilis-dev";
const ARTIFACTS = path.join(TOOLING, "spike-develop", String(Date.now()));
const CHROME = process.env.FACILIS_CHROME || path.join(TOOLING, "browser/chrome/chrome");
const SYSROOT = process.env.FACILIS_BROWSER_SYSROOT || path.join(TOOLING, "browser/sysroot");
const FONTCONFIG = process.env.FACILIS_FONTCONFIG || path.join(TOOLING, "browser/fonts.conf");
const DOWNLOADS = path.join(ARTIFACTS, "downloads");
const PROJECT = process.env.SITE_PROJECT_NAME || "facilis-dev";
const BOOT_TIMEOUT_MS = 240000;
const INSTALL_TIMEOUT_MS = 540000;

const HOME_PAGE = fs.readFileSync("/tmp/site-home-page.tsx", "utf8");
const APP = fs.readFileSync("/tmp/site-app.tsx", "utf8");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  throw new Error("no free port from " + from);
}

async function startDevServer() {
  const port = await freePort(5199);
  const url = "http://127.0.0.1:" + port + "/";
  const child = spawn("pnpm", ["--filter", "@facilis/ide", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: REPO, stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  let log = "";
  child.stdout.on("data", (c) => (log += c.toString()));
  child.stderr.on("data", (c) => (log += c.toString()));
  const until = Date.now() + 180000;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return { url, child }; } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error("IDE dev server did not start. Log:\n" + log.slice(-3000));
}

async function waitFor(page, expression, limitMs, step = 300) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    if (await page.evaluate(expression).catch(() => false)) return true;
    await sleep(step);
  }
  return false;
}

const PREVIEW = '[...document.querySelectorAll("iframe")].find((f) => /preview/.test(f.src || ""))';
const inPreview = (body) => "(() => { const f = " + PREVIEW + "; if (!f) return null; try { const d = f.contentDocument; const w = f.contentWindow; if (!d) return null; " + body + " } catch (error) { return { error: String(error) }; } })()";

async function clickText(page, text) {
  return page.evaluate(
    "(() => { const els = [...document.querySelectorAll('button,[role=button],a,[role=tab]')];" +
      " const hit = els.find((el) => (el.innerText || '').includes(" + JSON.stringify(text) + "));" +
      " if (!hit) return 'NOTFOUND'; hit.click(); return 'OK'; })()",
  );
}

async function clickLabel(page, label) {
  return page.evaluate(
    "(() => { const els = [...document.querySelectorAll('button,[role=button],[aria-label]')];" +
      " const hit = els.find((el) => (el.getAttribute('aria-label') || el.innerText || '').trim() === " + JSON.stringify(label) + ");" +
      " if (!hit) return 'NOTFOUND'; hit.click(); return 'OK'; })()",
  );
}

async function writeFile(page, abs, contents) {
  return page.evaluate(
    'window.__ide.bridge.request("vv-write", { path: ' + JSON.stringify(abs) + ", contents: " + JSON.stringify(contents) + " })",
  );
}

async function main() {
  fs.mkdirSync(DOWNLOADS, { recursive: true });
  const report = { ok: false, startedAt: new Date().toISOString(), timings: {}, findings: [], preview: {}, artifacts: ARTIFACTS };
  const finding = (id, text) => { report.findings.push({ id, text }); console.log("FINDING " + id + " " + text); };
  let dev = null, chrome = null;
  try {
    dev = await startDevServer();
    chrome = await launchChrome({
      chrome: CHROME,
      profileDir: path.join(ARTIFACTS, "profile"),
      homeDir: path.join(ARTIFACTS, "home"),
      sysroot: fs.existsSync(SYSROOT) ? SYSROOT : "",
      fontconfigFile: fs.existsSync(FONTCONFIG) ? FONTCONFIG : "",
    });
    await chrome.client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS });
    const page = await openPage(chrome.client, dev.url);
    const t0 = Date.now();
    if (!(await waitFor(page, '((window.__vvBoot || []).some((m) => m.name === "kernel-online"))', BOOT_TIMEOUT_MS))) throw new Error("kernel never came online");
    report.timings.kernelOnlineMs = Date.now() - t0;

    // The New project button is inert until the runtime is ready; retry until the dialog shows.
    const dialogOpen = async () =>
      page.evaluate("Boolean(document.querySelector('input[placeholder=my-app]'))").catch(() => false);
    const openUntil = Date.now() + 25000;
    while (Date.now() < openUntil && !(await dialogOpen())) {
      const hit = await clickText(page, "New project");
      await sleep(700);
      if (hit === "NOTFOUND" || !(await dialogOpen())) {
        await clickText(page, "Home");
        await sleep(500);
      }
    }
    if (!(await dialogOpen())) throw new Error("new-project dialog never opened");
    await page.evaluate(
      "(() => { const input = document.querySelector('input[placeholder=my-app]'); if (!input) return 'NOTFOUND';" +
        " const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;" +
        " set.call(input, " + JSON.stringify(PROJECT) + "); input.dispatchEvent(new Event('input', { bubbles: true })); return 'OK'; })()",
    );
    const createReady = await waitFor(page, "Boolean([...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Create' && !b.disabled))", 15000);
    if (!createReady) throw new Error("Create button never became enabled");
    const createAt = Date.now();
    await page.evaluate("(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === 'Create'); if (b) b.click(); })()");
    const painted = await waitFor(page, '((window.__vvBoot || []).some((m) => m.name === "preview-paint"))', INSTALL_TIMEOUT_MS, 3000);
    report.timings.createToPreviewMs = Date.now() - createAt;
    report.previewPainted = painted;
    if (!painted) throw new Error("preview never painted");
    await sleep(2000);
    await page.screenshot(path.join(ARTIFACTS, "01-template.png"));

    const root = await page.evaluate("(() => { const c = window.__ide; const f = c && c.activeFolder; return f ? f.rootPath : ''; })()");
    report.projectRoot = root;
    if (!root) throw new Error("no active folder");

    // The first real page: write both files, then measure how long the preview takes to show it.
    const writeAt = Date.now();
    await writeFile(page, root + "/src/pages/home.tsx", HOME_PAGE);
    await writeFile(page, root + "/src/app.tsx", APP);
    report.timings.writesMs = Date.now() - writeAt;
    const shown = await waitFor(page, inPreview("return Boolean(d.body && d.body.innerText.includes('Security is the fast path'));"), 30000);
    report.timings.writeToPreviewMs = Date.now() - writeAt;
    report.preview.shown = shown;
    await sleep(800);
    await page.screenshot(path.join(ARTIFACTS, "02-home.png"));
    report.preview.probe = await page.evaluate(inPreview(
      'const h1 = d.querySelector("h1"); const cs = h1 ? w.getComputedStyle(h1) : null;' +
        ' const badge = d.querySelector("[data-slot=badge]"); const card = d.querySelector("[data-slot=card]");' +
        ' return { title: h1 ? h1.textContent : null, font: cs ? cs.fontFamily : null, size: cs ? cs.fontSize : null,' +
        '  badge: Boolean(badge), card: Boolean(card), bodyBg: w.getComputedStyle(d.body).backgroundColor,' +
        '  hasHint: (d.body.innerText || "").includes("Edit src/app.tsx and save to test HMR"),' +
        '  text: (d.body.innerText || "").slice(0, 400) };',
    ));
    if (!shown) finding("develop-1", "the preview did not show the new page within 30 s of the VFS writes");
    if (report.preview.probe && report.preview.probe.hasHint) {
      finding("develop-2", "the generated app ships the HMR hint paragraph as UI content; a shipped site must delete it, and re-generating the project re-adds it");
    }

    // Does the explorer pick up a file that appeared through the VFS (not created in the UI)?
    const explorerText = await page.evaluate("(() => { const s = window.__ide.getSnapshot(); return JSON.stringify({ folders: (s.workspaceFolders || []).map((f) => f.rootPath), activeView: s.activeView }); })()");
    report.explorer = explorerText;
    const treeHasHome = await page.evaluate("document.body.innerText.includes('home.tsx')");
    report.explorerShowsNewFile = treeHasHome;
    if (!treeHasHome) finding("develop-3", "a file written through the kernel VFS does not appear in the explorer until something else refreshes it");
    await page.screenshot(path.join(ARTIFACTS, "03-explorer.png"));

    // Export the project so the change can be committed to the site repo.
    await page.evaluate("window.__ide.exportProjectZip(" + JSON.stringify(root) + ")");
    const zipUntil = Date.now() + 60000;
    let zipPath = null;
    while (Date.now() < zipUntil && !zipPath) {
      const files = fs.existsSync(DOWNLOADS) ? fs.readdirSync(DOWNLOADS).filter((f) => /[.]zip$/.test(f)) : [];
      if (files.length > 0) {
        const candidate = path.join(DOWNLOADS, files[0]);
        if (fs.statSync(candidate).size > 0) zipPath = candidate;
      }
      await sleep(500);
    }
    report.zipPath = zipPath;
    if (!zipPath) finding("develop-4", "the zip export produced no file within 60 s");
    report.console = page.consoleEntries.filter((e) => e.type === "error").slice(-25);
    report.pageErrors = page.pageErrors.slice(-10);
    report.ok = true;
  } catch (error) {
    report.error = error instanceof Error ? error.message.slice(0, 1000) : String(error);
    console.log("DEVELOP FAILED: " + report.error);
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(ARTIFACTS, "report.json"), JSON.stringify(report, null, 2));
    if (chrome) { try { chrome.child.kill("SIGKILL"); } catch { /* ignore */ } try { chrome.client.close(); } catch { /* ignore */ } }
    if (dev) { try { process.kill(-dev.child.pid, "SIGTERM"); } catch { try { dev.child.kill("SIGTERM"); } catch { /* ignore */ } } }
  }
  console.log("\n== summary ==");
  console.log(JSON.stringify(report, null, 2).slice(0, 6000));
}

main().catch((error) => { console.error(error); process.exit(1); });
