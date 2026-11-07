#!/usr/bin/env node
/**
 * Spike: land the first real page in the Studio, and pin down F-001.
 *
 * Writes src/pages/home.tsx and a new src/app.tsx through the kernel VFS. If the preview keeps
 * the old app (the F-001 symptom), it reloads the preview frame once and re-checks: that tells us
 * whether a full reload is a sufficient fallback for a failed hot update. It also checks whether
 * the explorer lists the file created outside the UI (F-008), then exports the project.
 *
 * Usage: node spikes/ide-audit/land-home.mjs
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChrome, openPage } from "../../scripts/dev/cdp.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOOLING = process.env.FACILIS_TOOLING_DIR || "/tmp/facilis-dev";
const ARTIFACTS = path.join(TOOLING, "spike-land-home", String(Date.now()));
const CHROME = process.env.FACILIS_CHROME || path.join(TOOLING, "browser/chrome/chrome");
const SYSROOT = process.env.FACILIS_BROWSER_SYSROOT || path.join(TOOLING, "browser/sysroot");
const FONTCONFIG = process.env.FACILIS_FONTCONFIG || path.join(TOOLING, "browser/fonts.conf");
const DOWNLOADS = path.join(ARTIFACTS, "downloads");
const PROJECT = process.env.SITE_PROJECT_NAME || "facilis-dev";
const HOME_PAGE = fs.readFileSync("/tmp/site-home-page.tsx", "utf8");
const APP = fs.readFileSync("/tmp/site-app.tsx", "utf8");
const MARK = "Security is the fast path";

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
  throw new Error("no free port");
}

async function startDevServer() {
  const port = await freePort(5199);
  const url = "http://127.0.0.1:" + port + "/";
  const child = spawn("pnpm", ["--filter", "@facilis/ide", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: REPO, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  child.stdout.on("data", (c) => (log += c.toString()));
  child.stderr.on("data", (c) => (log += c.toString()));
  const until = Date.now() + 180000;
  while (Date.now() < until) { try { if ((await fetch(url)).ok) return { url, child }; } catch { /* not up */ } await sleep(500); }
  throw new Error("IDE did not start: " + log.slice(-2000));
}

async function waitFor(page, expression, limitMs, step = 300) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) { if (await page.evaluate(expression).catch(() => false)) return true; await sleep(step); }
  return false;
}

const PREVIEW = '[...document.querySelectorAll("iframe")].find((f) => /preview/.test(f.src || ""))';
const inPreview = (body) => "(() => { const f = " + PREVIEW + "; if (!f) return null; try { const d = f.contentDocument; const w = f.contentWindow; if (!d || !w) return null; " + body + " } catch (error) { return { error: String(error) }; } })()";
const previewHasMark = inPreview("return Boolean(d.body && (d.body.innerText || '').includes(" + JSON.stringify(MARK) + "));");

const XTERM = "(() => { const rows = [...document.querySelectorAll('.xterm-rows > div')].map((r) => r.textContent || ''); return rows.join(String.fromCharCode(10)).slice(-4000); })()";

async function writeFile(page, abs, contents) {
  return page.evaluate('window.__ide.bridge.request("vv-write", { path: ' + JSON.stringify(abs) + ", contents: " + JSON.stringify(contents) + " })");
}

async function main() {
  fs.mkdirSync(DOWNLOADS, { recursive: true });
  const report = { artifacts: ARTIFACTS, timings: {}, findings: [] };
  const finding = (id, text) => { report.findings.push({ id, text }); console.log("FINDING " + id + " " + text); };
  let dev = null, chrome = null;
  try {
    dev = await startDevServer();
    chrome = await launchChrome({ chrome: CHROME, profileDir: path.join(ARTIFACTS, "profile"), homeDir: path.join(ARTIFACTS, "home"), sysroot: fs.existsSync(SYSROOT) ? SYSROOT : "", fontconfigFile: fs.existsSync(FONTCONFIG) ? FONTCONFIG : "" });
    await chrome.client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS });
    const page = await openPage(chrome.client, dev.url);
    if (!(await waitFor(page, '((window.__vvBoot || []).some((m) => m.name === "kernel-online"))', 240000))) throw new Error("no kernel");
    const dialogOpen = async () => page.evaluate("Boolean(document.querySelector('input[placeholder=my-app]'))").catch(() => false);
    const until = Date.now() + 25000;
    while (Date.now() < until && !(await dialogOpen())) {
      await page.evaluate("(() => { const el = [...document.querySelectorAll('button,[role=button],a')].find((x) => (x.innerText || '').includes('New project')); if (el) el.click(); })()");
      await sleep(700);
      if (!(await dialogOpen())) await page.evaluate("(() => { const el = [...document.querySelectorAll('button,[role=button],a')].find((x) => (x.innerText || '').trim() === 'Home'); if (el) el.click(); })()");
    }
    if (!(await dialogOpen())) throw new Error("dialog never opened");
    await page.evaluate("(() => { const input = document.querySelector('input[placeholder=my-app]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, " + JSON.stringify(PROJECT) + "); input.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await waitFor(page, "Boolean([...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Create' && !b.disabled))", 15000);
    const createAt = Date.now();
    await page.evaluate("(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === 'Create'); if (b) b.click(); })()");
    if (!(await waitFor(page, '((window.__vvBoot || []).some((m) => m.name === "preview-paint"))', 540000, 3000))) throw new Error("no preview");
    report.timings.createToPreviewMs = Date.now() - createAt;
    await sleep(2000);
    const root = await page.evaluate("(() => { const c = window.__ide; const f = c && c.activeFolder; return f ? f.rootPath : ''; })()");
    report.root = root;

    const writeAt = Date.now();
    await writeFile(page, root + "/src/pages/home.tsx", HOME_PAGE);
    await writeFile(page, root + "/src/app.tsx", APP);
    const shown = await waitFor(page, previewHasMark, 15000, 500);
    report.timings.writeToPreviewMs = shown ? Date.now() - writeAt : null;
    report.hotUpdateApplied = shown;
    await page.screenshot(path.join(ARTIFACTS, "01-after-write.png"));

    if (!shown) {
      finding("F-001", "hot update did not apply the new page; trying a preview reload");
      const reloaded = await page.evaluate(inPreview("w.location.reload(); return true;")).catch((error) => "ERR " + String(error));
      report.reload = reloaded;
      const shownAfter = await waitFor(page, previewHasMark, 30000, 500);
      report.reloadFixed = shownAfter;
      report.timings.reloadToPreviewMs = shownAfter ? Date.now() - writeAt : null;
      await page.screenshot(path.join(ARTIFACTS, "02-after-reload.png"));
      if (shownAfter) finding("F-001-workaround", "a full reload of the preview frame applies the change");
      else finding("F-001-still-broken", "the change still does not show after a preview reload");
    }

    // F-008: does the explorer list a file created outside the UI? Expand src/pages first.
    await page.evaluate("(() => { const rows = [...document.querySelectorAll('div,span,button,a')].filter((x) => (x.innerText || '').trim() === 'pages'); const r = rows[0]; if (r) r.click(); })()");
    await sleep(800);
    report.explorerShowsHome = await page.evaluate("(document.body.innerText || '').includes('home.tsx')");
    if (!report.explorerShowsHome) finding("F-008", "the explorer does not list a file created through the VFS");
    await page.screenshot(path.join(ARTIFACTS, "03-explorer.png"));

    const probe = await page.evaluate(inPreview(
      'const h1 = d.querySelector("h1"); const cs = h1 ? w.getComputedStyle(h1) : null;' +
        ' return { title: h1 ? h1.textContent : null, size: cs ? cs.fontSize : null, family: cs ? cs.fontFamily : null,' +
        '  text: (d.body.innerText || "").slice(0, 300) };',
    ));
    report.preview = probe;

    await page.evaluate("window.__ide.exportProjectZip(" + JSON.stringify(root) + ")");
    const zipUntil = Date.now() + 60000;
    let zipPath = null;
    while (Date.now() < zipUntil && !zipPath) {
      const files = fs.existsSync(DOWNLOADS) ? fs.readdirSync(DOWNLOADS).filter((f) => /[.]zip$/.test(f)) : [];
      if (files.length > 0) { const c = path.join(DOWNLOADS, files[0]); if (fs.statSync(c).size > 0) zipPath = c; }
      await sleep(500);
    }
    report.zipPath = zipPath;
    report.terminal = String(await page.evaluate(XTERM).catch(() => ""));
    report.console = page.consoleEntries.filter((e) => e.type === "error").slice(-10);
    report.ok = Boolean(zipPath && (shown || report.reloadFixed));
  } catch (error) {
    report.error = String(error).slice(0, 800);
    console.log("FAILED: " + report.error);
  } finally {
    fs.writeFileSync(path.join(ARTIFACTS, "report.json"), JSON.stringify(report, null, 2));
    console.log("\n== summary ==");
    console.log(JSON.stringify({ ok: report.ok, timings: report.timings, hotUpdateApplied: report.hotUpdateApplied, reloadFixed: report.reloadFixed, explorerShowsHome: report.explorerShowsHome, preview: report.preview, findings: report.findings, zipPath: report.zipPath, terminalTail: (report.terminal || "").slice(-900), consoleErrors: report.console, artifacts: ARTIFACTS }, null, 2));
    if (chrome) { try { chrome.child.kill("SIGKILL"); } catch { /* ignore */ } try { chrome.client.close(); } catch { /* ignore */ } }
    if (dev) { try { process.kill(-dev.child.pid, "SIGTERM"); } catch { try { dev.child.kill("SIGTERM"); } catch { /* ignore */ } } }
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
