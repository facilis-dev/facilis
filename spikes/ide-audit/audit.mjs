#!/usr/bin/env node
/**
 * Spike: audit the IDE surfaces while building facilis.dev (D-091).
 *
 * The goal is not to assert a contract: it is to walk every surface of the Studio with a real
 * project running, screenshot each one, and record what looks wrong — layout overflow, clipped
 * or zero-sized elements, console errors, empty panels — so the findings can become fixes.
 *
 * Usage: node spikes/ide-audit/audit.mjs
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChrome, openPage } from "../../scripts/dev/cdp.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOOLING = process.env.FACILIS_TOOLING_DIR || "/tmp/facilis-dev";
const ARTIFACTS = path.join(TOOLING, "spike-ide-audit", String(Date.now()));
const CHROME = process.env.FACILIS_CHROME || path.join(TOOLING, "browser/chrome/chrome");
const SYSROOT = process.env.FACILIS_BROWSER_SYSROOT || path.join(TOOLING, "browser/sysroot");
const FONTCONFIG = process.env.FACILIS_FONTCONFIG || path.join(TOOLING, "browser/fonts.conf");
const BOOT_TIMEOUT_MS = 240000;
const INSTALL_TIMEOUT_MS = 540000;
const PROJECT = process.env.AUDIT_PROJECT_NAME || "audit-site";

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

async function clickLabel(page, label) {
  return page.evaluate(
    "(() => { const els = [...document.querySelectorAll('button,[role=button],[aria-label],[role=menuitem]')];" +
      " const hit = els.find((el) => (el.getAttribute('aria-label') || el.innerText || '').trim() === " + JSON.stringify(label) + ");" +
      " if (!hit) return 'NOTFOUND'; hit.click(); return 'OK'; })()",
  );
}

const METRICS = [
  "(() => {",
  "  const vw = window.innerWidth, vh = window.innerHeight;",
  "  const doc = document.documentElement;",
  "  const all = [...document.querySelectorAll('body *')].slice(0, 5000);",
  "  const overflowing = [], zeroSized = [], clipped = [];",
  "  for (const el of all) {",
  "    const r = el.getBoundingClientRect();",
  "    if (r.width === 0 && r.height === 0) continue;",
  "    if (r.right > vw + 1 && r.width > 8) overflowing.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 90), right: Math.round(r.right) });",
  "    if ((r.width === 0) !== (r.height === 0) && (el.textContent || '').trim().length > 0) zeroSized.push({ tag: el.tagName, w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 40) });",
  "    if (el.children.length === 0 && el.textContent && el.textContent.trim().length > 0) {",
  "      const cs = getComputedStyle(el);",
  "      if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'visible') clipped.push({ text: el.textContent.trim().slice(0, 50), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });",
  "    }",
  "  }",
  "  const iframe = [...document.querySelectorAll('iframe')].find((f) => /preview/.test(f.src || ''));",
  "  const ir = iframe ? iframe.getBoundingClientRect() : null;",
  "  let previewText = null;",
  "  try { previewText = iframe ? (iframe.contentDocument && iframe.contentDocument.body ? (iframe.contentDocument.body.innerText || '').slice(0, 200) : null) : null; } catch { previewText = 'cross-origin'; }",
  "  return {",
  "    viewport: [vw, vh],",
  "    horizontalOverflow: doc.scrollWidth > vw + 1,",
  "    overflowing: overflowing.slice(0, 12),",
  "    zeroSized: zeroSized.slice(0, 12),",
  "    clipped: clipped.slice(0, 12),",
  "    preview: ir ? { w: Math.round(ir.width), h: Math.round(ir.height), text: previewText } : null,",
  "    text: (document.body.innerText || '').slice(0, 600),",
  "  };",
  "})()",
].join("\n");

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const report = { ok: true, startedAt: new Date().toISOString(), artifacts: ARTIFACTS, steps: [], console: [], pageErrors: [], failed: [] };
  const screenshot = async (page, name) => {
    await sleep(600);
    await page.screenshot(path.join(ARTIFACTS, name + ".png"));
    const metrics = await page.evaluate(METRICS).catch((error) => ({ error: String(error) }));
    report.steps.push({ name, metrics });
    console.log("STEP " + name + "  overflow=" + String(metrics.horizontalOverflow) + " overflowing=" + (metrics.overflowing || []).length + " clipped=" + (metrics.clipped || []).length + " preview=" + JSON.stringify(metrics.preview));
  };
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
    const page = await openPage(chrome.client, dev.url);
    if (!(await waitFor(page, '((window.__vvBoot || []).some((m) => m.name === "kernel-online"))', BOOT_TIMEOUT_MS))) {
      throw new Error("kernel never came online");
    }
    await screenshot(page, "01-home-light");

    await clickLabel(page, "New project");
    await sleep(500);
    await page.evaluate(
      "(() => { const input = document.querySelector('input[placeholder=my-app]'); if (!input) return 'NOTFOUND';" +
        " const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;" +
        " set.call(input, " + JSON.stringify(PROJECT) + "); input.dispatchEvent(new Event('input', { bubbles: true })); return 'OK'; })()",
    );
    await page.screenshot(path.join(ARTIFACTS, "02-create-dialog.png"));
    report.steps.push({ name: "02-create-dialog", metrics: await page.evaluate(METRICS).catch(() => ({})) });
    await page.evaluate("(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === 'Create' && !x.disabled); if (b) b.click(); })()");
    const painted = await waitFor(page, '((window.__vvBoot || []).some((m) => m.name === "preview-paint"))', INSTALL_TIMEOUT_MS, 3000);
    report.previewPainted = painted;
    await sleep(2500);

    const surfaces = [
      ["03-workspace", "Workspace"],
      ["04-search", "Search"],
      ["05-source-control", "Source Control"],
      ["06-data", "Data"],
      ["07-api-flow", "API Flow"],
      ["08-release-preview", "Release Preview"],
      ["09-chat", "AI Chat"],
      ["10-debug", "Run and Debug"],
    ];
    for (const [file, label] of surfaces) {
      const hit = await clickLabel(page, label);
      if (hit !== "OK") { report.steps.push({ name: file, error: "label not found: " + label }); console.log("MISSING " + label); continue; }
      await screenshot(page, file);
    }

    // Theme dropdown + dark surfaces.
    const theme = await clickLabel(page, "Theme");
    if (theme === "OK") {
      await screenshot(page, "11-theme-menu");
      await page.evaluate("(() => { const item = [...document.querySelectorAll('[role=menuitem],[role=option]')].find((x) => /^dark$/i.test((x.innerText || '').trim())); if (item) item.click(); })()");
      await sleep(800);
      await clickLabel(page, "Workspace");
      await screenshot(page, "12-workspace-dark");
    }

    // Command palette.
    await page.evaluate("document.body.focus()");
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2 | 8, key: "P", code: "KeyP", windowsVirtualKeyCode: 80 });
    await sleep(800);
    const paletteOpen = await page.evaluate("(() => { const s = window.__ide.getSnapshot(); return Boolean(s.paletteOpen); })()").catch(() => null);
    report.paletteOpen = paletteOpen;
    if (paletteOpen) await screenshot(page, "13-command-palette");
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2 | 8, key: "P", code: "KeyP", windowsVirtualKeyCode: 80 });

    // Chat settings dialog (needs the chat panel active).
    await clickLabel(page, "AI Chat");
    const settingsHit = await clickLabel(page, "Chat settings");
    if (settingsHit === "OK") await screenshot(page, "14-chat-settings");
    else report.steps.push({ name: "14-chat-settings", error: "chat settings button not found" });

    // Responsive: shrink the window and inspect.
    for (const [file, width, height] of [
      ["15-narrow-1024", 1024, 700],
      ["16-narrow-800", 800, 600],
    ]) {
      await chrome.client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      await sleep(900);
      await screenshot(page, file);
    }
    await chrome.client.send("Emulation.clearDeviceMetricsOverride");

    report.console = page.consoleEntries.filter((e) => e.type === "error" || e.type === "warning").slice(-60);
    report.pageErrors = page.pageErrors.slice(-20);
    report.failed = page.failedRequests.slice(-40);
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? error.message.slice(0, 1200) : String(error);
    console.log("AUDIT FAILED: " + report.error);
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(ARTIFACTS, "report.json"), JSON.stringify(report, null, 2));
    if (chrome) { try { chrome.child.kill("SIGKILL"); } catch { /* ignore */ } try { chrome.client.close(); } catch { /* ignore */ } }
    if (dev) { try { process.kill(-dev.child.pid, "SIGTERM"); } catch { try { dev.child.kill("SIGTERM"); } catch { /* ignore */ } } }
  }
  console.log("\n== audit ==");
  console.log(JSON.stringify({ ok: report.ok, previewPainted: report.previewPainted, paletteOpen: report.paletteOpen, steps: report.steps.map((s) => ({ name: s.name, error: s.error })), consoleErrors: report.console.slice(-12), failed: report.failed.slice(-12), artifacts: ARTIFACTS }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
