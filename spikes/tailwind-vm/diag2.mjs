#!/usr/bin/env node
/**
 * Diagnostic 2: open the persisted Facilis project from Home (restores its dependency
 * cache), run it with the project's own Run lifecycle, and capture the run terminal.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChrome, openPage } from "../../scripts/dev/cdp.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOOLING = process.env.FACILIS_TOOLING_DIR || "/tmp/facilis-dev";
const ARTIFACTS = path.join(TOOLING, "spike-tailwind-diag2", String(Date.now()));
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
  const port = await freePort(5399);
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

const SNAP = [
  "(() => {",
  "  const s = window.__ide.getSnapshot();",
  "  return {",
  "    runPhase: s.runPhase || null,",
  "    terminals: s.terminals || [],",
  "    activeFolder: (window.__ide.activeFolder && window.__ide.activeFolder.rootPath) || '',",
  "    recent: (s.recentProjects || []).map((p) => ({ rootPath: p.rootPath, template: p.template, name: p.name })),",
  "  };",
  "})()",
].join("\n");

async function texts(page) {
  const snap = await page.evaluate(SNAP);
  const out = [];
  for (const meta of snap.terminals) {
    const value = await page.evaluate("(" + TERM_TEXT + ")(" + JSON.stringify(meta.id) + ")");
    out.push({ id: meta.id, label: meta.label, text: (value && value.text) || "", error: value && value.error });
  }
  return { snap, terminals: out };
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
  for (let i = 0; i < 600; i++) {
    if (await page.evaluate("Boolean(window.__ide && window.__ide.getSnapshot().kernelReady)").catch(() => false)) break;
    await sleep(250);
  }
  console.log("kernel online");
  await sleep(1500);

  const before = await page.evaluate(SNAP);
  console.log("recent projects:", JSON.stringify(before.recent));

  let root = "";
  const meta = (before.recent || []).find((p) => String(p.rootPath).includes("spike-tailwind")) || (before.recent || [])[0];
  if (meta) {
    console.log("opening project:", meta.rootPath);
    const opened = await page.evaluate(
      "window.__ide.openProject(" + JSON.stringify(meta) + ").then(() => 'OK').catch((e) => 'ERR ' + e)",
    );
    console.log("openProject:", opened);
    root = meta.rootPath;
    await sleep(12000);
  } else {
    console.log("no recent project");
  }

  const afterOpen = await texts(page);
  console.log("after open: folder=" + afterOpen.snap.activeFolder + " terminals=" + afterOpen.snap.terminals.length);

  if (root) {
    console.log("starting run");
    await page.evaluate("window.__ide.runProject(" + JSON.stringify(root) + ")");
    const samples = [];
    for (let i = 0; i < 30; i++) {
      await sleep(5000);
      const state = await texts(page);
      samples.push({ at: i * 5, phase: state.snap.runPhase, terminals: state.terminals.map((t) => ({ id: t.id, label: t.label, len: t.text.length, tail: t.text.slice(-1500) })) });
      const runTerm = state.terminals.find((t) => t.id !== "console" && t.label && !t.label.startsWith("sh "));
      const consoleText = (state.terminals.find((t) => t.id === "console") || {}).text || "";
      const runText = runTerm ? runTerm.text : "";
      if (/ready in|Local:|error|Error|failed|Cannot|ELIFECYCLE/i.test(runText + "\n" + consoleText) && i > 2) break;
      if (state.snap.runPhase && state.snap.runPhase.phase !== "installing" && state.snap.runPhase.phase !== "starting" && i > 1) break;
    }
    const finalState = await texts(page);
    fs.writeFileSync(path.join(ARTIFACTS, "run.json"), JSON.stringify({ root, samples, final: finalState }, null, 2));
    for (const term of finalState.terminals) {
      console.log("\n===== terminal " + term.id + " (" + term.label + ") =====\n" + term.text.slice(-6000));
    }
    console.log("\nrun phase:", JSON.stringify(finalState.snap.runPhase));
  }

  console.log("artifacts: " + ARTIFACTS);
  try { chrome.child.kill("SIGKILL"); } catch {}
  try { process.kill(-dev.child.pid, "SIGTERM"); } catch {}
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
