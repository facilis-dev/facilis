// Facilis-in-WebContainer acceptance checks for scripts/dev/smoke-ide.mjs.
//
// The generated project is examples/todo-app (D-062) and carries NO test instrumentation:
// these checks drive the framework endpoints from the IDE page. The preview is same-origin
// under /preview/<port>/ (and the Service Worker routes those requests into the VM), so a
// fetch from the page exercises exactly the app the user sees, including the session
// cookie the login sets.
//
// FACILIS_PROBE_TIMEOUT_MS (default 120000) bounds the wait for the preview: the app boots
// asynchronously, so the paint mark can precede a serving dev server.

import fs from "node:fs";
import path from "node:path";

const PROBE_TIMEOUT_MS = Number(process.env.FACILIS_PROBE_TIMEOUT_MS || 120000);
const POLL_INTERVAL_MS = 500;
const REVISION_KEY = "facilisRevision";
const EXPECTED = {
  facilisHealth: "ok",
  facilisManifest: "ok",
  facilisWarnings: "0",
  facilisOpenapi: "ok",
  facilisTodos: "401",
  facilisAuth: "ok",
  facilisDbInsert: "ok",
  facilisDbQuery: "ok",
};
const LABELS = {
  facilisHealth: "facilis health endpoint ok",
  facilisManifest: "facilis manifest endpoint ok",
  facilisWarnings: "facilis manifest warnings 0",
  facilisOpenapi: "facilis openapi lists /api/todos with x-db-tables",
  facilisTodos: "facilis todos endpoint 401",
  facilisAuth: "facilis session survives to the next request",
  facilisDbInsert: "facilis db insert (register, log in, POST todo) ok",
  facilisDbQuery: "facilis db query returns the inserted todo",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Same lookup smoke-ide.mjs uses: the preview iframe is the one whose src is /preview/<port>/.
const PREVIEW_SNAPSHOT_EXPRESSION = [
  "(() => {",
  '  const frame = [...document.querySelectorAll("iframe")].find((f) => /preview/.test(f.src || ""));',
  '  if (!frame) return { found: false, src: "", text: "" };',
  '  let text = "";',
  "  try {",
  "    const doc = frame.contentDocument;",
  '    if (doc && doc.body) text = doc.body.innerText || "";',
  "  } catch {",
  "    // Cross-origin or detached for a frame: poll again rather than give up.",
  "  }",
  '  return { found: true, src: frame.src || "", text: text.slice(0, 4000) };',
  "})()",
].join("\n");

const TERMINAL_TEXT_EXPRESSION = [
  "(() => {",
  "  try {",
  '    const rows = [...document.querySelectorAll(".xterm-rows > div")].map((row) => row.textContent || "");',
  "    if (rows.length > 0) return rows.join(String.fromCharCode(10)).slice(-12000);",
  '    const host = document.querySelector(".xterm");',
  '    return host ? (host.textContent || "").slice(-12000) : "";',
  "  } catch {",
  '    return "";',
  "  }",
  "})()",
].join("\n");

// The whole contract in one page evaluation: the DB roundtrip must keep the session cookie
// across its requests, and doing it in one place leaves the cookie jar in the page's hands.
function contractExpression(base) {
  return [
    "(async () => {",
    "  const base = " + JSON.stringify(base) + ";",
    "  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
    "  const json = async (path, init) => {",
    "    try {",
    "      const response = await fetch(base + path, init);",
    "      const text = await response.text();",
    "      let body = null;",
    "      try { body = JSON.parse(text); } catch { body = null; }",
    "      return { status: response.status, ok: response.ok, body: body, text: text.slice(0, 400) };",
    "    } catch (error) {",
    "      return { status: 0, ok: false, body: null, text: String(error) };",
    "    }",
    "  };",
    '  let health = await json("__facilis/health");',
    '  for (let i = 0; i < 40 && !health.ok; i++) { await sleep(500); health = await json("__facilis/health"); }',
    '  const manifest = await json("__facilis/manifest");',
    '  const openapi = await json("_openapi.json");',
    '  const todosAnon = await json("api/todos");',
    '  const email = "probe-" + Date.now() + "@facilis.test";',
    '  const password = "probe-password";',
    '  const title = "probe-" + Date.now();',
    "  const post = (path, body) => json(path, {",
    '    method: "POST",',
    '    headers: { "Content-Type": "application/json" },',
    "    body: JSON.stringify(body),",
    "  });",
    '  const registered = await post("api/auth/register", { email: email, password: password });',
    "  const registeredOk = registered.ok || registered.status === 409;",
    '  const loggedIn = await post("api/auth/login", { email: email, password: password });',
    '  const session = await json("api/auth/session");',
    "  const authenticated = !!session.body && session.body.authenticated === true;",
    '  const inserted = await post("api/todos", { title: title });',
    '  const listed = await json("api/todos");',
    "  const containsTitle = Array.isArray(listed.body) && listed.body.some((row) => row && row.title === title);",
    "  const warnings = manifest.body && Array.isArray(manifest.body.warnings) ? manifest.body.warnings.length : null;",
    '  const revision = manifest.body && typeof manifest.body.revision === "string" ? manifest.body.revision : "";',
    "  const paths = openapi.body && openapi.body.paths;",
    '  const operation = paths && paths["/api/todos"] && paths["/api/todos"].get;',
    "  return {",
    '    health: health.ok ? "ok" : "error:" + health.status,',
    '    manifest: manifest.ok ? "ok" : "error:" + manifest.status,',
    '    warnings: warnings === null ? "missing" : String(warnings),',
    "    revision: revision,",
    "    openapi: !openapi.ok",
    '      ? "error:" + openapi.status',
    '      : operation && operation["x-db-tables"] !== undefined',
    '        ? "ok"',
    '        : "missing",',
    "    todos: String(todosAnon.status),",
    '    auth: authenticated ? "ok" : "anon:" + JSON.stringify(session.body).slice(0, 160),',
    "    dbInsert:",
    "      registeredOk && loggedIn.ok && inserted.ok",
    '        ? "ok"',
    '        : "error:" + registered.status + "/" + loggedIn.status + "/" + inserted.status,',
    '    dbQuery: containsTitle ? "ok" : "error:" + listed.status,',
    "  };",
    "})()",
  ].join("\n");
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
 * Assert the Facilis contract against the preview's endpoints. Records each result through
 * the caller's check, returns { checks, dataset, diagnostics } and never throws for a
 * failed check (the caller decides the exit code).
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

  let snapshot = { found: false, src: "", text: "" };
  let readError = "";
  let base = "";
  let contract = null;
  const until = Date.now() + PROBE_TIMEOUT_MS;
  for (;;) {
    try {
      snapshot = await page.evaluate(PREVIEW_SNAPSHOT_EXPRESSION);
      readError = "";
    } catch (error) {
      readError = error instanceof Error ? error.message : String(error);
    }
    if (snapshot.found && snapshot.src) {
      // The iframe src carries the kernel token as a query string
      // (/preview/3000/?__vv_kernel=...); concatenating a path onto it would send everything
      // to the preview root, so strip query/hash before building the endpoint base.
      try {
        const url = new URL(snapshot.src);
        url.search = "";
        url.hash = "";
        base = url.href.endsWith("/") ? url.href : url.href + "/";
      } catch {
        base = "";
      }
      const health =
        base === ""
          ? false
          : await page
              .evaluate(
                "fetch(" +
                  JSON.stringify(base + "__facilis/health") +
                  ').then((r) => r.ok && !(r.headers.get("content-type") || "").includes("text/html"))' +
                  ".catch(() => false)",
              )
              .catch(() => false);
      if (health === true) {
        contract = await page.evaluate(contractExpression(base)).catch(() => null);
      }
    }
    if (contract !== null) break;
    if (Date.now() >= until) break;
    await sleep(POLL_INTERVAL_MS);
  }

  record(
    snapshot.found,
    "facilis preview iframe located",
    snapshot.src || (readError ? "read error: " + readError : "no iframe src matching /preview/"),
  );

  // The generated project is the todo starter (D-062): its first paint is the login page,
  // so the stable text is the page title, not the brand (the brand panel is hidden at the
  // preview panel's narrow width).
  record(
    String(snapshot.text || "").includes("Log in"),
    "facilis preview renders the starter's login page",
    snapshot.text
      ? "text " + JSON.stringify(snapshot.text.slice(0, 80))
      : "preview document has no text",
  );

  const values = contract || {};
  const dataset = {
    facilisHealth: values.health,
    facilisManifest: values.manifest,
    facilisWarnings: values.warnings,
    facilisRevision: values.revision,
    facilisOpenapi: values.openapi,
    facilisTodos: values.todos,
    facilisAuth: values.auth,
    facilisDbInsert: values.dbInsert,
    facilisDbQuery: values.dbQuery,
  };

  for (const key of Object.keys(EXPECTED)) {
    const actual = dataset[key];
    record(
      actual === EXPECTED[key],
      LABELS[key],
      "value=" + (actual === undefined ? "(missing)" : JSON.stringify(actual)),
    );
  }

  const revision = dataset[REVISION_KEY];
  record(
    typeof revision === "string" && revision.length > 0,
    "facilis manifest revision present",
    typeof revision === "string" ? "revision=" + revision : "value=(missing)",
  );

  const diagnostics = { previewSrc: snapshot.src, dataset };
  const anyFailure = checks.some((entry) => !entry.ok);
  if (anyFailure) {
    diagnostics.timedOut = contract === null;
    diagnostics.previewText = String(snapshot.text || "").slice(0, 400);
    if (snapshot.src) {
      diagnostics.previewHttp = await page
        .evaluate(
          "fetch(" +
            JSON.stringify(snapshot.src) +
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
