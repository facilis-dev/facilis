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

  // ── Full-bleed canvas + floating HUD (issue #57) ──────────────────────────────
  // The canvas fills the tab; the HUD clusters float over it (absolute), so they never subtract
  // from the canvas rect. Acceptance is measured at two fixed viewports with nothing selected.
  const CANVAS_RATIO =
    '(() => { const panel = document.querySelector("[data-testid=project-graph-panel]");' +
    ' const canvas = document.querySelector("[data-testid=project-graph-canvas]");' +
    " if (!panel || !canvas) return null;" +
    " const p = panel.getBoundingClientRect(); const c = canvas.getBoundingClientRect();" +
    " if (p.width < 2 || p.height < 2) return null;" +
    " return { ratio: (c.width * c.height) / (p.width * p.height) }; })()";
  const CANVAS_RECT =
    '(() => { const c = document.querySelector("[data-testid=project-graph-canvas]");' +
    " if (!c) return null; const r = c.getBoundingClientRect();" +
    " return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })()";
  const setViewport = (width, height) =>
    page.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });

  // (1) >=95% of the tab area at 1024x768 (HUD icon-only) and 1920x1080 (HUD labelled).
  for (const [width, height] of [
    [1024, 768],
    [1920, 1080],
  ]) {
    await setViewport(width, height);
    await sleep(500);
    const ratio = await page.evaluate(CANVAS_RATIO);
    record(
      ratio !== null && ratio.ratio >= 0.95,
      "project graph: canvas full-bleed >=95% at " + width + "x" + height,
      ratio === null ? "canvas/panel not mounted" : "ratio=" + ratio.ratio.toFixed(3),
    );
  }

  // (4) Every HUD control is a named, keyboard-reachable button/input; clusters are role=toolbar.
  const a11y = await page.evaluate(
    '(() => { const hud = document.querySelector("[data-testid=graph-hud]"); if (!hud) return null;' +
      ' const toolbars = hud.querySelectorAll("[role=toolbar]").length;' +
      ' const buttons = [...hud.querySelectorAll("button")];' +
      ' const unnamed = buttons.filter((b) => !(b.getAttribute("aria-label") || "").trim() && !(b.textContent || "").trim()).length;' +
      ' const inputs = [...hud.querySelectorAll("input")];' +
      ' const unnamedInputs = inputs.filter((i) => !(i.getAttribute("aria-label") || "").trim()).length;' +
      " return { toolbars, buttons: buttons.length, unnamed, unnamedInputs }; })()",
  );
  record(
    a11y !== null &&
      a11y.toolbars >= 3 &&
      a11y.buttons > 0 &&
      a11y.unnamed === 0 &&
      a11y.unnamedInputs === 0,
    "project graph: HUD controls named and grouped as toolbars",
    JSON.stringify(a11y),
  );

  // (2) Selecting a node opens the inspector as an overlay: the canvas rect must not move/resize.
  const before = await page.evaluate(CANVAS_RECT);
  const clickedNode = await page.evaluate(
    '(() => { const n = document.querySelector("[data-testid=project-graph-table]");' +
      ' if (!n) return "NOTFOUND"; n.click(); return "OK"; })()',
  );
  const inspectorShown = await waitFor(
    page,
    'Boolean(document.querySelector("[data-testid=project-graph-inspector]"))',
    5000,
  );
  const after = await page.evaluate(CANVAS_RECT);
  const stable =
    before !== null &&
    after !== null &&
    before.x === after.x &&
    before.y === after.y &&
    before.w === after.w &&
    before.h === after.h;
  record(
    clickedNode === "OK" && inspectorShown && stable,
    "project graph: selection opens overlay with no canvas resize",
    "click=" +
      clickedNode +
      " inspector=" +
      inspectorShown +
      " before=" +
      JSON.stringify(before) +
      " after=" +
      JSON.stringify(after),
  );
  // Close the inspector so it does not shadow the fit check below.
  await page.evaluate(
    '(() => { const b = document.querySelector("[data-testid=project-graph-inspector] button");' +
      " if (b) b.click(); })()",
  );
  await sleep(200);

  // (3) fitView parks no node under a HUD zone: padding comes from the measured cluster rects.
  record(
    (await page.evaluate(clickTestId("graph-hud-fit"))) === "OK",
    "project graph: fit button clicked",
  );
  await sleep(500);
  const fitClear = await page.evaluate(
    '(() => { const zones = [...document.querySelectorAll("[data-hud-zone]")].map((z) => z.getBoundingClientRect());' +
      ' const nodes = [...document.querySelectorAll(".react-flow__node")].map((n) => n.getBoundingClientRect());' +
      " let overlaps = 0;" +
      " for (const n of nodes) for (const z of zones) {" +
      "   const w = Math.min(n.right, z.right) - Math.max(n.left, z.left);" +
      "   const h = Math.min(n.bottom, z.bottom) - Math.max(n.top, z.top);" +
      "   if (w > 2 && h > 2) overlaps++;" +
      " } return { nodes: nodes.length, zones: zones.length, overlaps }; })()",
  );
  record(
    fitClear !== null && fitClear.nodes > 0 && fitClear.zones > 0 && fitClear.overlaps === 0,
    "project graph: fit leaves no node under a HUD zone",
    JSON.stringify(fitClear),
  );

  // (4) Zen hides the HUD (canvas stays full-bleed); Esc restores it.
  record(
    (await page.evaluate(clickTestId("graph-hud-zen"))) === "OK",
    "project graph: zen toggled on",
  );
  const hudHidden = await waitFor(page, '!document.querySelector("[data-testid=graph-hud]")', 5000);
  const zenRatio = await page.evaluate(CANVAS_RATIO);
  record(
    hudHidden && zenRatio !== null && zenRatio.ratio >= 0.95,
    "project graph: zen hides HUD, canvas stays full-bleed",
    "hidden=" + hudHidden + " ratio=" + (zenRatio === null ? "null" : zenRatio.ratio.toFixed(3)),
  );
  await pressKey(page, "Escape", "Escape", 27);
  const hudRestored = await waitFor(
    page,
    'Boolean(document.querySelector("[data-testid=graph-hud]"))',
    5000,
  );
  record(hudRestored, "project graph: Esc restores the HUD");

  // (5) Stats counters filter the graph and expose aria-pressed.
  const pressed = (testId) =>
    '(() => { const b = document.querySelector("[data-testid=' +
    testId +
    ']");' +
    ' return b ? b.getAttribute("aria-pressed") : "NOTFOUND"; })()';
  await page.evaluate(clickTestId("graph-stat-table"));
  const tablePressed = await waitFor(page, pressed("graph-stat-table") + ' === "true"', 5000);
  const isolated = await waitFor(
    page,
    'document.querySelectorAll("[data-testid=project-graph-route]").length === 0',
    5000,
  );
  record(
    tablePressed && isolated,
    "project graph: stats counter filters kinds with aria-pressed",
    "pressed=" + tablePressed + " routesHidden=" + isolated,
  );
  await page.evaluate(clickTestId("graph-stat-table"));
  await waitFor(
    page,
    'document.querySelectorAll("[data-testid=project-graph-route]").length > 0',
    5000,
  );
  await page.evaluate(clickTestId("graph-stat-edges"));
  const edgesPressed = await waitFor(page, pressed("graph-stat-edges") + ' === "true"', 5000);
  const edgesHidden = await waitFor(
    page,
    'document.querySelectorAll(".react-flow__edge").length === 0',
    5000,
  );
  record(
    edgesPressed && edgesHidden,
    "project graph: edges counter hides edges with aria-pressed",
    "pressed=" + edgesPressed + " edgesHidden=" + edgesHidden,
  );
  await page.evaluate(clickTestId("graph-stat-edges"));
  await waitFor(page, 'document.querySelectorAll(".react-flow__edge").length > 0', 5000);
  await page.screenshot(ARTIFACTS + "/05c-project-graph-hud.png");

  // ── Lens chips + edge-kind isolation (issue #63) ─────────────────────────────
  // The chips dock bottom-left: click isolates (opacity only, never a removal), Alt-click hides
  // (the ribbon keeps the hidden count), a third lens is refused with a hint, arrows roam.
  const EDGE_DIM =
    '(() => { const paths = [...document.querySelectorAll(".react-flow__edge path:not(.react-flow__edge-interaction)")];' +
    " if (paths.length === 0) return null;" +
    " const ops = paths.map((p) => Number(getComputedStyle(p).opacity));" +
    " return { total: paths.length, dim: ops.filter((o) => o <= 0.11).length, bright: ops.filter((o) => o >= 0.9).length }; })()";
  const NODE_RECTS =
    '(() => [...document.querySelectorAll(".react-flow__node")].map((n) => { const r = n.getBoundingClientRect();' +
    ' return Math.round(r.x) + ":" + Math.round(r.y); }).join(","))()';
  const chipCount = await page.evaluate('document.querySelectorAll("[data-graph-chip]").length');
  record(
    chipCount === 13,
    "project graph: 7 edge-kind + 6 lens chips docked",
    "chips=" + chipCount,
  );

  const beforeIso = await page.evaluate(EDGE_DIM);
  const nodesBefore = await page.evaluate(NODE_RECTS);
  await page.evaluate(clickTestId("graph-chip-edge-route-table"));
  const isoPressed = await waitFor(
    page,
    pressed("graph-chip-edge-route-table") + ' === "true"',
    5000,
  );
  const duringIso = await page.evaluate(EDGE_DIM);
  const nodesDuring = await page.evaluate(NODE_RECTS);
  record(
    isoPressed &&
      beforeIso !== null &&
      duringIso !== null &&
      duringIso.total === beforeIso.total &&
      duringIso.dim > 0 &&
      duringIso.bright > 0 &&
      nodesBefore === nodesDuring,
    "project graph: isolation dims other kinds without removing edges or moving nodes",
    "pressed=" +
      isoPressed +
      " before=" +
      JSON.stringify(beforeIso) +
      " during=" +
      JSON.stringify(duringIso),
  );
  // The isolation rides the gv URL parameter (issue #58): shareable and reload-safe.
  const isoInUrl = await waitFor(
    page,
    '(() => { const gv = new URLSearchParams(location.search).get("gv"); if (!gv) return false;' +
      ' try { const v = JSON.parse(gv); return Array.isArray(v.i) && v.i.length === 1 && v.i[0] === "route-table"; } catch { return false; } })()',
    5000,
  );
  record(isoInUrl, "project graph: isolation persisted in the view-state URL");
  await page.evaluate(clickTestId("graph-chip-edge-route-table"));
  const isoCleared = await waitFor(
    page,
    pressed("graph-chip-edge-route-table") + ' === "false"',
    5000,
  );
  const afterIso = await page.evaluate(EDGE_DIM);
  record(
    isoCleared && afterIso !== null && afterIso.dim === 0,
    "project graph: second click clears the isolation",
    "pressed=" + isoCleared + " after=" + JSON.stringify(afterIso),
  );

  // Alt-click hides the kind; the ribbon's hidden counter stays available, then alt-click restores.
  const altClick = (testId) =>
    "(() => { const b = document.querySelector('[data-testid=" +
    JSON.stringify(testId) +
    "]'); if (!b) return 'NOTFOUND';" +
    " b.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true })); return 'OK'; })()";
  const edgesBeforeHide = await page.evaluate(EDGE_DIM);
  await page.evaluate(altClick("graph-chip-edge-route-table"));
  const hiddenShown = await waitFor(
    page,
    'Boolean(document.querySelector("[data-testid=graph-hidden-count]"))',
    5000,
  );
  const edgesAfterHide = await page.evaluate(EDGE_DIM);
  record(
    hiddenShown &&
      edgesBeforeHide !== null &&
      edgesAfterHide !== null &&
      edgesAfterHide.total < edgesBeforeHide.total,
    "project graph: alt-click hides a kind and the hidden count stays available",
    "counter=" +
      hiddenShown +
      " before=" +
      JSON.stringify(edgesBeforeHide) +
      " after=" +
      JSON.stringify(edgesAfterHide),
  );
  await page.evaluate(altClick("graph-chip-edge-route-table"));
  await waitFor(page, '!document.querySelector("[data-testid=graph-hidden-count]")', 5000);

  // Keyboard: arrows roam the chips, Alt+Space hides, Space isolates (trusted CDP keys).
  // route-table is the kind the demo project certainly has (its routes declare dbTables).
  await page.evaluate(
    'document.querySelector("[data-testid=graph-chip-edge-route-table]").focus()',
  );
  await pressKey(page, "ArrowRight", "ArrowRight", 39);
  const roved = await page.evaluate(
    'document.activeElement?.getAttribute("data-testid") === "graph-chip-edge-page-route"',
  );
  await pressKey(page, "ArrowLeft", "ArrowLeft", 37);
  await pressKey(page, " ", "Space", 32, 1); // Alt+Space hides the focused kind
  const altSpaceHidden = await waitFor(
    page,
    'Boolean(document.querySelector("[data-testid=graph-hidden-count]"))',
    5000,
  );
  await pressKey(page, " ", "Space", 32, 1);
  await waitFor(page, '!document.querySelector("[data-testid=graph-hidden-count]")', 5000);
  await pressKey(page, " ", "Space", 32); // plain Space isolates
  const spacePressed = await waitFor(
    page,
    pressed("graph-chip-edge-route-table") + ' === "true"',
    5000,
  );
  await pressKey(page, " ", "Space", 32);
  await waitFor(page, pressed("graph-chip-edge-route-table") + ' === "false"', 5000);
  record(
    roved && altSpaceHidden && spacePressed,
    "project graph: chips keyboard-reachable (arrows, Space, Alt+Space)",
    "roved=" + roved + " altSpace=" + altSpaceHidden + " space=" + spacePressed,
  );

  // Lenses: the second demotes the first to secondary; a third is refused with a visible hint.
  await page.evaluate(clickTestId("graph-chip-lens-contract"));
  await waitFor(page, pressed("graph-chip-lens-contract") + ' === "true"', 5000);
  await page.evaluate(clickTestId("graph-chip-lens-data"));
  const secondaryMarked = await waitFor(
    page,
    '(() => { const c = document.querySelector("[data-testid=graph-chip-lens-contract]");' +
      ' return c !== null && (c.textContent || "").includes("secondary"); })()',
    5000,
  );
  await page.evaluate(clickTestId("graph-chip-lens-runtime"));
  const hintShown = await waitFor(
    page,
    'Boolean(document.querySelector("[data-testid=graph-lens-hint]"))',
    5000,
  );
  const runtimeRefused = await page.evaluate(pressed("graph-chip-lens-runtime"));
  record(
    secondaryMarked && hintShown && runtimeRefused === "false",
    "project graph: second lens demotes the first, third refused with a hint",
    "secondary=" + secondaryMarked + " hint=" + hintShown + " runtime=" + runtimeRefused,
  );
  await page.evaluate(clickTestId("graph-chip-lens-data"));
  await page.evaluate(clickTestId("graph-chip-lens-contract"));
  await waitFor(page, pressed("graph-chip-lens-contract") + ' === "false"', 5000);
  await page.screenshot(ARTIFACTS + "/05d-project-graph-chips.png");

  // ── Data lens (issue #70) ─────────────────────────────────────────────────────
  // The lens restyles the schema half: ribbon counters equal the DOM scan, elevated edges
  // carry the dotted stroke + lock, a table selection dims to its FK neighbourhood, and
  // positions hold under edge-isolation and contract+data stacking. The demo has no view, so
  // one is created through the VFS (the same path a user edit takes) and left in place: the
  // later SCM checks want a dirty tree anyway.
  const dataRoot = await page.evaluate("window.__ide.activeFolder?.rootPath ?? null");
  const viewPath = dataRoot + "/db/views/smoke-definer.ts";
  const viewSource =
    'import { sql } from "drizzle-orm";\n' +
    'import { defineView } from "@facilis.dev/db";\n' +
    'import { boolean, text } from "drizzle-orm/pg-core";\n' +
    "export const smokeDefiner = defineView({\n" +
    '  name: "smoke_definer",\n' +
    '  columns: { id: text("id"), done: boolean("done") },\n' +
    "  query: sql`select id, done from todos where not done`,\n" +
    '  tables: ["todos"],\n' +
    '  permission: "todos:read",\n' +
    "});\n";
  await page.evaluate(
    "window.__ide.bridge.request('vv-mkdirp', { path: " +
      JSON.stringify(dataRoot + "/db/views") +
      " })",
  );
  const viewWritten = await page.evaluate(
    "window.__ide.bridge.request('vv-write', { path: " +
      JSON.stringify(viewPath) +
      ", contents: " +
      JSON.stringify(viewSource) +
      " }).then((r) => r && r.ok === true)",
  );
  // The controller bumps its snapshot on the kernel's fs-changed event, asynchronously: the
  // refresh must wait until the file is listed, or the analysis re-runs on the stale snapshot
  // (the per-snapshot cache would then return the old result without the view).
  const viewInSnapshot = await waitFor(
    page,
    "window.__ide.getSnapshot().files.some((f) => f.endsWith('/db/views/smoke-definer.ts'))",
    10000,
  );
  await page.evaluate(clickTestId("graph-chip-lens-data"));
  const dataPressed = await waitFor(page, pressed("graph-chip-lens-data") + ' === "true"', 5000);
  await page.evaluate(clickTestId("graph-hud-refresh"));
  const dataViewRendered = await waitFor(
    page,
    COUNT('[data-testid="project-graph-view"]') + " > 0",
    30000,
  );
  // Re-fit so the new view card is inside the viewport: onlyRenderVisibleElements would
  // otherwise cull it and the DOM scan could not equal the ribbon's visible-view scan.
  await page.evaluate(clickTestId("graph-hud-fit"));
  await sleep(400);
  const ribbonMounted = await waitFor(
    page,
    'Boolean(document.querySelector("[data-testid=graph-data-ribbon]"))',
    5000,
  );
  // Criterion 4 in the browser: each counter equals a scan of the drawn cards/edges.
  const DATA_SCAN_OK =
    "(() => { const num = (id) => { const el = document.querySelector('[data-testid=\"' + id + '\"] .tabular-nums'); return el ? Number(el.textContent) : NaN; };" +
    ' const unscoped = document.querySelectorAll("[data-testid=project-graph-table] [data-testid=data-scope][data-state=none]").length;' +
    ' const definer = document.querySelectorAll("[data-testid=project-graph-view] [data-testid=data-access][data-state=definer]").length;' +
    ' const locks = document.querySelectorAll("[data-testid=data-edge-lock]").length;' +
    ' return num("graph-data-unscoped") === unscoped && num("graph-data-definer") === definer && num("graph-data-elevated") === locks && locks > 0 && definer > 0; })()';
  const countersEqualScan = await waitFor(page, DATA_SCAN_OK, 5000);
  // The permission rides the badge's title at every LOD: below the compact threshold the
  // word drops to glyph+count, so the check reads the title, never the rendered label.
  const definerBadge = await waitFor(
    page,
    '(() => { const v = [...document.querySelectorAll("[data-testid=project-graph-view]")].find((c) => (c.textContent || "").includes("smoke_definer"));' +
      " if (v === undefined) return false;" +
      ' const perm = v.querySelector("[data-testid=data-permission]");' +
      ' return v.querySelector("[data-testid=data-access][data-state=definer]") !== null && perm !== null && (perm.getAttribute("title") || "").includes("todos:read"); })()',
    5000,
  );
  // Criterion 1: every elevated edge is dotted (1 3) and carries the lock label.
  const elevatedEncoded = await waitFor(
    page,
    '(() => { const locks = document.querySelectorAll("[data-testid=data-edge-lock]").length;' +
      " if (locks === 0) return false;" +
      ' const paths = [...document.querySelectorAll(".react-flow__edge path.react-flow__edge-path")];' +
      ' const dotted = paths.filter((p) => /^1px/.test(getComputedStyle(p).strokeDasharray || "")).length;' +
      " return dotted >= locks; })()",
    5000,
  );
  record(
    viewWritten === true &&
      viewInSnapshot &&
      dataPressed &&
      dataViewRendered &&
      ribbonMounted &&
      countersEqualScan &&
      definerBadge &&
      elevatedEncoded,
    "project graph: data lens ribbon equals the scan, definer badge and elevated dotted+lock render",
    "write=" +
      viewWritten +
      " snapshot=" +
      viewInSnapshot +
      " pressed=" +
      dataPressed +
      " view=" +
      dataViewRendered +
      " ribbon=" +
      ribbonMounted +
      " scan=" +
      countersEqualScan +
      " definer=" +
      definerBadge +
      " elevated=" +
      elevatedEncoded,
  );
  await page.screenshot(ARTIFACTS + "/05e-project-graph-data-lens.png");

  // Criterion 3: selecting a table dims everything outside its FK neighbourhood (undirected,
  // cycle-safe) — the view over the table stays dimmed, the fk-linked table stays bright.
  // Flow-coordinate transforms, not screen rects: a HUD refit moves rects, never nodes.
  const NODE_POS =
    '(() => [...document.querySelectorAll(".react-flow__node")].map((n) => (n.getAttribute("data-id") || n.id) + "@" + n.style.transform).join(","))()';
  const posBeforeSelect = await page.evaluate(NODE_POS);
  const clickedTable = await page.evaluate(
    '(() => { const cards = [...document.querySelectorAll("[data-testid=project-graph-table]")];' +
      ' const target = cards.find((c) => [...c.querySelectorAll("span")].some((s) => s.textContent === "todos"));' +
      ' if (!target) return "NOTFOUND"; target.click(); return "OK"; })()',
  );
  const fkDimmed = await waitFor(
    page,
    '(() => { const cards = [...document.querySelectorAll("[data-testid^=project-graph-]")].filter((n) => n.className.includes("rounded-md"));' +
      " const ops = cards.map((n) => Number(getComputedStyle(n).opacity));" +
      " return ops.some((o) => o <= 0.13) && ops.some((o) => o >= 0.9); })()",
    5000,
  );
  const fkRestriction = await page.evaluate(
    '(() => { const card = (name) => [...document.querySelectorAll("[data-testid=project-graph-table],[data-testid=project-graph-view]")].find((c) => [...c.querySelectorAll("span")].some((s) => s.textContent === name));' +
      ' const view = card("smoke_definer"); const link = card("todo_files");' +
      ' if (!view || !link) return "MISSING";' +
      ' return Number(getComputedStyle(view).opacity) <= 0.13 && Number(getComputedStyle(link).opacity) >= 0.9 ? "OK" : "WRONG"; })()',
  );
  const focusBarShown = await waitFor(
    page,
    'Boolean(document.querySelector("[data-testid=graph-focus-bar]"))',
    5000,
  );
  const posDuringSelect = await page.evaluate(NODE_POS);
  record(
    clickedTable === "OK" &&
      fkDimmed &&
      fkRestriction === "OK" &&
      focusBarShown &&
      posBeforeSelect === posDuringSelect,
    "project graph: table selection dims to the FK neighbourhood, positions held",
    "click=" +
      clickedTable +
      " dim=" +
      fkDimmed +
      " restriction=" +
      fkRestriction +
      " focusBar=" +
      focusBarShown +
      " positionsHeld=" +
      (posBeforeSelect === posDuringSelect),
  );
  await page.evaluate(
    '(() => { const p = document.querySelector(".react-flow__pane"); if (p) p.click(); })()',
  );
  await sleep(300);

  // Criterion 5: the data lens composes with edge isolation and with the contract lens (whose
  // chip exists even though its marks ship in a sibling PR) — one dominant, one secondary at
  // 30%, and no node moves through any of it.
  const posBeforeCompose = await page.evaluate(NODE_POS);
  await page.evaluate(clickTestId("graph-chip-edge-fk"));
  await waitFor(page, pressed("graph-chip-edge-fk") + ' === "true"', 5000);
  const posDuringIsolation = await page.evaluate(NODE_POS);
  await page.evaluate(clickTestId("graph-chip-edge-fk"));
  await waitFor(page, pressed("graph-chip-edge-fk") + ' === "false"', 5000);
  await page.evaluate(clickTestId("graph-chip-lens-contract"));
  const dataSecondary = await waitFor(
    page,
    '(() => { const c = document.querySelector("[data-testid=graph-chip-lens-data]");' +
      ' return c !== null && (c.textContent || "").includes("secondary"); })()',
    5000,
  );
  const marksReceded = await waitFor(
    page,
    '(() => { const m = document.querySelector("[data-testid=data-marks-table]");' +
      " return m !== null && Math.abs(Number(getComputedStyle(m).opacity) - 0.3) < 0.01; })()",
    5000,
  );
  const posStacked = await page.evaluate(NODE_POS);
  record(
    posDuringIsolation === posBeforeCompose &&
      dataSecondary &&
      marksReceded &&
      posStacked === posBeforeCompose,
    "project graph: data lens + isolation + contract stacking hold positions, secondary at 30%",
    "isolationHeld=" +
      (posDuringIsolation === posBeforeCompose) +
      " secondary=" +
      dataSecondary +
      " marks30=" +
      marksReceded +
      " stackHeld=" +
      (posStacked === posBeforeCompose),
  );
  // Reverse the activation order: data becomes dominant again and its marks return to full.
  await page.evaluate(clickTestId("graph-chip-lens-data"));
  await page.evaluate(clickTestId("graph-chip-lens-data"));
  const dataDominant = await waitFor(
    page,
    '(() => { const m = document.querySelector("[data-testid=data-marks-table]");' +
      " return m !== null && Number(getComputedStyle(m).opacity) >= 0.9; })()",
    5000,
  );
  await page.evaluate(clickTestId("graph-chip-lens-contract"));
  await page.evaluate(clickTestId("graph-chip-lens-data"));
  const dataGone = await waitFor(
    page,
    '!document.querySelector("[data-testid=graph-data-ribbon]") && !document.querySelector("[data-testid=data-marks-table]")',
    5000,
  );
  record(
    dataDominant && dataGone,
    "project graph: activation order swaps the role; lens off removes ribbon and marks",
    "dominant=" + dataDominant + " gone=" + dataGone,
  );

  // Restore the default viewport for the remaining panel checks.
  await page.send("Emulation.clearDeviceMetricsOverride", {});
  await sleep(300);

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
        "Boolean(document.querySelector('[data-testid=\"release-batch\"]')) || " +
          "Boolean(document.querySelector('[data-testid=\"release-plan-failed\"]')) || " +
          "Boolean(document.querySelector('[data-testid=\"release-preview-content\"]'))",
        30000,
      ),
      "release: preview rendered after switching lens",
    );
  }
  await page.screenshot(ARTIFACTS + "/06-release-preview.png");
  return { checks };
}
