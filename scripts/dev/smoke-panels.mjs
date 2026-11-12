// Phase 3 visualizer acceptance: the project graph (AST, D-092), the Data Explorer and its
// SQL console (D-083/D-097), and the Release Preview panel (D-086).
//
// The project under test has routes, a schema and (after the write checks) commits, so the
// panels have real data: the project graph reads the analyzer facts from the VFS worker, the
// Data Explorer and the query console read the running dev server, the Release Preview reads
// the git refs out of the VFS. No mocking and no network: this is the same UI a developer uses.

import { runScmChecks } from "./smoke-scm.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(page, expression, limitMs) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    if (await page.evaluate(expression)) return true;
    await sleep(250);
  }
  return false;
}

function clickActivity(label) {
  return (
    "(() => { const button = [...document.querySelectorAll('button')].find(" +
    "(candidate) => (candidate.getAttribute('aria-label') || '') === " +
    JSON.stringify(label) +
    "); if (!button) return 'NOTFOUND'; button.click(); return 'OK'; })()"
  );
}

function clickTestId(testId) {
  return (
    "(() => { const element = document.querySelector('[data-testid=" +
    JSON.stringify(testId) +
    "]'); if (!element) return 'NOTFOUND'; element.click(); return 'OK'; })()"
  );
}

// Monaco does not read a textarea value written from JS: the editor owns its model and its
// DOM textarea only takes real input events. Click to focus, send CDP Input.insertText, then
// read the rendered lines back. Also works while [data-testid] is still a plain textarea.
async function focusTestId(page, testId) {
  const point = await page.evaluate(
    "(() => { const host = document.querySelector('[data-testid=" +
      JSON.stringify(testId) +
      "]'); if (!host) return null;" +
      " const target = host.matches('textarea, .monaco-editor') ? host : host.querySelector('.monaco-editor') || host;" +
      " const box = target.getBoundingClientRect();" +
      " if (box.width < 2 || box.height < 2) return null;" +
      " return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }; })()",
  );
  if (!point) return "NOTFOUND";
  const click = { x: point.x, y: point.y, button: "left", clickCount: 1 };
  await page.send("Input.dispatchMouseEvent", { ...click, type: "mousePressed", buttons: 1 });
  await page.send("Input.dispatchMouseEvent", { ...click, type: "mouseReleased", buttons: 0 });
  await sleep(100);
  return "OK";
}

async function pressKey(page, key, code, keyCode, modifiers = 0) {
  const shape = { key, code, windowsVirtualKeyCode: keyCode, modifiers };
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...shape });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...shape });
}

const editorText = (testId) =>
  "(() => { const host = document.querySelector('[data-testid=" +
  JSON.stringify(testId) +
  "]'); if (!host) return null; const lines = host.querySelector('.view-lines');" +
  " if (lines) return lines.innerText || ''; return 'value' in host ? String(host.value) : host.innerText || ''; })()";

const normalized = (text) => String(text).replace(/\s+/g, " ").trim();
async function editorReady(page, testId) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    const state = await page.evaluate(
      "(() => { const host = document.querySelector('[data-testid=" +
        JSON.stringify(testId) +
        "]'); if (!host) return 'MISSING'; if (host.matches('textarea, .monaco-editor')) return 'OK';" +
        " return host.querySelector('.monaco-editor') ? 'OK' : 'LOADING'; })()",
    );
    if (state === "OK") return "OK";
    await sleep(200);
  }
  return "NOT READY";
}

async function typeSql(page, testId, sql) {
  if ((await editorReady(page, testId)) !== "OK") return "NOT READY";
  if ((await focusTestId(page, testId)) !== "OK") return "NOTFOUND";
  await pressKey(page, "a", "KeyA", 65, 2); // select all, so a retype replaces the model
  await page.send("Input.insertText", { text: sql });
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    const shown = await page.evaluate(editorText(testId));
    // Equality, not inclusion: it also proves select-all replaced the previous text.
    if (shown !== null && normalized(shown) === normalized(sql)) return "OK";
    await sleep(100);
  }
  return String(await page.evaluate(editorText(testId))).slice(0, 300);
}
// Ctrl+Space opens the suggest widget; an empty completion leaves it without rows or with
// "No suggestions", which the check reports as its DOM state.
const SUGGEST_OPEN =
  "(() => { const widget = document.querySelector('.suggest-widget.visible');" +
  " return Boolean(widget) && widget.querySelectorAll('.monaco-list-row').length > 0; })()";
const SUGGEST_STATE =
  "(() => { const w = document.querySelector('.suggest-widget');" +
  " return JSON.stringify({ widget: w ? String(w.className) : null, rows: w ? w.querySelectorAll('.monaco-list-row').length : 0 }); })()";

// What the sidebar says when no table rendered: its error/retry text, else the page text.
const EXPLORER_DETAIL =
  "(() => { const head = document.querySelector('[data-testid=data-query-open]');" +
  " const aside = head ? head.closest('aside') : null;" +
  " const text = aside ? 'sidebar: ' + (aside.innerText || '') : 'NO SIDEBAR — ' + (document.body.innerText || '');" +
  " return text.slice(0, 400); })()";

const COUNT = (selector) => "document.querySelectorAll(" + JSON.stringify(selector) + ").length";

export async function runPanelChecks({ page, check, ARTIFACTS }) {
  const checks = [];
  const record = (ok, label, detail = "") => {
    check(ok, label, detail);
    checks.push({ ok, label, detail });
  };

  // ── Project graph (D-092): the AST analyzer runs in a worker over the VFS, with no
  // runtime endpoint; the panel is only useful if the wasm parser actually loaded. ──
  record(
    (await page.evaluate(clickActivity("Project graph"))) === "OK",
    "project graph: activity opens",
  );
  record(
    await waitFor(
      page,
      "Boolean(document.querySelector('[data-testid=\"project-graph-panel\"]'))",
      15000,
    ),
    "project graph: panel mounted",
  );
  const graphCanvas = await waitFor(
    page,
    "Boolean(document.querySelector('[data-testid=\"project-graph-canvas\"]'))",
    60000,
  );
  record(
    graphCanvas,
    "project graph: analyzer result rendered",
    graphCanvas ? "" : await page.evaluate("(document.body.innerText || '').slice(0, 400)"),
  );
  record(
    await waitFor(page, COUNT('[data-testid="project-graph-table"]') + " > 0", 30000),
    "project graph: tables rendered",
  );
  record(
    await waitFor(page, COUNT('[data-testid="project-graph-route"]') + " > 0", 30000),
    "project graph: routes rendered",
  );
  record(
    await waitFor(page, COUNT('[data-testid="project-graph-page"]') + " > 0", 30000),
    "project graph: pages rendered",
  );
  await page.screenshot(ARTIFACTS + "/05b-project-graph.png");

  // ── Data Explorer sidebar and its SQL console (D-083/D-097): the sidebar reads the
  // schema and the console posts through the preview proxy. Clicking the active activity
  // collapses the sidebar, so click only when it is not mounted (see the retry button). ──
  // A12 reboots the page: the project then restores its prebuilt dependencies, and every
  // preview-proxy request answers 502 ("no live server on the port") until the dev server
  // binds. Wait for the preview to actually serve, or a booting preview turns the console
  // checks red for a reason that is not the console.
  const previewServing = await waitFor(
    page,
    "(() => { const f = [...document.querySelectorAll('iframe')].find((x) => /preview/.test(x.src || ''));" +
      " if (!f) return false; try { return (f.contentDocument?.body?.innerText || '').includes('Log in'); } catch { return false; } })()",
    120000,
  );
  record(
    previewServing,
    "data explorer: preview dev server serving",
    previewServing ? "" : "not serving",
  );
  const explorerMounted = COUNT('[data-testid="data-query-open"]') + " > 0";
  let dataTables = await waitFor(page, COUNT('[data-testid="data-explorer-table"]') + " > 0", 750);
  let activityOpens = true;
  if (!dataTables && !(await page.evaluate(explorerMounted))) {
    activityOpens = (await page.evaluate(clickActivity("Data"))) === "OK";
    dataTables = await waitFor(page, COUNT('[data-testid="data-explorer-table"]') + " > 0", 20000);
  }
  record(activityOpens, "data explorer: activity opens");
  record(
    dataTables,
    "data explorer: tables rendered",
    dataTables ? "" : await page.evaluate(EXPLORER_DETAIL),
  );
  record(
    (await page.evaluate(clickTestId("data-query-open"))) === "OK",
    "query console: open button works",
  );
  record(
    await waitFor(
      page,
      "Boolean(document.querySelector('[data-testid=\"data-query-panel\"]'))",
      15000,
    ),
    "query console: panel mounted",
  );
  // Completion: "select " + Ctrl+Space must open Monaco's suggest widget with at least one
  // item. The SQL enters through the editor's real input path, not the DOM textarea value.
  const seeded = await typeSql(page, "data-query-editor", "select ");
  let suggested = false;
  if (seeded === "OK") {
    await pressKey(page, " ", "Space", 32, 2);
    suggested = await waitFor(page, SUGGEST_OPEN, 5000);
  }
  record(
    suggested,
    "query console: completion suggests",
    suggested ? "" : seeded === "OK" ? await page.evaluate(SUGGEST_STATE) : seeded,
  );
  await pressKey(page, "Escape", "Escape", 27);
  const typed = await typeSql(page, "data-query-editor", "select count(*) as count from todos");
  record(typed === "OK", "query console: SQL entered", typed === "OK" ? "" : typed);
  const runEnabled = await waitFor(
    page,
    "Boolean(document.querySelector('[data-testid=\"data-query-run\"]:not([disabled])'))",
    5000,
  );
  record(runEnabled, "query console: run enabled");
  if (runEnabled) {
    record(
      (await page.evaluate(clickTestId("data-query-run"))) === "OK",
      "query console: run clicked",
    );
  }
  const rows = await waitFor(page, COUNT('[data-testid="data-query-row"]') + " > 0", 30000);
  record(
    rows,
    "query console: rows rendered",
    rows ? "" : await page.evaluate("(document.body.innerText || '').slice(-600)"),
  );
  await page.screenshot(ARTIFACTS + "/06b-data-query.png");

  // ── Source Control: diff tab + commit graph (D-088/D-089) ──
  await runScmChecks({ page, check, ARTIFACTS });

  // ── Release Preview (SPEC §11.3, D-086) ──
  record(
    (await page.evaluate(clickActivity("Release Preview"))) === "OK",
    "release: activity opens",
  );
  record(
    await waitFor(
      page,
      "Boolean(document.querySelector('[data-testid=\"release-preview-panel\"]'))",
      15000,
    ),
    "release: panel mounted",
  );
  const content = await waitFor(
    page,
    "Boolean(document.querySelector('[data-testid=\"release-preview-content\"]'))",
    45000,
  );
  record(
    content,
    "release: preview content rendered",
    content ? "" : await page.evaluate("(document.body.innerText || '').slice(0, 400)"),
  );
  const lenses = await waitFor(
    page,
    "Boolean(document.querySelector('[data-testid=\"release-lens-working\"]'))",
    15000,
  );
  record(lenses, "release: the working-copy lens is offered");
  if (lenses) {
    record(
      (await page.evaluate(
        "(() => { const b = document.querySelector('[data-testid=\"release-lens-working\"]');" +
          " if (!b) return 'NOTFOUND'; b.click(); return 'OK'; })()",
      )) === "OK",
      "release: working-copy lens selected",
    );
    record(
      await waitFor(
        page,
        "Boolean(document.querySelector('[data-testid=\"release-statement\"]')) || " +
          "Boolean(document.querySelector('[data-testid=\"release-preview-content\"]'))",
        30000,
      ),
      "release: preview rendered after switching lens",
    );
  }
  await page.screenshot(ARTIFACTS + "/06-release-preview.png");
  return { checks };
}
