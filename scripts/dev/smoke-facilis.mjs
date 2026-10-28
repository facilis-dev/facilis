// Facilis-in-WebContainer acceptance checks for scripts/dev/smoke-ide.mjs.
//
// The Facilis template's probe app records its framework-endpoint results as data-*
// attributes on its own <html> element (ide/src/facilis/, owned by the template):
// facilisHealth / facilisManifest / facilisOpenapi / facilisTodos hold endpoint outcomes,
// facilisWarnings / facilisRevision come from /__facilis/manifest. The preview is
// same-origin under /preview/<port>/, so the parent document can read them directly.
//
// Only imported when the smoke creates TEMPLATE=Facilis; the React path never calls it.
// FACILIS_PROBE_TIMEOUT_MS (default 120000) bounds the polling: the probe app only starts
// its fetches after mount, so `preview-paint` can precede the results by a few seconds;
// once every attribute is present the verdict is final and polling stops early.

import fs from "node:fs";
import path from "node:path";

const PROBE_TIMEOUT_MS = Number(process.env.FACILIS_PROBE_TIMEOUT_MS || 120000);
const POLL_INTERVAL_MS = 250;
const REVISION_KEY = "facilisRevision";
const EXPECTED = {
  facilisHealth: "ok",
  facilisManifest: "ok",
  facilisWarnings: "0",
  facilisOpenapi: "ok",
  facilisTodos: "401",
};
const LABELS = {
  facilisHealth: "facilis health endpoint ok",
  facilisManifest: "facilis manifest endpoint ok",
  facilisWarnings: "facilis manifest warnings 0",
  facilisOpenapi: "facilis openapi lists /api/todos with x-db-tables",
  facilisTodos: "facilis todos endpoint 401",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const kebab = (key) => key.replace(/[A-Z]/g, (char) => "-" + char.toLowerCase());

// Same lookup smoke-ide.mjs uses: the preview iframe is the one whose src is /preview/<port>/.
const PREVIEW_SNAPSHOT_EXPRESSION = `(() => {
  const frame = [...document.querySelectorAll("iframe")].find((f) => /preview/.test(f.src || ""));
  if (!frame) return { found: false, src: "", dataset: null, text: "" };
  let dataset = null;
  let text = "";
  try {
    const doc = frame.contentDocument;
    if (doc && doc.documentElement) {
      dataset = { ...doc.documentElement.dataset };
      text = (doc.body && doc.body.innerText) || "";
    }
  } catch {
    // Cross-origin or detached for a frame: poll again rather than give up.
  }
  return { found: true, src: frame.src || "", dataset, text: text.slice(0, 4000) };
})()`;

// Best-effort IDE terminal capture: the Studio mounts xterm into .vv-term-host containers,
// so the rendered rows are the only text source available over CDP.
const TERMINAL_TEXT_EXPRESSION = `(() => {
  try {
    const rows = [...document.querySelectorAll(".xterm-rows > div")].map((row) => row.textContent || "");
    if (rows.length > 0) return rows.join(String.fromCharCode(10)).slice(-12000);
    const host = document.querySelector(".xterm");
    return host ? (host.textContent || "").slice(-12000) : "";
  } catch {
    return "";
  }
})()`;

function contractMet(snapshot) {
  if (!snapshot || !snapshot.dataset) return false;
  for (const [key, expected] of Object.entries(EXPECTED)) {
    if (snapshot.dataset[key] !== expected) return false;
  }
  const revision = snapshot.dataset[REVISION_KEY];
  if (typeof revision !== "string" || revision.length === 0) return false;
  return String(snapshot.text || "").includes("Facilis");
}

// The probe writes each group of attributes when its fetch resolves, so "all six keys are
// strings" means every endpoint answered and waiting longer cannot change the verdict.
function probeSettled(snapshot) {
  if (!snapshot || !snapshot.dataset) return false;
  if (!Object.keys(EXPECTED).every((key) => typeof snapshot.dataset[key] === "string"))
    return false;
  return typeof snapshot.dataset[REVISION_KEY] === "string";
}

async function waitForContract(page, limitMs) {
  const until = Date.now() + limitMs;
  let last = { found: false, src: "", dataset: null, text: "" };
  let readError = "";
  for (;;) {
    try {
      last = await page.evaluate(PREVIEW_SNAPSHOT_EXPRESSION);
      readError = "";
    } catch (error) {
      readError = error instanceof Error ? error.message : String(error);
    }
    if (contractMet(last)) return { snapshot: last, timedOut: false, readError };
    if (probeSettled(last)) return { snapshot: last, timedOut: false, readError };
    if (Date.now() >= until) return { snapshot: last, timedOut: true, readError };
    await sleep(POLL_INTERVAL_MS);
  }
}

async function readTerminalText(page) {
  try {
    return String((await page.evaluate(TERMINAL_TEXT_EXPRESSION)) || "");
  } catch (error) {
    return (
      "xterm terminal not reachable: " + (error instanceof Error ? error.message : String(error))
    );
  }
}

async function captureEvidence(page, ARTIFACTS, diagnostics) {
  if (!ARTIFACTS) return;
  try {
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    await page.screenshot(path.join(ARTIFACTS, "04-facilis-failure.png"));
    diagnostics.screenshot = "04-facilis-failure.png";
  } catch {
    // Evidence only: a screenshot failure must not change the verdict.
  }
  try {
    fs.writeFileSync(
      path.join(ARTIFACTS, "facilis-diagnostics.json"),
      JSON.stringify(diagnostics, null, 2),
    );
    diagnostics.diagnosticsFile = "facilis-diagnostics.json";
  } catch {
    // Same: diagnostics are best-effort.
  }
}

/**
 * Assert the Facilis probe contract from the preview iframe's own document. Records each
 * result through the caller's `check`, returns { checks, dataset, diagnostics } and never
 * throws for a failed check (the caller decides the exit code).
 */
export async function runFacilisChecks({ page, check, ARTIFACTS }) {
  const checks = [];
  const record = (ok, label, detail) => {
    const entry = { label, ok: Boolean(ok), detail: detail || "" };
    checks.push(entry);
    try {
      check(entry.ok, label, entry.detail);
    } catch {
      // The reporter is not part of the verdict.
    }
  };

  let result;
  try {
    result = await waitForContract(page, PROBE_TIMEOUT_MS);
  } catch (error) {
    result = {
      snapshot: { found: false, src: "", dataset: null, text: "" },
      timedOut: true,
      readError: error instanceof Error ? error.message : String(error),
    };
  }

  const { snapshot, timedOut, readError } = result;
  const dataset = snapshot && snapshot.dataset ? snapshot.dataset : {};
  const previewText = String((snapshot && snapshot.text) || "");
  const previewSrc = String((snapshot && snapshot.src) || "");

  record(
    Boolean(snapshot && snapshot.found),
    "facilis preview iframe located",
    previewSrc || (readError ? "read error: " + readError : "no iframe src matching /preview/"),
  );

  for (const key of Object.keys(EXPECTED)) {
    const actual = dataset[key];
    record(
      actual === EXPECTED[key],
      LABELS[key],
      "data-" + kebab(key) + "=" + (actual === undefined ? "(missing)" : JSON.stringify(actual)),
    );
  }

  const revision = dataset[REVISION_KEY];
  record(
    typeof revision === "string" && revision.length > 0,
    "facilis manifest revision present",
    typeof revision === "string" ? "revision=" + revision : "data-facilis-revision=(missing)",
  );

  record(
    previewText.includes("Facilis"),
    "facilis preview renders Facilis text",
    previewText
      ? "text " + JSON.stringify(previewText.slice(0, 80))
      : "preview document has no text",
  );

  const diagnostics = { previewSrc };
  const anyFailure = checks.some((entry) => !entry.ok);
  if (anyFailure) {
    diagnostics.previewFound = Boolean(snapshot && snapshot.found);
    diagnostics.timedOut = timedOut;
    diagnostics.previewText = previewText.slice(0, 400);
    diagnostics.dataset = dataset;
    // The preview can be a 500 envelope from the framework runtime; keep its body so a
    // failed run explains itself instead of just saying the document had no text.
    if (previewSrc) {
      diagnostics.previewHttp = await page
        .evaluate(
          "fetch(" +
            JSON.stringify(previewSrc) +
            ").then(async (r) => ({ status: r.status, body: (await r.text()).slice(0, 2500) }))" +
            ".catch((e) => ({ error: String(e) }))",
        )
        .catch((error) => ({ error: String(error) }));
    }
    diagnostics.ideTerminalText = (await readTerminalText(page)).slice(-12000);
    if (readError) diagnostics.readError = readError;
    await captureEvidence(page, ARTIFACTS, diagnostics);
  }

  return { checks, dataset, diagnostics };
}
