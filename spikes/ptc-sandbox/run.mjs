// Runs the PTC sandbox spike in the repo's headless Chromium (scripts/dev/cdp.mjs).
// Usage: node spikes/ptc-sandbox/run.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, openPage } from "../../scripts/dev/cdp.mjs";
import { startServer } from "./server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLING = process.env.FACILIS_TOOLING_DIR || "/tmp/facilis-dev";
const CHROME = process.env.FACILIS_CHROME || path.join(TOOLING, "browser/chrome/chrome");
const SYSROOT = process.env.FACILIS_BROWSER_SYSROOT || path.join(TOOLING, "browser/sysroot");
const FONTCONFIG = process.env.FACILIS_FONTCONFIG || path.join(TOOLING, "browser/fonts.conf");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!fs.existsSync(CHROME)) {
  console.error("no Chromium at " + CHROME + "; run `pnpm ide:browser` first (docs/DEV.md).");
  process.exit(2);
}

const server = await startServer(0);
console.log("serving " + server.url);
const chrome = await launchChrome({
  chrome: CHROME,
  profileDir: path.join(HERE, ".profile"),
  homeDir: path.join(HERE, ".home"),
  sysroot: fs.existsSync(SYSROOT) ? SYSROOT : "",
  fontconfigFile: fs.existsSync(FONTCONFIG) ? FONTCONFIG : "",
});
const chromeVersion = await fetch("http://127.0.0.1:" + chrome.port + "/json/version")
  .then((response) => response.json())
  .then((version) => version.Browser)
  .catch(() => "unknown");
console.log("chrome " + chromeVersion);

let report = null;
try {
  const page = await openPage(chrome.client, server.url);
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    report = await page.evaluate("window.__PTC_SPIKE__ || null");
    if (report && report.done) break;
    await sleep(200);
  }
  if (report && report.done) {
    report.chrome = chromeVersion;
    fs.writeFileSync(path.join(HERE, "last-run.json"), JSON.stringify(report, null, 2));
  }
} finally {
  try { chrome.child.kill("SIGKILL"); } catch {}
  await server.close();
  fs.rmSync(path.join(HERE, ".profile"), { recursive: true, force: true });
  fs.rmSync(path.join(HERE, ".home"), { recursive: true, force: true });
}

if (!report || !report.done) {
  console.error("FAIL: the spike did not finish within 30s");
  process.exit(1);
}
for (const check of report.checks) {
  console.log((check.ok ? "PASS " : "FAIL ") + check.name + "  " + check.detail);
}
console.log("");
console.log(report.passed + "/" + report.total + " checks passed");
if (report.error) console.error("spike error: " + report.error);
process.exit(report.passed === report.total ? 0 : 1);