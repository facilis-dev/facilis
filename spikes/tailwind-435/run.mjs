#!/usr/bin/env node
/**
 * Spike: template v2 (Tailwind CSS v4 + Base UI + copy-in shadcn components) end to end in
 * the real Studio. No mocks: CDP drives the IDE, which boots the WebContainer, generates the
 * project from examples/todo-app, installs with npm in the VM, runs Vite and paints the preview.
 *
 * Answers:
 *   - the v2 dependency set installs in the VM (Tailwind, Base UI, sonner, lucide, ...)
 *   - the generated project is v2 (no @facilis/ui, styles entry is Tailwind, rescan plugin ships)
 *   - the app paints with the Tailwind theme and no .fc-* kit classes
 *   - the HMR workaround works: a NEW arbitrary utility class appears after a source edit
 *     WITHOUT touching src/styles.css (the open WASI scanner bug, tailwindcss#20605)
 *
 * Usage: node spikes/template-v2/run.mjs
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChrome, openPage } from "../../scripts/dev/cdp.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOOLING = process.env.FACILIS_TOOLING_DIR || "/tmp/facilis-dev";
const ARTIFACTS = path.join(TOOLING, "spike-template-v2", String(Date.now()));
const CHROME = process.env.FACILIS_CHROME || path.join(TOOLING, "browser/chrome/chrome");
const SYSROOT = process.env.FACILIS_BROWSER_SYSROOT || path.join(TOOLING, "browser/sysroot");
const FONTCONFIG = process.env.FACILIS_FONTCONFIG || path.join(TOOLING, "browser/fonts.conf");

const BOOT_TIMEOUT_MS = Number(process.env.SPIKE_BOOT_TIMEOUT_MS || 240000);
const INSTALL_TIMEOUT_MS = Number(process.env.SPIKE_INSTALL_TIMEOUT_MS || 480000);
const HMR_TIMEOUT_MS = Number(process.env.SPIKE_HMR_TIMEOUT_MS || 25000);
const PROJECT_NAME = "tw435-" + Date.now().toString(36);
const HMR_HINT = '<p className="muted">Edit src/app.tsx and save to test HMR.</p>';

const checks = [];
const record = (ok, label, detail = "") => {
  checks.push({ ok, label, detail });
  console.log((ok ? "PASS " : "FAIL ") + label + (detail ? "  " + detail : ""));
};
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
    } catch {
      /* not listening yet */
    }
    await sleep(500);
  }
  return false;
}

async function startDevServer() {
  const port = await freePort(5199);
  const url = "http://127.0.0.1:" + port + "/";
  const child = spawn(
    "pnpm",
    ["--filter", "@facilis/ide", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: REPO, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  let log = "";
  child.stdout.on("data", (chunk) => (log += chunk.toString()));
  child.stderr.on("data", (chunk) => (log += chunk.toString()));
  const up = await waitForHttp(url, 180000);
  if (!up) throw new Error("IDE dev server did not start. Log:\n" + log.slice(-3000));
  return { url, child, port };
}

function stopDevServer(child) {
  if (!child) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch { /* gone */ } }
}

const PREVIEW = '[...document.querySelectorAll("iframe")].find((f) => /preview/.test(f.src || ""))';
const inPreview = (body) =>
  "(() => { const f = " + PREVIEW + "; if (!f) return null; try { const d = f.contentDocument; const w = f.contentWindow; if (!d) return null; " +
  body +
  " } catch (error) { return { error: String(error) }; } })()";

async function waitFor(page, expression, limitMs, step = 250) {
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
      " const hit = els.find((el) => { const s = (el.innerText || '').trim(); return " +
      String(exact) + " ? s === " + JSON.stringify(text) + " : s.includes(" + JSON.stringify(text) + "); });" +
      " if (!hit) return 'NOTFOUND'; hit.click(); return 'OK'; })()",
  );
}

async function readFile(page, abs) {
  return page.evaluate("window.__ide.readFileText(" + JSON.stringify(abs) + ")");
}

async function writeFile(page, abs, contents) {
  return page.evaluate(
    'window.__ide.bridge.request("vv-write", { path: ' + JSON.stringify(abs) + ", contents: " + JSON.stringify(contents) + " })",
  );
}

// One preview probe: the HMR hint (smoke contract), the optional edit probe, the theme and
// whether any legacy .fc-* kit class is present.
function previewProbe() {
  return inPreview(
    'const probe = d.querySelector("[data-hmr-probe]");' +
      ' const hint = d.querySelector("p.muted");' +
      ' const cs = probe ? w.getComputedStyle(probe) : null;' +
      ' let css = "";' +
      ' for (const sheet of d.styleSheets) { try { css += [...sheet.cssRules].map((r) => r.cssText).join("\\n"); } catch {} }' +
      ' return {' +
      '  hintFound: Boolean(hint),' +
      '  hintText: hint ? (hint.textContent || "").trim() : null,' +
      '  probeFound: Boolean(probe),' +
      '  probeBg: cs ? cs.backgroundColor : null,' +
      '  hasFcClass: Boolean(d.querySelector("[class*=\\"fc-\\"]")),' +
      '  bodyBg: w.getComputedStyle(d.body).backgroundColor,' +
      '  bodyFont: w.getComputedStyle(d.body).fontFamily,' +
      '  cssLength: css.length,' +
      '  cssHasArbitrary: css.includes("#123456"),' +
      '  cssHasTailwind: css.includes("--tw-") || css.length > 20000,' +
      " };",
  );
}

async function pollPreview(page, predicate, limitMs) {
  const until = Date.now() + limitMs;
  let last = null;
  while (Date.now() < until) {
    last = await page.evaluate(previewProbe()).catch(() => null);
    if (last && predicate(last)) return { ok: true, probe: last };
    await sleep(300);
  }
  return { ok: false, probe: last };
}

const TERM_TEXT = [
  "(id) => {",
  "  try {",
  "    const entry = window.__ide.terminals.entry(id);",
  "    const term = entry && entry.term;",
  "    if (!term) return { error: 'no entry' };",
  "    const buffer = term.buffer && term.buffer.active;",
  "    if (!buffer) return { error: 'no buffer' };",
  "    const lines = [];",
  "    for (let i = 0; i < buffer.length; i++) {",
  "      const line = buffer.getLine(i);",
  "      if (line) lines.push(line.translateToString(true));",
  "    }",
  "    return { text: lines.join(String.fromCharCode(10)) };",
  "  } catch (error) {",
  "    return { error: String(error) };",
  "  }",
  "}",
].join("\n");

const SNAP = [
  "(() => {",
  "  const s = window.__ide.getSnapshot();",
  "  return { runPhase: s.runPhase || null, terminals: s.terminals || [] };",
  "})()",
].join("\n");

async function readTerminalState(page) {
  const snap = await page.evaluate(SNAP);
  const terminals = [];
  for (const meta of snap.terminals) {
    const value = await page.evaluate("(" + TERM_TEXT + ")(" + JSON.stringify(meta.id) + ")");
    terminals.push({ id: meta.id, label: meta.label, text: (value && value.text) || "" });
  }
  return { snap, terminals };
}

const XTERM = [
  "(() => {",
  "  try {",
  "    const rows = [...document.querySelectorAll('.xterm-rows > div')].map((r) => r.textContent || '');",
  "    if (rows.length > 0) return rows.join('\\n').slice(-14000);",
  "    const host = document.querySelector('.xterm');",
  "    return host ? (host.textContent || '').slice(-14000) : '';",
  "  } catch { return ''; }",
  "})()",
].join("\n");

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  console.log("artifacts: " + ARTIFACTS);
  const report = { ok: false, startedAt: new Date().toISOString(), timings: {}, checks, files: {}, hmr: null, probes: [] };
  let dev = null;
  let chrome = null;
  let page = null;
  try {
    dev = await startDevServer();
    console.log("studio url: " + dev.url);
    if (!fs.existsSync(CHROME)) throw new Error("chrome not found: " + CHROME);
    chrome = await launchChrome({
      chrome: CHROME,
      profileDir: path.join(ARTIFACTS, "profile"),
      homeDir: path.join(ARTIFACTS, "home"),
      sysroot: fs.existsSync(SYSROOT) ? SYSROOT : "",
      fontconfigFile: fs.existsSync(FONTCONFIG) ? FONTCONFIG : "",
    });
    page = await openPage(chrome.client, dev.url);

    const t0 = Date.now();
    const booted = await waitFor(page, '((window.__vvBoot || []).some((m) => m.name === "kernel-online"))', BOOT_TIMEOUT_MS);
    report.timings.kernelOnlineMs = Date.now() - t0;
    record(booted, "kernel online", report.timings.kernelOnlineMs + "ms");
    if (!booted) throw new Error("kernel never came online");
    await page.screenshot(path.join(ARTIFACTS, "01-home.png"));

    let home = await clickText(page, "New project");
    if (home !== "OK") {
      await clickText(page, "Home");
      await sleep(1200);
      home = await clickText(page, "New project");
    }
    record(home === "OK", "new-project dialog opens");
    await sleep(400);
    const named = await page.evaluate(
      "(() => { const input = document.querySelector('input[placeholder=my-app]');" +
        " if (!input) return 'NOTFOUND';" +
        " const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;" +
        " set.call(input, " + JSON.stringify(PROJECT_NAME) + ");" +
        " input.dispatchEvent(new Event('input', { bubbles: true })); return 'OK'; })()",
    );
    record(named === "OK", "project name filled");
    const createReady = await waitFor(page, "Boolean([...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Create' && !b.disabled))", 15000);
    record(createReady, "Create button enabled");

    const installStartedAt = Date.now();
    await clickText(page, "Create", true);
    const created = await waitFor(page, '((window.__vvBoot || []).some((m) => m.name === "install-start"))', 20000);
    record(created, "project created, install started");

    report.runSamples = [];
    let painted = false;
    const until = Date.now() + INSTALL_TIMEOUT_MS;
    while (Date.now() < until) {
      const state = await readTerminalState(page).catch(() => null);
      const paintedNow = await page.evaluate('((window.__vvBoot || []).some((m) => m.name === "preview-paint"))').catch(() => false);
      if (state) {
        report.runSamples.push({
          at: Date.now() - installStartedAt,
          phase: state.snap.runPhase,
          terminals: state.terminals.map((t) => ({ id: t.id, label: t.label, tail: t.text.slice(-2500) })),
        });
      }
      if (paintedNow) { painted = true; break; }
      const all = state ? state.terminals.map((t) => t.text).join("\n") : "";
      if (/(npm error|npm ERR!|Error:|ENOENT|EBADPLATFORM|ELIFECYCLE|failed to load|Cannot find|Cannot load)/.test(all) && report.runSamples.length > 2) {
        await sleep(3000);
        break;
      }
      await sleep(4000);
    }
    report.timings.installToPreviewPaintMs = Date.now() - installStartedAt;
    record(painted, "preview painted (install + dev in VM)", report.timings.installToPreviewPaintMs + "ms");
    for (const term of (report.runSamples.at(-1)?.terminals || [])) {
      console.log("\n[run terminal " + term.id + " " + term.label + "]\n" + term.tail.slice(-3500));
    }
    await sleep(1500);
    await page.screenshot(path.join(ARTIFACTS, "02-preview.png"));

    const root = await page.evaluate("(() => { const c = window.__ide; const f = c && c.activeFolder; return f ? f.rootPath : ''; })()");
    record(Boolean(root), "project root resolved", String(root));
    report.projectRoot = root;

    if (root) {
      const pkgText = String(await readFile(page, root + "/package.json"));
      report.files.packageJson = pkgText.slice(0, 4000);
      let pkg = {};
      try { pkg = JSON.parse(pkgText); } catch { /* recorded below */ }
      const deps = pkg.dependencies || {};
      const devDeps = pkg.devDependencies || {};
      record(deps["@facilis/ui"] === undefined, "generated package.json has no @facilis/ui");
      record(Boolean(deps["@base-ui/react"]), "generated package.json depends on @base-ui/react", String(deps["@base-ui/react"]));
      record(Boolean(deps.sonner) && Boolean(deps["lucide-react"]), "generated package.json has sonner + lucide-react");
      const tw = devDeps.tailwindcss;
      const twVite = devDeps["@tailwindcss/vite"];
      const oxide = devDeps["@tailwindcss/oxide-wasm32-wasi"];
      record(Boolean(tw) && Boolean(twVite) && Boolean(oxide), "generated devDependencies ship the Tailwind trio", "tailwindcss=" + tw + " vite=" + twVite + " oxide=" + oxide);
      record(tw === oxide && tw === twVite, "the Tailwind trio is pinned to one exact version", String(tw));
      record(Boolean(devDeps.vite) && Boolean(devDeps["@vitejs/plugin-react"]), "generated devDependencies keep vite + plugin-react");

      const css = String(await readFile(page, root + "/src/styles.css"));
      record(css.includes('@import "tailwindcss"'), "generated styles.css is the Tailwind entry");
      const hasRescan = String(await readFile(page, root + "/vite-plugins/tailwind-rescan.ts"));
      record(hasRescan.length === 0, "generated project ships no HMR rescan plugin");
      const hasUi = String(await readFile(page, root + "/node_modules/@facilis/ui/package.json"));
      record(hasUi.length === 0, "node_modules has no @facilis/ui");
      for (const name of ["tailwindcss", "@base-ui/react", "sonner", "lucide-react"]) {
        const text = String(await readFile(page, root + "/node_modules/" + name + "/package.json"));
        record(text.length > 0, "node_modules has " + name);
      }
    }

    // The app must paint with Tailwind: the theme background + the muted HMR hint, no .fc-* class.
    const first = await pollPreview(page, (p) => p.hintFound === true, 20000);
    report.probes.push(first.probe);
    record(first.probe?.hintFound === true, "preview renders the HMR hint (smoke contract)", String(first.probe?.hintText));
    record(first.probe?.hasFcClass === false, "preview uses no legacy .fc-* kit class");
    const bodyBg = first.probe?.bodyBg || "";
    record(bodyBg === "rgb(247, 248, 249)" || bodyBg === "rgb(11, 13, 16)", "Tailwind base layer paints the theme background", bodyBg);
    record(String(first.probe?.bodyFont || "").includes("Geist"), "Geist font loaded from the template theme", String(first.probe?.bodyFont));
    record(first.probe?.cssHasTailwind === true, "preview ships generated Tailwind CSS", "cssLength=" + String(first.probe?.cssLength));

    // HMR at 4.3.5 with no workaround: a NEW arbitrary utility class must apply on its own.
    if (root) {
      const appAbs = root + "/src/app.tsx";
      const original = String(await readFile(page, appAbs));
      record(original.includes(HMR_HINT), "template app.tsx contains the exact HMR hint");
      const genPkg = JSON.parse(String(await readFile(page, root + "/package.json")));
      record(genPkg.devDependencies.tailwindcss === "4.3.5", "generated devDependencies pin tailwindcss 4.3.5", String(genPkg.devDependencies.tailwindcss));
      const installed = JSON.parse(String(await readFile(page, root + "/node_modules/tailwindcss/package.json"))).version;
      record(installed === "4.3.5", "the VM installed tailwindcss 4.3.5", installed);
      record(!String(await readFile(page, root + "/vite.config.ts")).includes("tailwindRescanInVm"), "generated vite.config.ts has no rescan workaround");
      const edited = original.replace(HMR_HINT, '<p className="muted bg-[#7c3aed]" data-hmr-probe="1">Edit src/app.tsx and save to test HMR.</p>');
      await writeFile(page, appAbs, edited);
      record(String(await readFile(page, appAbs)).includes("data-hmr-probe"), "probe write landed");
      const applied = await pollPreview(page, (p) => p.probeBg === "rgb(124, 58, 237)", HMR_TIMEOUT_MS);
      report.hmr435 = { ok: applied.ok, probe: applied.probe };
      record(applied.ok, "HMR at 4.3.5 without the rescan workaround: new arbitrary class applied", applied.ok ? "rgb(124, 58, 237)" : "bg=" + String(applied.probe?.probeBg));
    }

    report.terminalTail = String(await page.evaluate(XTERM)).slice(-14000);
    fs.writeFileSync(path.join(ARTIFACTS, "terminal.txt"), report.terminalTail);
    report.consoleErrors = page.consoleEntries.filter((e) => e.type === "error" || e.type === "warning").slice(-40);
    report.pageErrors = page.pageErrors.slice(-20);
    report.failedRequests = page.failedRequests.slice(-40);
    const downloads = page.downloads();
    report.downloads = {
      count: downloads.length,
      totalBytes: downloads.reduce((n, d) => n + d.bytes, 0),
      relevantCount: downloads.filter((d) => /tailwind|oxide|base-ui|sonner|lucide|emnapi|napi/i.test(d.url)).length,
    };
    report.statusText = String(await page.evaluate("document.body.innerText").catch(() => "")).slice(-3000);
    fs.writeFileSync(path.join(ARTIFACTS, "status.txt"), report.statusText);
    fs.writeFileSync(path.join(ARTIFACTS, "page-errors.json"), JSON.stringify({ console: report.consoleErrors, page: report.pageErrors, failed: report.failedRequests }, null, 2));
    report.terminalHighlights = report.terminalTail
      .split("\n")
      .filter((line) => /tailwind|oxide|wasm|npm (warn|error)|added \d+ packages|vite|ready in|Geist/i.test(line))
      .slice(-25);
  } catch (error) {
    record(false, "spike crashed", error instanceof Error ? error.message.slice(0, 800) : String(error));
    if (page) {
      try {
        report.failure = await page.evaluate(
          "({ marks: window.__vvBoot || [], ready: document.readyState, href: location.href," +
            " text: (document.body.innerText || '').slice(-3000) })",
        );
        await page.screenshot(path.join(ARTIFACTS, "99-failure.png"));
      } catch { /* page is gone */ }
    }
  } finally {
    report.ok = checks.every((check) => check.ok);
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(ARTIFACTS, "report.json"), JSON.stringify(report, null, 2));
    if (chrome) {
      try { chrome.child.kill("SIGKILL"); } catch { /* ignore */ }
      try { chrome.client.close(); } catch { /* ignore */ }
    }
    if (dev) stopDevServer(dev.child);
  }

  console.log("\n== report ==");
  console.log(JSON.stringify({
    ok: report.ok,
    timings: report.timings,
    hmr: report.hmr && { firstTry: report.hmr.firstTry, afterCssTouch: report.hmr.afterCssTouch?.ok },
    packageJson: (report.files.packageJson || "").slice(0, 1600),
    probes: report.probes,
    terminalHighlights: report.terminalHighlights || [],
    consoleErrors: report.consoleErrors,
    pageErrors: report.pageErrors,
    failedRequests: report.failedRequests,
    artifacts: ARTIFACTS,
  }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
