// IDE smoke test: boot the Studio (Vivari kernel in the browser), create a Facilis
// project from Home, and wait for the preview to paint.
//
// It drives the real UI through CDP (scripts/dev/cdp.mjs) — no npm dependency, no
// mocking. Prerequisites (all reproducible, see docs/DEV.md):
//   scripts/dev/build-kernel-wasm.sh   -> vendor/vivari/packages/{vfs,codec,crypto}/pkg
//   scripts/dev/vendor-assets.sh       -> ide/public/vendor/{npm-pack.bin,sqlite/}
//   scripts/dev/fetch-browser.sh       -> $FACILIS_TOOLING_DIR/browser/{chrome,sysroot}
//
// Usage: node scripts/dev/smoke-ide.mjs [--url http://127.0.0.1:5199/] [--keep-artifacts]
// Retention: the newest SMOKE_KEEP_RUNS (default 5) dirs under the artifacts root are kept
// and older ones are pruned at the end of a run (--keep-artifacts or a pinned
// SMOKE_ARTIFACTS skips that; see scripts/dev/run-artifacts.mjs).
// Exit code 0 = the Studio booted and the created project served a preview.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, openPage } from "./cdp.mjs";
import { pruneSmokeArtifacts } from "./run-artifacts.mjs";
import { runFacilisChecks } from "./smoke-facilis.mjs";
import { runIntellisenseChecks } from "./smoke-intellisense.mjs";
import { runWriteChecks } from "./smoke-write.mjs";
import { runChatChecks } from "./smoke-chat.mjs";
import { runPanelChecks } from "./smoke-panels.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOOLING = process.env.FACILIS_TOOLING_DIR || "/tmp/facilis-dev";
const argValue = (name, fallback) => {
  const index = process.argv.indexOf("--" + name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const URL_ = argValue("url", process.env.STUDIO_URL || "");
const BOOT_TIMEOUT_MS = Number(process.env.BOOT_TIMEOUT_MS || 180000);
const PREVIEW_TIMEOUT_MS = Number(process.env.PREVIEW_TIMEOUT_MS || 300000);
const PORT = Number(process.env.SMOKE_PORT || 5199);
const ARTIFACTS_ROOT = path.join(TOOLING, "smoke-artifacts");
const ARTIFACTS = process.env.SMOKE_ARTIFACTS || path.join(ARTIFACTS_ROOT, String(Date.now()));
const KEEP_ARTIFACTS = process.argv.includes("--keep-artifacts");
const CHROME = process.env.FACILIS_CHROME || path.join(TOOLING, "browser/chrome/chrome");
const SYSROOT = process.env.FACILIS_BROWSER_SYSROOT || path.join(TOOLING, "browser/sysroot");
const FONTCONFIG = process.env.FACILIS_FONTCONFIG || path.join(TOOLING, "browser/fonts.conf");

const failures = [];
let facilisReport = null;
let intellisenseReport = null;
let writeReport = null;
let chatReport = null;
let panelReport = null;
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
      // The dev script passes --host (all interfaces); a later flag wins, so this keeps
      // the test server on loopback and a CI run never exposes a port.
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

  // The IDE creates Facilis projects only (D-051): one dialog, no template picker and no
  // category tabs. Fill the name and create.
  check((await clickText("New project")) === "OK", "new-project dialog opens");
  await sleep(400);
  await page.screenshot(path.join(ARTIFACTS, "02-create-dialog.png"));
  const named = await page.evaluate(
    "(() => { const input = document.querySelector('input[placeholder=my-app]');" +
      " if (!input) return 'NOTFOUND';" +
      " const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;" +
      " set.call(input, 'facilis-smoke');" +
      " input.dispatchEvent(new Event('input', { bubbles: true })); return 'OK'; })()",
  );
  check(named === "OK", "project name filled");
  const createReady = await waitFor(
    "Boolean([...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Create' && !b.disabled))",
    15000,
  );
  check(createReady, "'Create' button enabled");
  let created = false;
  if (createReady) {
    // `install-start` is marked the moment the run lifecycle begins, so it doubles as
    // "the Create handler actually fired"; retrying the click is cheaper than a
    // 5-minute preview timeout that looks like a product bug.
    for (let attempt = 0; attempt < 2 && !created; attempt++) {
      await clickText("Create", true);
      created = await waitForMark("install-start", 15000);
    }
  }
  check(created, "project created");

  // D-127: opening/creating a project lands on the project graph tab, with the Explorer
  // still the left sidebar, and the tour must NOT auto-start under automation (D-128:
  // HeadlessChrome UA is treated as automation). Checked on the controller snapshot, not
  // on tab text, so an inactive graph tab cannot pass it.
  const landedOnGraph = await waitFor(
    "(() => { const s = window.__ide.getSnapshot();" +
      " return s.activeTab !== null && s.tabKinds[s.activeTab] === 'project-graph'; })()",
    30000,
  );
  check(landedOnGraph, "D-127 lands on the project graph");
  check(
    (await page.evaluate("window.__ide.getSnapshot().activeView")) === "explorer",
    "D-127 Explorer stays the default sidebar",
  );
  check(
    !(await page.evaluate("Boolean(document.querySelector('[data-tour-overlay]'))")),
    "D-128 tour does not auto-start under automation",
  );
  await page.screenshot(path.join(ARTIFACTS, "03b-landing-graph.png"));

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

  // The IDE creates only Facilis projects now, so the framework probes always run.
  // The Facilis probe exposes its endpoint results as data-* attributes on its own
  // document; smoke-facilis.mjs owns the contract, polling and failure diagnostics.
  try {
    facilisReport = await runFacilisChecks({ page, check, ARTIFACTS });
    for (const result of facilisReport.checks) {
      if (!result.ok && !failures.includes(result.label)) failures.push(result.label);
    }
  } catch (error) {
    check(false, "facilis checks ran", String(error));
  }
  // IntelliSense is an acceptance criterion of its own (the IDE's TypeScript service
  // must resolve the template's imports, i.e. installed @types/*.d.ts reach Monaco).
  // Runs before the write checks, which edit app.tsx and would make this ambiguous.
  try {
    intellisenseReport = await runIntellisenseChecks({ page, check });
    for (const result of intellisenseReport.checks) {
      if (!result.ok && !failures.includes(result.label)) failures.push(result.label);
    }
  } catch (error) {
    check(false, "intellisense checks ran", String(error));
  }
  // A8/A10/A12 (spec Appendix A): the VFS write path, isomorphic-git on the VFS and the
  // OPFS-mirror reboot. Runs after the framework probe because it edits the template's
  // app.tsx + ping route, which the probe has already asserted.
  try {
    writeReport = await runWriteChecks({ page, check, ARTIFACTS });
    for (const result of writeReport.checks) {
      if (!result.ok && !failures.includes(result.label)) failures.push(result.label);
    }
    // Checks the kernel cannot satisfy yet (read-only upstream tree): printed and put in
    // report.json, deliberately not failures. See docs/DECISIONS.md D-028.
    for (const issue of writeReport.knownIssues) {
      console.log("KNOWN " + issue.label + "  " + issue.detail);
    }
  } catch (error) {
    check(false, "write checks ran", String(error));
  }

  // D-054: dev state belongs in the tree, dimmed as git-ignored, not hidden. The runtime
  // creates it inside the VM and guest writes do not bump the tree, so this runs after the
  // write checks, whose kernel-side save refreshes the Explorer.
  const devStateDimmed = await waitFor(
    "(() => { const row = document.querySelector('[title=\".facilis\"]');" +
      " return !!row && row.hasAttribute('data-git-ignored'); })()",
    15000,
  );
  check(devStateDimmed, "D-054 .facilis listed in the Explorer and dimmed");

  // AI chat (D-045/D-046): real UI, dev-only mock provider, no key and no network.
  // Runs after the framework/write probes so its extra file cannot make them ambiguous.
  try {
    chatReport = await runChatChecks({ page, check, ARTIFACTS });
    for (const result of chatReport.checks) {
      if (!result.ok && !failures.includes(result.label)) failures.push(result.label);
    }
  } catch (error) {
    check(false, "chat checks ran", String(error));
  }

  // Phase 3 visualizers: the project graph and the Release Preview panel (D-092/D-086).
  // Runs after the write/chat probes so the project has routes, a schema and git history.
  try {
    panelReport = await runPanelChecks({ page, check, ARTIFACTS });
    for (const result of panelReport.checks) {
      if (!result.ok && !failures.includes(result.label)) failures.push(result.label);
    }
  } catch (error) {
    check(false, "panel checks ran", String(error));
  }

  // D-128: the guided tour is replayed over the real UI (auto-start is suppressed under
  // automation, so the smoke drives it through the dev-only store handle). Each step's
  // action opens the surface it explains; the screenshots are the visual evidence.
  await page.evaluate("window.__ide.openProjectGraph()");
  const tourStarted = await page.evaluate(
    "(() => { const tour = window.__ideTour; if (!tour) return false; tour.start(); return true; })()",
  );
  check(tourStarted, "D-128 tour store is exposed in dev");
  const tourOverlay = await waitFor("Boolean(document.querySelector('[data-tour-overlay]'))", 5000);
  check(tourOverlay, "D-128 tour overlay renders");
  await sleep(900);
  await page.screenshot(path.join(ARTIFACTS, "10-tour-graph.png"));
  // graph -> activity bar -> files -> AI chat: the chat step must open the chat view.
  await page.evaluate("window.__ideTour.next()");
  await sleep(700);
  await page.screenshot(path.join(ARTIFACTS, "11-tour-activity.png"));
  await page.evaluate("window.__ideTour.next()");
  await sleep(700);
  await page.evaluate("window.__ideTour.next()");
  const chatOpenedByTour = await waitFor("window.__ide.getSnapshot().activeView === 'chat'", 5000);
  check(chatOpenedByTour, "D-128 tour opens the chat it points at");
  await sleep(500);
  await page.screenshot(path.join(ARTIFACTS, "12-tour-chat.png"));
  await page.evaluate("window.__ideTour.skip()");
  const tourClosed = await waitFor("!document.querySelector('[data-tour-overlay]')", 5000);
  check(tourClosed, "D-128 tour closes on skip");

  // Known upstream defect (docs/DECISIONS.md D-026): the first edit in a project with an
  // unresolved import makes monaco 0.55.1's TS worker spread a TS 6.0 diagnostic that
  // carries a repopulateInfo callback into its reply; structured clone rejects it.
  // It is an editor/worker bug, not a VFS one, and manifests only while a module cannot
  // be resolved. Recorded in the report instead of failing the VFS acceptance run.
  //
  // "Canceled: Canceled" is monaco's lazy-chunk Delayer disposing an import that the
  // smoke's own page reboot (A12) or tab switch superseded: a dev-only Vite lazy-loading
  // artifact, seen intermittently, that leaves nothing broken behind (the rerun is green).
  const KNOWN_PAGE_ERRORS = [/could not be cloned/, /^Canceled: Canceled/];
  const knownPageErrors = page.pageErrors.filter((error) =>
    KNOWN_PAGE_ERRORS.some((pattern) => pattern.test(error)),
  );
  const unexpectedPageErrors = page.pageErrors.filter(
    (error) => !KNOWN_PAGE_ERRORS.some((pattern) => pattern.test(error)),
  );
  check(
    unexpectedPageErrors.length === 0,
    "no page errors",
    unexpectedPageErrors.slice(0, 3).join(" | "),
  );
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
  // The Facilis probe deliberately calls /api/todos unauthenticated to prove the 401
  // contract, so that one response is expected rather than a failed request. The React
  // path keeps reporting page.failedRequests, minus one browser behaviour below.
  const EXPECTED_FACILIS_401 = /^401 .*\/api\/todos(?:[?#]|$)/;
  // Browsers request /favicon.ico opportunistically for a document that declares no icon.
  // The generated app's index.html declares none, and the preview document lives on the
  // studio origin, so the miss lands on the studio root: a guest app without an icon
  // always 404s it. Noise, not a broken asset — and in production the build's index.html
  // declares /favicon.svg, so the fallback is not needed there either.
  const IGNORED_FAILED_REQUESTS = [/^404 .*\/favicon\.ico(?:[?#]|$)/];
  const ignored = (entry) =>
    EXPECTED_FACILIS_401.test(entry) ||
    IGNORED_FAILED_REQUESTS.some((pattern) => pattern.test(entry));
  const unexpectedRequests = page.failedRequests.filter((entry) => !ignored(entry));
  check(
    unexpectedRequests.length === 0,
    "no failed requests",
    unexpectedRequests.slice(0, 3).join(" | "),
  );

  // D-050: deleting a project from Home removes its files, behind a typed confirmation.
  // Runs last because it closes the project under test and deletes it.
  const projectRoot = await page.evaluate(
    "window.__ide.getSnapshot().workspaceFolders[0]?.rootPath ?? null",
  );
  if (projectRoot) {
    const name = projectRoot.split("/").pop();
    await page.evaluate("window.__ide.goHome()");
    // The row has two icon buttons that carry the project name (open-in-new-tab and
    // delete); target the delete one by its stable title, not by the name in the label.
    const deleteButton =
      "([...document.querySelectorAll('button')].find((el) => (el.getAttribute('title') || '') === 'Delete project'))";
    const rowReady = await waitFor("Boolean(" + deleteButton + ")", 15000);
    check(rowReady, "delete: Home lists the project");
    if (rowReady) {
      check(
        (await page.evaluate(
          "(() => { const b = " +
            deleteButton +
            "; if (!b) return 'NOTFOUND'; b.click(); return 'OK'; })()",
        )) === "OK",
        "delete: dialog opened from the row",
      );
      const dialogInput = "document.querySelector('[data-slot=\"dialog-content\"] input')";
      const dialogReady = await waitFor("Boolean(" + dialogInput + ")", 15000);
      check(dialogReady, "delete: confirmation dialog opens");
      if (dialogReady) {
        const typed = await page.evaluate(
          "(() => { const input = " +
            dialogInput +
            ";" +
            " if (!input) return 'NOTFOUND';" +
            " const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;" +
            " set.call(input, " +
            JSON.stringify(name) +
            "); input.dispatchEvent(new Event('input', { bubbles: true })); return 'OK'; })()",
        );
        check(typed === "OK", "delete: project name typed");
        // React enables the button from the typed state: wait for it instead of racing the render.
        const enabled =
          "[...document.querySelectorAll('[data-slot=\"dialog-content\"] button')].find((el) => (el.innerText || '').trim() === 'Delete project' && !el.disabled)";
        check(
          await waitFor("Boolean(" + enabled + ")", 5000),
          "delete: confirm enabled after typing the name",
        );
        await page.evaluate(
          "(() => { const b = " +
            enabled +
            "; if (b) b.click(); return b ? 'OK' : 'NOTFOUND'; })()",
        );
        const removedFiles = await waitFor(
          "window.__ide.pathInfo(" + JSON.stringify(projectRoot) + ").then((p) => !p.exists)",
          30000,
        );
        check(removedFiles, "delete: project files removed from the VFS");
        const removedEntry = await waitFor(
          "window.__ide.getSnapshot().recentProjects.every((p) => p.rootPath !== " +
            JSON.stringify(projectRoot) +
            ")",
          15000,
        );
        check(removedEntry, "delete: project removed from the recent list");
      }
    }
  }

  const report = {
    url: dev.url,
    template: "facilis",
    marks: await marks(),
    durationsMs: { total: Date.now() - startedAt },
    consoleErrors: errorConsole,
    pageErrors: unexpectedPageErrors,
    knownPageErrors,
    failedRequests: unexpectedRequests,
    failures,
    ...(facilisReport
      ? { facilis: { dataset: facilisReport.dataset, diagnostics: facilisReport.diagnostics } }
      : {}),
    ...(intellisenseReport
      ? {
          intellisense: {
            checks: intellisenseReport.checks,
            diagnostics: intellisenseReport.diagnostics,
          },
        }
      : {}),
    ...(writeReport
      ? {
          write: {
            checks: writeReport.checks,
            knownIssues: writeReport.knownIssues,
            diagnostics: writeReport.diagnostics,
          },
        }
      : {}),
    ...(chatReport ? { chat: { checks: chatReport.checks } } : {}),
    ...(panelReport ? { panels: { checks: panelReport.checks } } : {}),
  };
  fs.writeFileSync(path.join(ARTIFACTS, "report.json"), JSON.stringify(report, null, 2));
  pruneSmokeArtifacts({
    root: ARTIFACTS_ROOT,
    artifacts: ARTIFACTS,
    keepArtifacts: KEEP_ARTIFACTS,
  });

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
