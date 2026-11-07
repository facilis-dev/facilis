#!/usr/bin/env node
/**
 * Spike: does the shadcn substrate (Tailwind CSS v4 + Base UI) work inside the IDE's
 * WebContainer, on the project the IDE actually generates?
 *
 * It drives the real Studio through CDP (scripts/dev/cdp.mjs), so nothing is mocked:
 *   boot kernel -> create a Facilis project -> in-VM npm install -> Vite dev -> preview.
 *
 * The example template is patched for the duration of the run (Tailwind plugin + deps +
 * one probe component) and restored in finally. The run answers:
 *   - npm install with Tailwind/Base UI/shadcn succeeds (WASI oxide: the native addon
 *     cannot load in the VM, so @tailwindcss/oxide-wasm32-wasi is pinned explicitly)
 *   - Vite dev starts and Tailwind generates utilities for the probe classes
 *   - a Base UI primitive renders
 *   - HMR sees a NEW utility class after a source edit (the open WASI scanner bug)
 *   - timings and bytes for the decision
 *
 * Usage: node spikes/tailwind-vm/run.mjs
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChrome, openPage } from "../../scripts/dev/cdp.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOOLING = process.env.FACILIS_TOOLING_DIR || "/tmp/facilis-dev";
const ARTIFACTS = path.join(TOOLING, "spike-tailwind-vm", String(Date.now()));
const CHROME = process.env.FACILIS_CHROME || path.join(TOOLING, "browser/chrome/chrome");
const SYSROOT = process.env.FACILIS_BROWSER_SYSROOT || path.join(TOOLING, "browser/sysroot");
const FONTCONFIG = process.env.FACILIS_FONTCONFIG || path.join(TOOLING, "browser/fonts.conf");

const EXAMPLE = path.join(REPO, "examples/todo-app");
const TEMPLATE = path.join(REPO, "ide/src/facilis/facilis-template.ts");

const BOOT_TIMEOUT_MS = Number(process.env.SPIKE_BOOT_TIMEOUT_MS || 240000);
const INSTALL_TIMEOUT_MS = Number(process.env.SPIKE_INSTALL_TIMEOUT_MS || 420000);
const HMR_TIMEOUT_MS = Number(process.env.SPIKE_HMR_TIMEOUT_MS || 20000);
const PROJECT_NAME = "spike-tailwind-" + Date.now().toString(36);
const CONTROL = process.env.SPIKE_CONTROL === "1";

const checks = [];
const record = (ok, label, detail = "") => {
  checks.push({ ok, label, detail });
  console.log((ok ? "PASS " : "FAIL ") + label + (detail ? "  " + detail : ""));
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── temporary template patch ────────────────────────────────────────────────
const SIMPLE_PATCHES = [
  {
    file: path.join(EXAMPLE, "package.json"),
    apply(text) {
      const pkg = JSON.parse(text);
      // Lean feasibility set: Tailwind + its WASI binding + Base UI. The shadcn CLI
      // package is not needed at runtime and would dominate the in-VM install.
      Object.assign(pkg.dependencies, {
        "@base-ui/react": "1.9.0",
        "@tailwindcss/oxide-wasm32-wasi": "4.3.3",
        "@tailwindcss/vite": "4.3.3",
        clsx: "^2.1.1",
        tailwindcss: "4.3.3",
      });
      return JSON.stringify(pkg, null, 2) + "\n";
    },
  },
  {
    file: path.join(EXAMPLE, "vite.config.ts"),
    apply(text) {
      return text
        .replace(
          'import { facilis } from "@facilis/nitro/vite";',
          'import { facilis } from "@facilis/nitro/vite";\nimport tailwindcss from "@tailwindcss/vite";',
        )
        .replace("plugins: [facilis(), react()]", "plugins: [tailwindcss(), facilis(), react()]");
    },
  },
  {
    file: path.join(EXAMPLE, "src/styles.css"),
    apply(text) {
      return '@import "tailwindcss";\n\n' + text;
    },
  },
  {
    file: path.join(EXAMPLE, "src/app.tsx"),
    apply(text) {
      return text
        .replace(
          'import { Toaster } from "@facilis/ui";',
          'import { Toaster } from "@facilis/ui";\nimport { TwProbe } from "./components/tw-probe.tsx";',
        )
        .replace("      <Toaster />", "      <Toaster />\n      <TwProbe />");
    },
  },
  {
    file: path.join(EXAMPLE, "src/components/tw-probe.tsx"),
    create: true,
    apply() {
      return [
        'import { Button as BaseButton } from "@base-ui/react/button";',
        'import { clsx } from "clsx";',
        "",
        "/** Spike probe: one Tailwind-styled div plus one Base UI primitive. */",
        "export function TwProbe() {",
        "  return (",
        '    <div id="tw-probe" className={clsx("p-3", "bg-red-500", "text-white")}>',
        '      <span id="tw-probe-label" className="font-bold">tailwind-probe</span>',
        '      <BaseButton id="base-ui-probe" className="ml-2 rounded bg-blue-600 px-2 py-1 text-white">',
        "        base-ui-button",
        "      </BaseButton>",
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n");
    },
  },
  {
    // The WASI oxide package declares cpu: wasm32, so a plain npm install refuses it
    // (EBADPLATFORM). --force is the bootstrapping step under test; a shipped template
    // would need a narrower mechanism (nested override or a postinstall shim).
    file: TEMPLATE,
    apply(text) {
      // process.arch is wasm32 in the VM, so the cpu: wasm32 package is a normal match:
      // no --force needed (the run below records EBADPLATFORM if that is wrong).
      return text;
    },
  },
];

function applyTemplatePatch() {
  const backups = SIMPLE_PATCHES.map((patch) => {
    const existed = fs.existsSync(patch.file);
    const before = existed ? fs.readFileSync(patch.file, "utf8") : null;
    fs.mkdirSync(path.dirname(patch.file), { recursive: true });
    fs.writeFileSync(patch.file, patch.apply(before ?? ""));
    return { patch, existed, before };
  });
  return () => {
    for (const { patch, existed, before } of backups.reverse()) {
      if (!existed) {
        fs.rmSync(patch.file, { force: true });
        continue;
      }
      fs.writeFileSync(patch.file, before);
    }
  };
}

// ── dev server ──────────────────────────────────────────────────────────────
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
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
  }
}

// ── page helpers ────────────────────────────────────────────────────────────
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
      String(exact) +
      " ? s === " +
      JSON.stringify(text) +
      " : s.includes(" +
      JSON.stringify(text) +
      "); });" +
      " if (!hit) return 'NOTFOUND'; hit.click(); return 'OK'; })()",
  );
}

async function readFile(page, abs) {
  return page.evaluate("window.__ide.readFileText(" + JSON.stringify(abs) + ")");
}

async function writeFile(page, abs, contents) {
  return page.evaluate(
    'window.__ide.bridge.request("vv-write", { path: ' +
      JSON.stringify(abs) +
      ", contents: " +
      JSON.stringify(contents) +
      " })",
  );
}

function probeExpression() {
  return inPreview(
    'const el = d.querySelector("#tw-probe");' +
      ' if (!el) return { found: false };' +
      " const cs = w.getComputedStyle(el);" +
      ' const label = d.querySelector("#tw-probe-label");' +
      ' const btn = d.querySelector("#base-ui-probe");' +
      " let css = '';" +
      ' for (const sheet of d.styleSheets) { try { css += [...sheet.cssRules].map((r) => r.cssText).join("\\n"); } catch {} }' +
      " return {" +
      "  found: true," +
      "  bg: cs.backgroundColor," +
      "  color: cs.color," +
      '  classes: String(el.className),' +
      '  labelWeight: label ? w.getComputedStyle(label).fontWeight : null,' +
      '  baseUi: btn ? { tag: btn.tagName, text: (btn.textContent || "").trim() } : null,' +
      '  cssHasRed: css.includes("bg-red-500"),' +
      '  cssHasEmerald: css.includes("bg-emerald-500"),' +
      "  cssLength: css.length," +
      '  styleTags: [...d.querySelectorAll("style")].reduce((n, s) => n + (s.textContent || "").length, 0),' +
      " };",
  );
}

async function pollProbe(page, predicate, limitMs) {
  const until = Date.now() + limitMs;
  let last = null;
  while (Date.now() < until) {
    last = await page.evaluate(probeExpression()).catch(() => null);
    if (last && predicate(last)) return { ok: true, probe: last };
    await sleep(250);
  }
  return { ok: false, probe: last };
}

const TERMINALS = [
  "(() => {",
  "  const c = window.__ide;",
  "  const metas = c && c.getSnapshot ? (c.getSnapshot().terminals || []) : [];",
  "  const out = [];",
  "  for (const meta of metas) {",
  "    const entry = c.terminals && c.terminals.entry ? c.terminals.entry(meta.id) : null;",
  "    const term = entry && entry.term;",
  "    if (!term || !term.buffer) continue;",
  "    const buffer = term.buffer.active;",
  "    const lines = [];",
  "    for (let i = 0; i < buffer.length; i++) {",
  "      const line = buffer.getLine(i);",
  "      if (line) lines.push(line.translateToString(true));",
  "    }",
  '    out.push({ id: meta.id, label: meta.label, text: lines.join("\n").slice(-30000) });',
  "  }",
  "  return out;",
  "})()",
].join("\n");

const XTERM = [
  "(() => {",
  "  try {",
  '    const rows = [...document.querySelectorAll(".xterm-rows > div")].map((r) => r.textContent || "");',
  '    if (rows.length > 0) return rows.join("\\n").slice(-14000);',
  '    const host = document.querySelector(".xterm");',
  '    return host ? (host.textContent || "").slice(-14000) : "";',
  '  } catch { return ""; }',
  "})()",
].join("\n");

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
  "  return {",
  "    runPhase: s.runPhase || null,",
  "    terminals: s.terminals || [],",
  "    activeFolder: (window.__ide.activeFolder && window.__ide.activeFolder.rootPath) || '',",
  "  };",
  "})()",
].join("\n");

async function readTerminalState(page) {
  const snap = await page.evaluate(SNAP);
  const terminals = [];
  for (const meta of snap.terminals) {
    const value = await page.evaluate("(" + TERM_TEXT + ")(" + JSON.stringify(meta.id) + ")");
    terminals.push({ id: meta.id, label: meta.label, text: (value && value.text) || "", error: value && value.error });
  }
  return { snap, terminals };
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  console.log("artifacts: " + ARTIFACTS);
  console.log("patching example + template");
  const restore = CONTROL ? () => {} : applyTemplatePatch();

  let dev = null;
  let chrome = null;
  let page = null;
  const report = {
    ok: false,
    startedAt: new Date().toISOString(),
    timings: {},
    checks,
    probe: null,
    hmr: null,
    files: {},
    terminalTail: "",
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    downloads: {},
    screenshots: [],
  };

  try {
    dev = await startDevServer();
    console.log("studio url: " + dev.url);

    if (!fs.existsSync(CHROME)) throw new Error("chrome not found: " + CHROME);
    chrome = await launchChrome({
      chrome: CHROME,
      profileDir: process.env.SPIKE_PROFILE_DIR || path.join(ARTIFACTS, "profile"),
      homeDir: path.join(ARTIFACTS, "home"),
      sysroot: fs.existsSync(SYSROOT) ? SYSROOT : "",
      fontconfigFile: fs.existsSync(FONTCONFIG) ? FONTCONFIG : "",
    });
    page = await openPage(chrome.client, dev.url);

    const t0 = Date.now();
    const booted = await waitFor(
      page,
      '((window.__vvBoot || []).some((m) => m.name === "kernel-online"))',
      BOOT_TIMEOUT_MS,
    );
    report.timings.kernelOnlineMs = Date.now() - t0;
    record(booted, "kernel online", report.timings.kernelOnlineMs + "ms");
    if (!booted) throw new Error("kernel never came online");
    await page.screenshot(path.join(ARTIFACTS, "01-home.png"));

    let home = await clickText(page, "New project");
    if (home !== "OK") {
      // A reused profile may boot straight into the last project (D-049); go Home first.
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
    const createReady = await waitFor(
      page,
      "Boolean([...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Create' && !b.disabled))",
      15000,
    );
    record(createReady, "Create button enabled");

    const installStartedAt = Date.now();
    let created = false;
    for (let attempt = 0; attempt < 2 && !created; attempt++) {
      await clickText(page, "Create", true);
      created = await waitFor(
        page,
        '((window.__vvBoot || []).some((m) => m.name === "install-start"))',
        15000,
      );
    }
    record(created, "project created, install started");

    // Sample the run terminal while install/dev runs: a painted preview is success, a
    // terminal error ends the wait early, and either way we keep the output.
    report.runSamples = [];
    let painted = false;
    const until = Date.now() + INSTALL_TIMEOUT_MS;
    while (Date.now() < until) {
      const state = await readTerminalState(page).catch(() => null);
      const paintedNow = await page
        .evaluate('((window.__vvBoot || []).some((m) => m.name === "preview-paint"))')
        .catch(() => false);
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
    if (report.runSamples.length > 0) {
      const last = report.runSamples[report.runSamples.length - 1];
      for (const term of last.terminals) {
        console.log("\n[run terminal " + term.id + " " + term.label + "]\n" + term.tail.slice(-4000));
      }
    }

    const marks = await page.evaluate("(window.__vvBoot || []).map((m) => ({ name: m.name, t: m.t }))");
    report.bootMarks = marks;
    await sleep(1500);
    await page.screenshot(path.join(ARTIFACTS, "02-preview.png"));
    report.screenshots.push("01-home.png", "02-preview.png");

    const root = await page.evaluate(
      "(() => { const c = window.__ide; const f = c && c.activeFolder; return f ? f.rootPath : ''; })()",
    );
    record(Boolean(root), "project root resolved", String(root));
    report.projectRoot = root;

    // ── file-system facts ────────────────────────────────────────────────────
    if (root) {
      report.files.packageJson = String(await readFile(page, root + "/package.json")).slice(0, 2500);
      for (const name of ["tailwindcss", "@tailwindcss/oxide", "@tailwindcss/oxide-wasm32-wasi", "@base-ui/react", "shadcn"]) {
        const text = String(await readFile(page, root + "/node_modules/" + name + "/package.json")).slice(0, 400);
        report.files[name] = text.length > 0 ? text : "<missing>";
      }
    }

    if (CONTROL) {
      record(true, "control run: template untouched, no Tailwind expected");
    } else {
    // ── the probe ────────────────────────────────────────────────────────────
    const probe = await pollProbe(page, (p) => p.found === true, 30000);
    report.probe = probe.probe;
    record(Boolean(probe.probe && probe.probe.found), "TwProbe rendered in preview");
    if (probe.probe && probe.probe.found) {
      record(
        probe.probe.cssHasRed === true && probe.probe.bg !== "rgba(0, 0, 0, 0)",
        "Tailwind bg-red-500 applied",
        String(probe.probe.bg) + " (v4 emits oklch)",
      );
      record(probe.probe.color === "rgb(255, 255, 255)", "Tailwind text-white applied", String(probe.probe.color));
      record(probe.probe.labelWeight === "700", "Tailwind font-bold applied", String(probe.probe.labelWeight));
      record(
        probe.probe.baseUi !== null && probe.probe.baseUi.tag === "BUTTON",
        "Base UI primitive rendered",
        probe.probe.baseUi ? probe.probe.baseUi.tag + " " + probe.probe.baseUi.text : "missing",
      );
      record(
        probe.probe.cssHasRed === true,
        "Tailwind generated the utility rule",
        "cssLength=" + probe.probe.cssLength + " styleTags=" + probe.probe.styleTags,
      );
    }

    // ── HMR: a NEW utility class must appear after a source edit ─────────────
    if (root) {
      const abs = root + "/src/components/tw-probe.tsx";
      const source = String(await readFile(page, abs));
      const edited = source.replace("bg-red-500", "bg-emerald-500");
      record(edited !== source, "probe source read from the VFS");
      await writeFile(page, abs, edited);
      const landed = String(await readFile(page, abs)).includes("bg-emerald-500");
      record(landed, "VV write landed (new class in source)");

      const baselineBg = probe.probe ? probe.probe.bg : "";
      const isEmerald = (p) =>
        p.cssHasEmerald === true && p.bg !== baselineBg && p.bg !== "rgba(0, 0, 0, 0)";
      const hmr = await pollProbe(page, isEmerald, HMR_TIMEOUT_MS);
      report.hmr = { firstTry: hmr.ok, probe: hmr.probe };

      if (hmr.ok) {
        record(true, "HMR: new utility class applied in preview");
      } else {
        record(
          false,
          "HMR: new utility class applied without a CSS touch",
          "known WASI incremental-scan bug (tailwindlabs/tailwindcss#20605)",
        );
        // The open WASI scanner bug: touching the stylesheet forces a rescan.
        const cssAbs = root + "/src/styles.css";
        const css = String(await readFile(page, cssAbs));
        await writeFile(page, cssAbs, css + "\n/* spike hmr touch */\n");
        const afterTouch = await pollProbe(page, isEmerald, HMR_TIMEOUT_MS);
        report.hmr.afterCssTouch = { ok: afterTouch.ok, probe: afterTouch.probe };
        record(
          afterTouch.ok,
          "HMR: new class appears after touching the stylesheet (bug workaround)",
        );
      }
    }

    }
    // ── diagnostics ──────────────────────────────────────────────────────────
    report.terminalTail = String(await page.evaluate(XTERM)).slice(-14000);
    fs.writeFileSync(path.join(ARTIFACTS, "terminal.txt"), report.terminalTail);
    report.consoleErrors = page.consoleEntries
      .filter((entry) => entry.type === "error" || entry.type === "warning")
      .slice(-40);
    report.pageErrors = page.pageErrors.slice(-20);
    report.failedRequests = page.failedRequests.slice(-40);
    const downloads = page.downloads();
    const relevant = downloads.filter((d) => /tailwind|oxide|base-ui|shadcn|emnapi|napi/i.test(d.url));
    report.downloads = {
      count: downloads.length,
      totalBytes: downloads.reduce((n, d) => n + d.bytes, 0),
      relevantCount: relevant.length,
      relevantBytes: relevant.reduce((n, d) => n + d.bytes, 0),
      relevant: relevant.slice(0, 40).map((d) => ({ url: d.url.slice(0, 180), bytes: d.bytes })),
    };
    fs.writeFileSync(path.join(ARTIFACTS, "downloads.json"), JSON.stringify(downloads, null, 2));

    // Full terminal buffers (the run terminal is not the one on screen) and the run phase.
    report.terminals = await page.evaluate(TERMINALS).catch(() => []);
    report.runPhase = await page.evaluate("(window.__ide.getSnapshot && window.__ide.getSnapshot().runPhase) || null").catch(() => null);
    report.timings.installPackagesAtMs = (report.runSamples || []).find((sample) =>
      (sample.terminals || []).some((t) => /added \d+ packages/.test(t.tail || "")),
    )?.at;
    report.statusText = String(await page.evaluate("document.body.innerText").catch(() => "")).slice(-4000);
    report.previewFrame = await page.evaluate(PREVIEW + " ? { src: " + PREVIEW + ".src, timeOrigin: " + PREVIEW + ".contentWindow ? " + PREVIEW + ".contentWindow.performance.timeOrigin : 0 } : null").catch(() => null);
    fs.writeFileSync(path.join(ARTIFACTS, "terminals.json"), JSON.stringify(report.terminals, null, 2));
    fs.writeFileSync(path.join(ARTIFACTS, "run-samples.json"), JSON.stringify(report.runSamples || [], null, 2));
    fs.writeFileSync(path.join(ARTIFACTS, "status.txt"), report.statusText);
    fs.writeFileSync(path.join(ARTIFACTS, "page-errors.json"), JSON.stringify({ console: report.consoleErrors, page: report.pageErrors, failed: report.failedRequests }, null, 2));

    report.terminalHighlights = report.terminalTail
      .split("\n")
      .filter((line) => /tailwind|oxide|wasm|npm (warn|error)|added \d+ packages|vite|ready in/i.test(line))
      .slice(-25);
  } catch (error) {
    record(false, "spike crashed", error instanceof Error ? error.message.slice(0, 800) : String(error));
  } finally {
    report.ok = checks.every((check) => check.ok);
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(ARTIFACTS, "report.json"), JSON.stringify(report, null, 2));
    if (chrome) {
      try { chrome.child.kill("SIGKILL"); } catch { /* ignore */ }
      try { chrome.client.close(); } catch { /* ignore */ }
    }
    if (dev) stopDevServer(dev.child);
    restore();
  }

  console.log("\n== report ==");
  console.log(JSON.stringify({
    ok: report.ok,
    control: CONTROL,
    timings: report.timings,
    probe: report.probe,
    hmr: report.hmr && {
      firstTry: report.hmr.firstTry,
      afterCssTouch: report.hmr.afterCssTouch ? report.hmr.afterCssTouch.ok : undefined,
    },
    downloads: report.downloads && {
      count: report.downloads.count,
      totalBytes: report.downloads.totalBytes,
      relevantCount: report.downloads.relevantCount,
      relevantBytes: report.downloads.relevantBytes,
    },
    files: Object.fromEntries(
      Object.entries(report.files || {}).map(([name, text]) => [
        name,
        typeof text === "string" ? text.slice(0, 120).replace(/\s+/g, " ") : text,
      ]),
    ),
    terminalHighlights: report.terminalHighlights || [],
    runSampleTail: (report.runSamples || []).length > 0
      ? report.runSamples[report.runSamples.length - 1].terminals.map((t) => ({ id: t.id, label: t.label, tail: t.tail.slice(-2000) }))
      : [],
    runPhase: report.runPhase,
    terminals: (report.terminals || []).map((t) => ({
      id: t.id,
      label: t.label,
      tail: t.text.slice(-1800),
    })),
    consoleErrors: report.consoleErrors,
    pageErrors: report.pageErrors,
    failedRequests: report.failedRequests,
    artifacts: ARTIFACTS,
  }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
