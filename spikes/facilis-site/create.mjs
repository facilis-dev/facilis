#!/usr/bin/env node
/**
 * Spike: create the facilis.dev project inside the real Studio and export it as a zip.
 *
 * The dogfood loop this proves: Studio "New project" (template v2) -> npm install in the
 * VM -> Vite dev -> preview -> "Export Project as Zip" -> a unit of work we can commit.
 * It also records the timings and the dialog surface, because the journal needs facts.
 *
 * Usage: node spikes/facilis-site/create.mjs
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChrome, openPage } from "../../scripts/dev/cdp.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOOLING = process.env.FACILIS_TOOLING_DIR || "/tmp/facilis-dev";
const ARTIFACTS = path.join(TOOLING, "spike-facilis-site", String(Date.now()));
const CHROME = process.env.FACILIS_CHROME || path.join(TOOLING, "browser/chrome/chrome");
const SYSROOT = process.env.FACILIS_BROWSER_SYSROOT || path.join(TOOLING, "browser/sysroot");
const FONTCONFIG = process.env.FACILIS_FONTCONFIG || path.join(TOOLING, "browser/fonts.conf");
const DOWNLOADS = path.join(ARTIFACTS, "downloads");
const PROJECT_NAME = process.env.SITE_PROJECT_NAME || "facilis-dev";
const BOOT_TIMEOUT_MS = Number(process.env.SITE_BOOT_TIMEOUT_MS || 240000);
const INSTALL_TIMEOUT_MS = Number(process.env.SITE_INSTALL_TIMEOUT_MS || 540000);

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

async function waitForHttp(url, limitMs) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch { /* not listening yet */ }
    await sleep(500);
  }
  return false;
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
  if (!(await waitForHttp(url, 180000))) throw new Error("IDE dev server did not start. Log:\n" + log.slice(-3000));
  return { url, child };
}

const inPreview = (body) => "(() => { const f = [...document.querySelectorAll('iframe')].find((x) => /preview/.test(x.src || '')); if (!f) return null; try { const d = f.contentDocument; if (!d) return null; " + body + " } catch (error) { return { error: String(error) }; } })()";

async function waitFor(page, expression, limitMs, step = 300) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    if (await page.evaluate(expression).catch(() => false)) return true;
    await sleep(step);
  }
  return false;
}

async function clickText(page, text, exact = false) {
  return page.evaluate(
    "(() => { const els = [...document.querySelectorAll('button,[role=button],a,[role=tab]')];" +
      " const hit = els.find((el) => { const s = (el.innerText || '').trim(); return " + String(exact) + " ? s === " + JSON.stringify(text) + " : s.includes(" + JSON.stringify(text) + "); });" +
      " if (!hit) return 'NOTFOUND'; hit.click(); return 'OK'; })()",
  );
}

function dialogSurface() {
  return "(() => { const dialog = document.querySelector('[role=dialog]') || document.body;" +
    " return { text: (dialog.innerText || '').slice(0, 1500), buttons: [...dialog.querySelectorAll('button')].map((b) => (b.innerText || '').trim()).filter(Boolean) }; })()";
}

async function main() {
  fs.mkdirSync(DOWNLOADS, { recursive: true });
  const report = { ok: false, startedAt: new Date().toISOString(), timings: {}, project: {}, downloads: [], checks: [] };
  const record = (ok, label, detail = "") => {
    report.checks.push({ ok, label, detail });
    console.log((ok ? "PASS " : "FAIL ") + label + (detail ? "  " + detail : ""));
  };
  let dev = null;
  let chrome = null;
  try {
    dev = await startDevServer();
    console.log("studio url: " + dev.url);
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
    const booted = await waitFor(page, '((window.__vvBoot || []).some((m) => m.name === "kernel-online"))', BOOT_TIMEOUT_MS);
    report.timings.kernelOnlineMs = Date.now() - t0;
    record(booted, "kernel online", report.timings.kernelOnlineMs + "ms");
    if (!booted) throw new Error("kernel never came online");
    await page.screenshot(path.join(ARTIFACTS, "01-home.png"));

    let home = await clickText(page, "New project");
    if (home !== "OK") { await clickText(page, "Home"); await sleep(1200); home = await clickText(page, "New project"); }
    record(home === "OK", "new-project dialog opens");
    await sleep(400);
    report.createDialog = await page.evaluate(dialogSurface());

    const named = await page.evaluate(
      "(() => { const input = document.querySelector('input[placeholder=my-app]');" +
        " if (!input) return 'NOTFOUND';" +
        " const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;" +
        " set.call(input, " + JSON.stringify(PROJECT_NAME) + ");" +
        " input.dispatchEvent(new Event('input', { bubbles: true })); return 'OK'; })()",
    );
    record(named === "OK", "project name filled");
    await page.screenshot(path.join(ARTIFACTS, "02-create-dialog.png"));
    record(await waitFor(page, "Boolean([...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Create' && !b.disabled))", 15000), "Create button enabled");

    const installStartedAt = Date.now();
    await clickText(page, "Create", true);
    record(await waitFor(page, '((window.__vvBoot || []).some((m) => m.name === "install-start"))', 20000), "project created, install started");

    const until = Date.now() + INSTALL_TIMEOUT_MS;
    let painted = false;
    while (Date.now() < until) {
      if (await page.evaluate('((window.__vvBoot || []).some((m) => m.name === "preview-paint"))').catch(() => false)) { painted = true; break; }
      await sleep(3000);
    }
    report.timings.installToPreviewPaintMs = Date.now() - installStartedAt;
    record(painted, "preview painted (install + dev in VM)", report.timings.installToPreviewPaintMs + "ms");
    await sleep(1500);
    await page.screenshot(path.join(ARTIFACTS, "03-preview.png"));

    const root = await page.evaluate("(() => { const c = window.__ide; const f = c && c.activeFolder; return f ? f.rootPath : ''; })()");
    report.project.root = root || null;
    report.project.name = PROJECT_NAME;
    record(Boolean(root), "project root resolved", String(root));

    if (root) {
      report.project.packageJson = String(await page.evaluate("window.__ide.readFileText(" + JSON.stringify(root + "/package.json") + ")")).slice(0, 4000);
      report.project.appTsx = String(await page.evaluate("window.__ide.readFileText(" + JSON.stringify(root + "/src/app.tsx") + ")")).slice(0, 3000);
      report.previewProbe = await page.evaluate(inPreview('return { hintText: (d.querySelector("p.muted") || {}).textContent || null, bodyBg: getComputedStyle(d.body).backgroundColor };'));
      const exported = await page.evaluate("(() => { try { const c = window.__ide; if (typeof c.exportProjectZip !== 'function') return 'NO_METHOD'; c.exportProjectZip(" + JSON.stringify(root) + "); return 'OK'; } catch (error) { return String(error); } })()");
      record(exported === "OK", "exportProjectZip invoked", String(exported));
      const zipUntil = Date.now() + 60000;
      let zipPath = null;
      while (Date.now() < zipUntil && !zipPath) {
        const files = fs.existsSync(DOWNLOADS) ? fs.readdirSync(DOWNLOADS).filter((f) => /[.]zip$/.test(f) && !/[.]crdownload$/.test(f)) : [];
        if (files.length > 0) {
          const candidate = path.join(DOWNLOADS, files[0]);
          const size = fs.statSync(candidate).size;
          if (size > 0) zipPath = candidate;
        }
        await sleep(500);
      }
      record(Boolean(zipPath), "project zip downloaded", zipPath ? zipPath + " (" + fs.statSync(zipPath).size + " bytes)" : "no zip");
      report.project.zipPath = zipPath;
    }

    report.consoleErrors = page.consoleEntries.filter((e) => e.type === "error").slice(-20);
    report.pageErrors = page.pageErrors.slice(-10);
  } catch (error) {
    record(false, "crashed", error instanceof Error ? error.message.slice(0, 800) : String(error));
  } finally {
    report.ok = report.checks.every((c) => c.ok);
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    fs.writeFileSync(path.join(ARTIFACTS, "report.json"), JSON.stringify(report, null, 2));
    if (chrome) { try { chrome.child.kill("SIGKILL"); } catch { /* ignore */ } try { chrome.client.close(); } catch { /* ignore */ } }
    if (dev) { try { process.kill(-dev.child.pid, "SIGTERM"); } catch { try { dev.child.kill("SIGTERM"); } catch { /* ignore */ } } }
  }
  console.log("\n== summary ==");
  console.log(JSON.stringify({ ok: report.ok, timings: report.timings, checks: report.checks, root: report.project.root, zip: report.project.zipPath, artifacts: ARTIFACTS }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
