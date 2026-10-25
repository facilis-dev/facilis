// IDE smoke test: boot the Studio (Vivari kernel in the browser), create a project
// from the built-in template picker, and wait for the preview to paint.
//
// It drives the real UI through CDP (scripts/dev/cdp.mjs) — no npm dependency, no
// mocking. Prerequisites (all reproducible, see docs/DEV.md):
//   scripts/dev/build-kernel-wasm.sh   -> vendor/vivari/packages/{vfs,codec,crypto}/pkg
//   scripts/dev/vendor-assets.sh       -> ide/public/vendor/{npm-pack.bin,sqlite/}
//   scripts/dev/fetch-browser.sh       -> $FACILIS_TOOLING_DIR/browser/{chrome,sysroot}
//
// Usage: node scripts/dev/smoke-ide.mjs [--url http://127.0.0.1:5199/] [--keep-artifacts]
// Exit code 0 = the Studio booted and the template project served a preview.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, openPage } from "./cdp.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOOLING = process.env.FACILIS_TOOLING_DIR || "/tmp/facilis-dev";
const argValue = (name, fallback) => {
  const index = process.argv.indexOf("--" + name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const URL_ = argValue("url", process.env.STUDIO_URL || "");
const TEMPLATE = process.env.TEMPLATE || "React";
const LANGUAGE = process.env.LANGUAGE || "TypeScript";
const BOOT_TIMEOUT_MS = Number(process.env.BOOT_TIMEOUT_MS || 180000);
const PREVIEW_TIMEOUT_MS = Number(process.env.PREVIEW_TIMEOUT_MS || 300000);
const PORT = Number(process.env.SMOKE_PORT || 5199);
const ARTIFACTS =
  process.env.SMOKE_ARTIFACTS || path.join(TOOLING, "smoke-artifacts", String(Date.now()));
const CHROME = process.env.FACILIS_CHROME || path.join(TOOLING, "browser/chrome/chrome");
const SYSROOT = process.env.FACILIS_BROWSER_SYSROOT || path.join(TOOLING, "browser/sysroot");
const FONTCONFIG = process.env.FACILIS_FONTCONFIG || path.join(TOOLING, "browser/fonts.conf");

const failures = [];
const check = (ok, label, detail = "") => {
  console.log((ok ? "PASS " : "FAIL ") + label + (detail ? "  " + detail : ""));
  if (!ok) failures.push(label);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHttp(url, limitMs) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      /* server not listening yet */
    }
    await sleep(500);
  }
  throw new Error("dev server did not answer " + url + " within " + limitMs + "ms");
}

// A stale dev server on the default port must not be mistaken for "our" server: the
// test would then drive someone else's app. Pick a free port instead.
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
  throw new Error("no free port in " + from + ".." + (from + 19));
}

async function startDevServer() {
  if (URL_) return { url: URL_.endsWith("/") ? URL_ : URL_ + "/", child: null };
  const port = await freePort(PORT);
  const url = "http://127.0.0.1:" + port + "/";
  // `detached` + a negative-pid kill: signing off the pnpm wrapper alone leaves vite
  // running, which leaks the port and poisons the next run.
  const child = spawn(
    "pnpm",
    [
      "--filter",
      "@facilis/ide",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  let log = "";
  child.stdout.on("data", (chunk) => (log += chunk.toString()));
  child.stderr.on("data", (chunk) => (log += chunk.toString()));
  child.on("exit", (code) => {
    if (code !== 0) console.error("vite exited with " + code + "\n" + log.slice(-2000));
  });
  await waitForHttp(url, 120000);
  return { url, child, port };
}

function stopDevServer(child) {
  if (!child) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  console.log("artifacts: " + ARTIFACTS);

  const dev = await startDevServer();
  console.log("studio url: " + dev.url);
  const response = await fetch(dev.url);
  check(
    response.headers.get("cross-origin-opener-policy") === "same-origin",
    "COOP header present",
  );
  check(
    response.headers.get("cross-origin-embedder-policy") === "require-corp",
    "COEP header present",
  );

  if (!fs.existsSync(CHROME))
    throw new Error("chrome not found: " + CHROME + " (run scripts/dev/fetch-browser.sh)");
  const chrome = await launchChrome({
    chrome: CHROME,
    profileDir: path.join(ARTIFACTS, "profile"),
    homeDir: path.join(ARTIFACTS, "home"),
    sysroot: fs.existsSync(SYSROOT) ? SYSROOT : "",
    fontconfigFile: fs.existsSync(FONTCONFIG) ? FONTCONFIG : "",
  });
  const page = await openPage(chrome.client, dev.url);

  const marks = async () => (await page.evaluate("window.__vvBoot || []")).map((mark) => mark.name);
  const waitForMark = async (name, limitMs) => {
    const until = Date.now() + limitMs;
    while (Date.now() < until) {
      if ((await marks()).includes(name)) return true;
      await sleep(250);
    }
    return false;
  };
  const clickText = (text, exact = false) =>
    page.evaluate(
      "(() => {" +
        "const els = [...document.querySelectorAll('button,[role=button],a,[role=tab]')];" +
        "const wanted = " +
        JSON.stringify(text) +
        ";" +
        "const hit = els.find((el) => { const s = (el.innerText || '').trim(); return " +
        String(exact) +
        " ? s === wanted : s.includes(wanted); });" +
        "if (!hit) return 'NOTFOUND'; hit.click(); return 'OK'; })()",
    );
  const waitFor = async (expression, limitMs) => {
    const until = Date.now() + limitMs;
    while (Date.now() < until) {
      if (await page.evaluate(expression)) return true;
      await sleep(250);
    }
    return false;
  };

  const startedAt = Date.now();
  const booted = await waitForMark("kernel-online", BOOT_TIMEOUT_MS);
  check(booted, "kernel online", Date.now() - startedAt + "ms");
  await page.screenshot(path.join(ARTIFACTS, "01-home.png"));
  check((await page.evaluate("document.body.innerText.length")) > 0, "home rendered text");

  check((await clickText("Start from template")) === "OK", "template picker opens");
  // The picker grid comes from a lazy chunk (ide/src/vv/templates-lazy.ts): on a cold
  // Vite dev server the 11k-line templates module is still being transformed when the
  // dialog opens, so poll the UI instead of sleeping a fixed amount.
  const templateCard =
    "(() => [...document.querySelectorAll('button')].find((b) => { const s = b.innerText || '';" +
    "return s.includes(" +
    JSON.stringify(TEMPLATE) +
    ") && s.includes(" +
    JSON.stringify(LANGUAGE) +
    "); }))()";
  check(
    await waitFor("Boolean(" + templateCard + ")", 30000),
    "template " + TEMPLATE + "/" + LANGUAGE + " listed",
  );
  const picked = await page.evaluate(
    "(() => { const card = " +
      templateCard +
      "; if (!card) return 'NOTFOUND'; card.click(); return 'OK'; })()",
  );
  check(picked === "OK", "template " + TEMPLATE + "/" + LANGUAGE + " selectable");
  await sleep(600);
  await page.screenshot(path.join(ARTIFACTS, "02-create-dialog.png"));
  const createReady = await waitFor(
    "Boolean([...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Create' && !b.disabled))",
    15000,
  );
  check(createReady, "'Create' button enabled");
  let created = false;
  if (createReady) {
    // `install-start` is marked the moment the run lifecycle begins, so it doubles as
    // "the Create handler actually fired". On a cold dev server the submit can land a
    // frame before React commits the picker's selection; retrying the click is cheaper
    // than a 5-minute preview timeout that looks like a product bug.
    for (let attempt = 0; attempt < 2 && !created; attempt++) {
      await clickText("Create", true);
      created = await waitForMark("install-start", 15000);
    }
  }
  check(created, "project created");

  const painted = await waitForMark("preview-paint", PREVIEW_TIMEOUT_MS);
  check(painted, "preview painted", Date.now() - startedAt + "ms");
  await sleep(1500);
  await page.screenshot(path.join(ARTIFACTS, "03-preview.png"));

  const preview = await page.evaluate(
    "(() => { const frame = [...document.querySelectorAll('iframe')].find((f) => /preview/.test(f.src || ''));" +
      "return frame ? frame.src : ''; })()",
  );
  check(Boolean(preview), "preview iframe mounted", preview);
  if (preview) {
    const previewResponse = await page.evaluate(
      "fetch(" +
        JSON.stringify(preview) +
        ").then(async (r) => ({ status: r.status, body: (await r.text()).slice(0, 400) }))",
    );
    check(previewResponse.status === 200, "preview responds 200", String(previewResponse.status));
    check(
      previewResponse.body.length > 0,
      "preview has HTML",
      String(previewResponse.body.length) + " chars",
    );
  }
  // A 200 is not proof: when the preview Service Worker is not yet active, the frame's
  // navigation escapes to the dev server and the SPA fallback answers with the studio's
  // own index.html — a recursive IDE inside the preview. Assert on the framed document.
  const previewBody = await page.evaluate(
    "(() => { const frame = [...document.querySelectorAll('iframe')].find((f) => /preview/.test(f.src || ''));" +
      "if (!frame) return ''; try { return frame.contentDocument ? (frame.contentDocument.body.innerText || '').slice(0, 400) : ''; }" +
      "catch { return ''; } })()",
  );
  check(!/Vivari Studio/.test(previewBody), "preview is the project, not the studio shell");
  check(previewBody.length > 0, "preview document has text", previewBody.slice(0, 80));

  check(page.pageErrors.length === 0, "no page errors", page.pageErrors.slice(0, 3).join(" | "));
  // The only console "error" upstream emits on a healthy boot is a React warning about a
  // <script> tag inside a component; it is pre-existing upstream behaviour, not a failure.
  const IGNORED_CONSOLE_ERRORS = [/Encountered a script tag while rendering React component/];
  const errorConsole = page.consoleEntries.filter(
    (entry) =>
      entry.type === "error" && !IGNORED_CONSOLE_ERRORS.some((pattern) => pattern.test(entry.text)),
  );
  check(
    errorConsole.length === 0,
    "no console errors",
    errorConsole
      .slice(0, 3)
      .map((e) => e.text)
      .join(" | "),
  );
  check(
    page.failedRequests.length === 0,
    "no failed requests",
    page.failedRequests.slice(0, 3).join(" | "),
  );

  const report = {
    url: dev.url,
    template: TEMPLATE + "/" + LANGUAGE,
    marks: await marks(),
    durationsMs: { total: Date.now() - startedAt },
    consoleErrors: errorConsole,
    pageErrors: page.pageErrors,
    failedRequests: page.failedRequests,
    failures,
  };
  fs.writeFileSync(path.join(ARTIFACTS, "report.json"), JSON.stringify(report, null, 2));

  chrome.client.close();
  chrome.child.kill("SIGKILL");
  stopDevServer(dev.child);

  if (failures.length > 0) {
    console.error("\nSMOKE FAILED (" + failures.length + "): " + failures.join(", "));
    process.exit(1);
  }
  console.log("\nSMOKE PASSED — artifacts in " + ARTIFACTS);
}

await main();
