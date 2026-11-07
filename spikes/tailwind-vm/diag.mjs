#!/usr/bin/env node
/**
 * Focused diagnostic for the Tailwind spike: boot the Studio on the persisted profile,
 * open a shell in the last project and run Node probes inside the WebContainer:
 *   - can @tailwindcss/oxide load (native -> WASI fallback)?
 *   - does the WASI package require/import hang?
 *   - does @tailwindcss/vite import?
 *   - what does npm run dev print when it does not bind?
 *
 * Usage: FACILIS_PROFILE_DIR=<profile> node spikes/tailwind-vm/diag.mjs
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChrome, openPage } from "../../scripts/dev/cdp.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOOLING = process.env.FACILIS_TOOLING_DIR || "/tmp/facilis-dev";
const ARTIFACTS = path.join(TOOLING, "spike-tailwind-diag", String(Date.now()));
const CHROME = process.env.FACILIS_CHROME || path.join(TOOLING, "browser/chrome/chrome");
const SYSROOT = process.env.FACILIS_BROWSER_SYSROOT || path.join(TOOLING, "browser/sysroot");
const FONTCONFIG = process.env.FACILIS_FONTCONFIG || path.join(TOOLING, "browser/fonts.conf");
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

async function devServer() {
  const port = await freePort(5299);
  const url = "http://127.0.0.1:" + port + "/";
  const child = spawn(
    "pnpm",
    ["--filter", "@facilis/ide", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: REPO, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  for (let i = 0; i < 240; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return { url, child };
    } catch { /* not up */ }
    await sleep(500);
  }
  throw new Error("IDE dev server did not start");
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

async function termText(page, id) {
  return page.evaluate("(" + TERM_TEXT + ")(" + JSON.stringify(id) + ")");
}

async function send(page, id, chunk) {
  return page.evaluate(
    "window.__ide.bridge.post('term-input', { terminalId: " +
      JSON.stringify(id) +
      ", chunk: " +
      JSON.stringify(chunk) +
      " })",
  );
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const dev = await devServer();
  const chrome = await launchChrome({
    chrome: CHROME,
    profileDir: path.join(ARTIFACTS, "unused-profile"),
    homeDir: path.join(ARTIFACTS, "home"),
    sysroot: fs.existsSync(SYSROOT) ? SYSROOT : "",
    fontconfigFile: fs.existsSync(FONTCONFIG) ? FONTCONFIG : "",
  });
  const page = await openPage(chrome.client, dev.url);
  const ok = await (async () => {
    for (let i = 0; i < 600; i++) {
      if (await page.evaluate("Boolean(window.__ide && window.__ide.getSnapshot().kernelReady)").catch(() => false)) return true;
      await sleep(250);
    }
    return false;
  })();
  console.log("kernel online:", ok);
  if (!ok) { console.log("body:", await page.evaluate("document.body.innerText.slice(0, 500)")); process.exit(1); }
  await sleep(1500);

  const consoleEntry = await page.evaluate("(() => { const c = window.__ide; const t = c.terminals.entry('console'); return { hasEntry: !!t, hasTerm: !!(t && t.term), hasBuffer: !!(t && t.term && t.term.buffer) }; })()");
  console.log("console entry:", JSON.stringify(consoleEntry));
  console.log("snapshot terminals:", JSON.stringify(await page.evaluate("(() => { const s = window.__ide.getSnapshot(); return { keys: Object.keys(s).slice(0, 40), terminals: s.terminals || null, activeTermId: s.activeTermId || null }; })()")));

  let root = await page.evaluate("(window.__ide.activeFolder && window.__ide.activeFolder.rootPath) || ''");
  console.log("active folder:", root);
  if (!root) {
    const folder = await page.evaluate("(() => { const c = window.__ide; const snap = c.getSnapshot(); const recent = snap.workspaceFolders && snap.workspaceFolders[0]; if (recent) { c.openFolder(recent.rootPath); return recent.rootPath; } return ''; })()").catch((error) => "ERR " + error);
    console.log("opened folder fallback:", folder);
    root = String(folder).startsWith("/") ? folder : "";
  }
  await sleep(1000);

  const id = await page.evaluate(
    "window.__ide.terminals.newShellTerminal({ cwd: " + JSON.stringify(root || null) + ", label: 'diag', activate: true })",
  );
  console.log("diagnostic terminal:", id);
  await sleep(2500);
  await send(page, id, "echo DIAG_READY\n");
  await sleep(1500);
  console.log("terminal after boot:", JSON.stringify(await termText(page, id)).slice(0, 1200));

  const project = process.env.SPIKE_PROJECT || "/home/user/projects/spike-tailwind-mw0b9a9u";
  const commands = [
    ["NODE", "cd " + project + " && pwd && node -e \"console.log('NODE', process.version, process.arch, process.platform)\""],
    ["OXIDE", "cd " + project + " && node -e \"try{const o=require('@tailwindcss/oxide');console.log('OXIDE_OK', typeof o.Scanner)}catch(e){console.log('OXIDE_ERR', e.message)}\" & echo _OXIDE_SENTINEL"],
    ["WASI", "cd " + project + " && node -e \"try{require('@tailwindcss/oxide-wasm32-wasi');console.log('WASI_OK')}catch(e){console.log('WASI_ERR', e.message)}\" & echo _WASI_SENTINEL"],
    ["PLUGIN", "cd " + project + " && node -e \"import('@tailwindcss/vite').then(m=>console.log('PLUGIN_OK', typeof m.default)).catch(e=>console.log('PLUGIN_ERR', e.message))\" & echo _PLUGIN_SENTINEL"],
    ["VITE", "cd " + project + " && node node_modules/vite/bin/vite.js --version"],
    ["DEV", "cd " + project + " && (node node_modules/vite/bin/vite.js --configLoader native > /tmp/dev.log 2>&1 &) ; node -e \"setTimeout(()=>{}, 25000)\" ; echo _DEV_END ; cat /tmp/dev.log"],
  ];
  const results = {};
  for (const [name, command] of commands) {
    await send(page, id, command + "\n");
    await sleep(name === "DEV" ? 36000 : 12000);
    const text = await termText(page, id);
    results[name] = text;
    console.log("\n===== " + name + " =====\n" + (text.text || text.error || "").slice(-5000));
  }
  fs.writeFileSync(path.join(ARTIFACTS, "diag.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(ARTIFACTS, "diag.txt"), Object.entries(results).map(([k, v]) => "===== " + k + " =====\n" + (v.text || v.error || "")).join("\n\n"));
  console.log("\nartifacts: " + ARTIFACTS);
  try { chrome.child.kill("SIGKILL"); } catch {}
  try { process.kill(-dev.child.pid, "SIGTERM"); } catch {}
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
