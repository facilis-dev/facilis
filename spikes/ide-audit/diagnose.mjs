#!/usr/bin/env node
/**
 * Spike: does a kernel VFS write reach the running preview at all?
 *
 * Minimal, single-file change: replace src/app.tsx with a static page, wait, and record what the
 * file on disk, the preview, the terminal and the console each say. This isolates the observed
 * "preview shows the old app after a write" from any import or route problem.
 *
 * Usage: node spikes/ide-audit/diagnose.mjs
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChrome, openPage } from "../../scripts/dev/cdp.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOOLING = process.env.FACILIS_TOOLING_DIR || "/tmp/facilis-dev";
const ARTIFACTS = path.join(TOOLING, "spike-diagnose", String(Date.now()));
const CHROME = process.env.FACILIS_CHROME || path.join(TOOLING, "browser/chrome/chrome");
const SYSROOT = process.env.FACILIS_BROWSER_SYSROOT || path.join(TOOLING, "browser/sysroot");
const FONTCONFIG = process.env.FACILIS_FONTCONFIG || path.join(TOOLING, "browser/fonts.conf");
const PROJECT = "diag-" + Date.now().toString(36);

const TARGET = `import { Toaster } from "./components/ui/sonner.tsx";

export function App() {
  return (
    <>
      <main className="flex min-h-dvh flex-col gap-3 bg-background p-10 text-foreground">
        <h1 className="text-3xl font-semibold tracking-tight">VFS write applied</h1>
        <p className="text-muted-foreground">This page came from a kernel write.</p>
      </main>
      <Toaster />
      <p className="muted">Edit src/app.tsx and save to test HMR.</p>
    </>
  );
}
`;

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
  while (Date.now() < until) { try { if ((await fetch(url)).ok) return { url, child }; } catch { /* up yet */ } await sleep(500); }
  throw new Error("IDE did not start: " + log.slice(-2000));
}

async function waitFor(page, expression, limitMs, step = 300) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) { if (await page.evaluate(expression).catch(() => false)) return true; await sleep(step); }
  return false;
}

const XTERM = "(() => { const rows = [...document.querySelectorAll('.xterm-rows > div')].map((r) => r.textContent || ''); return rows.join(String.fromCharCode(10)).slice(-6000); })()";

async function previewText(page) {
  return page.evaluate('(() => { const f = [...document.querySelectorAll("iframe")].find((x) => /preview/.test(x.src || "")); if (!f || !f.contentDocument || !f.contentDocument.body) return null; return (f.contentDocument.body.innerText || "").slice(0, 300); })()').catch((error) => "ERR " + String(error));
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const report = { artifacts: ARTIFACTS, steps: [], console: [], pageErrors: [] };
  let dev = null, chrome = null;
  try {
    dev = await startDevServer();
    chrome = await launchChrome({ chrome: CHROME, profileDir: path.join(ARTIFACTS, "profile"), homeDir: path.join(ARTIFACTS, "home"), sysroot: fs.existsSync(SYSROOT) ? SYSROOT : "", fontconfigFile: fs.existsSync(FONTCONFIG) ? FONTCONFIG : "" });
    const page = await openPage(chrome.client, dev.url);
    if (!(await waitFor(page, '((window.__vvBoot || []).some((m) => m.name === "kernel-online"))', 240000))) throw new Error("no kernel");
    const openUntil = Date.now() + 25000;
    const dialogOpen = async () => page.evaluate("Boolean(document.querySelector('input[placeholder=my-app]'))").catch(() => false);
    while (Date.now() < openUntil && !(await dialogOpen())) {
      await page.evaluate("(() => { const el = [...document.querySelectorAll('button,[role=button],a')].find((x) => (x.innerText || '').includes('New project')); if (el) el.click(); })()");
      await sleep(700);
      if (!(await dialogOpen())) await page.evaluate("(() => { const el = [...document.querySelectorAll('button,[role=button],a')].find((x) => (x.innerText || '').trim() === 'Home'); if (el) el.click(); })()");
    }
    if (!(await dialogOpen())) throw new Error("dialog never opened");
    await page.evaluate("(() => { const input = document.querySelector('input[placeholder=my-app]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, " + JSON.stringify(PROJECT) + "); input.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await waitFor(page, "Boolean([...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Create' && !b.disabled))", 15000);
    await page.evaluate("(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === 'Create'); if (b) b.click(); })()");
    if (!(await waitFor(page, '((window.__vvBoot || []).some((m) => m.name === "preview-paint"))', 540000, 3000))) throw new Error("no preview");
    await sleep(2000);
    const root = await page.evaluate("(() => { const c = window.__ide; const f = c && c.activeFolder; return f ? f.rootPath : ''; })()");
    report.root = root;
    report.before = { preview: await previewText(page) };
    await page.screenshot(path.join(ARTIFACTS, "01-before.png"));

    await page.evaluate('window.__ide.bridge.request("vv-write", { path: ' + JSON.stringify(root + "/src/app.tsx") + ", contents: " + JSON.stringify(TARGET) + " })");
    const writeAt = Date.now();
    for (let i = 0; i < 8; i++) {
      await sleep(4000);
      const readback = String(await page.evaluate("window.__ide.readFileText(" + JSON.stringify(root + "/src/app.tsx") + ")").catch(() => ""));
      const preview = await previewText(page);
      report.steps.push({ atMs: Date.now() - writeAt, preview, readbackHasHeading: readback.includes("VFS write applied"), readbackFirst: readback.slice(0, 60) });
      console.log("t+" + Math.round((Date.now() - writeAt) / 1000) + "s preview=" + JSON.stringify(String(preview).slice(0, 80)) + " readback=" + (readback.includes("VFS write applied") ? "new" : "old"));
    }
    await page.screenshot(path.join(ARTIFACTS, "02-after.png"));
    report.terminal = String(await page.evaluate(XTERM).catch(() => ""));
    report.console = page.consoleEntries.slice(-30);
    report.pageErrors = page.pageErrors.slice(-10);
  } catch (error) {
    report.error = String(error).slice(0, 800);
    console.log("FAILED: " + report.error);
  } finally {
    fs.writeFileSync(path.join(ARTIFACTS, "report.json"), JSON.stringify(report, null, 2));
    console.log("\n== report ==");
    console.log(JSON.stringify({ before: report.before, steps: report.steps && report.steps.slice(-4), terminalTail: (report.terminal || "").slice(-1500), errors: report.pageErrors, consoleErrors: (report.console || []).filter((e) => e.type === "error").slice(-8), artifacts: ARTIFACTS }, null, 2));
    if (chrome) { try { chrome.child.kill("SIGKILL"); } catch { /* ignore */ } try { chrome.client.close(); } catch { /* ignore */ } }
    if (dev) { try { process.kill(-dev.child.pid, "SIGTERM"); } catch { try { dev.child.kill("SIGTERM"); } catch { /* ignore */ } } }
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
