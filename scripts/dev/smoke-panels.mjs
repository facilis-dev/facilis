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
  // ── Details satellite (issue #59): the inspector body is an in-canvas node anchored beside
  // the card with a dashed connector; Esc closes it; a pin keeps it while another node is
  // selected; below 1200px the same body renders as a bottom sheet. ──
  // The breakpoint reads the editor area, not the window: with the explorer and chat open the
  // canvas is ~750px even at 1920, so emulate a wide viewport to reach satellite mode.
  await setViewport(3200, 1200);
  await sleep(500);
  const anchored = await page.evaluate(
    '(() => { const sat = document.querySelector("[data-testid=project-graph-details]");' +
      ' const card = document.querySelector("[data-testid=project-graph-table]");' +
      " if (!sat || !card) return null;" +
      " const s = sat.getBoundingClientRect(); const c = card.getBoundingClientRect();" +
      ' const side = s.left >= c.right + 8 ? "right" : s.right <= c.left - 8 ? "left" : "overlap";' +
      " const overlapY = Math.min(s.bottom, c.bottom) - Math.max(s.top, c.top);" +
      " return { side, overlapY }; })()",
  );
  record(
    anchored !== null && anchored.side !== "overlap" && anchored.overlapY > 0,
    "project graph: satellite anchored beside the card without overlap",
    JSON.stringify(anchored),
  );
  const connector = await page.evaluate(
    'Boolean(document.querySelector("[data-testid=project-graph-details-link] path"))',
  );
  record(connector, "project graph: satellite connector drawn", String(connector));
  // Focus is trapped inside the satellite, so a real Esc lands on its own handler. The
  // emulated resize above can blur the page, so put focus back inside before the key.
  await page.evaluate(
    '(() => { const s = document.querySelector("[data-testid=project-graph-details]");' +
      ' const b = s && s.querySelector("button"); if (b) b.focus(); })()',
  );
  await pressKey(page, "Escape", "Escape", 27);
  const closedByEsc = await waitFor(
    page,
    '!document.querySelector("[data-testid=project-graph-inspector]")',
    3000,
  );
  record(closedByEsc, "project graph: Esc closes the satellite", String(closedByEsc));
  // Pin keeps the card in place while another node is selected; unpin removes it.
  await page.evaluate(clickTestId("project-graph-table"));
  await waitFor(
    page,
    'Boolean(document.querySelector("[data-testid=project-graph-details]"))',
    3000,
  );
  await page.evaluate(
    '(() => { const b = document.querySelectorAll("[data-testid=project-graph-inspector] button")[1];' +
      " if (b) b.click(); })()",
  );
  const pinnedShown = await waitFor(
    page,
    'Boolean(document.querySelector("[data-testid=project-graph-details-pinned]"))',
    3000,
  );
  // Frame every card so the second selection certainly lands on a rendered node.
  await page.evaluate(clickTestId("graph-hud-fit"));
  await sleep(500);
  await page.evaluate(clickTestId("project-graph-page"));
  const compare = await waitFor(
    page,
    'Boolean(document.querySelector("[data-testid=project-graph-details-pinned]")) && ' +
      'Boolean(document.querySelector("[data-testid=project-graph-details]"))',
    3000,
  );
  record(
    pinnedShown && compare,
    "project graph: pin keeps the card while another node is selected",
    "pinned=" + pinnedShown + " compare=" + compare,
  );
  await page.evaluate(
    '(() => { const p = document.querySelector("[data-testid=project-graph-details-pinned]");' +
      ' if (!p) return; const b = p.querySelectorAll("[data-testid=project-graph-inspector] button")[1];' +
      " if (b) b.click(); })()",
  );
  const unpinned = await waitFor(
    page,
    '!document.querySelector("[data-testid=project-graph-details-pinned]")',
    3000,
  );
  record(unpinned, "project graph: unpin removes the pinned card", String(unpinned));
  await setViewport(1920, 1080);
  await sleep(500);
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
  // (the ribbon keeps the hidden count), a fourth lens is refused with a hint (F.3: one dominant
  // + two secondaries), arrows roam.
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

  // Lenses (F.3): the second and third demote the first to secondary; a fourth is refused with
  // a visible hint — one dominant + two secondaries (epic rule 3).
  await page.evaluate(clickTestId("graph-chip-lens-contract"));
  await waitFor(page, pressed("graph-chip-lens-contract") + ' === "true"', 5000);

  // Contract audit ribbon (issue #69): four filter counters docked in the bottom-left cluster.
  // The demo project has protected routes (tasks/todos permissions) and public ones (file
  // download), so both groups are non-empty. Pressing a counter dims the rest — never removes
  // a card — and rides the gv URL; the lens invariant is the node position, so compare the
  // flow-coordinate transforms, not screen rects (a HUD resize can refit the viewport).
  const auditMounted = await waitFor(
    page,
    'Boolean(document.querySelector("[data-testid=graph-audit-ribbon]"))',
    5000,
  );
  const auditCounters = await page.evaluate(
    'document.querySelectorAll("button[data-testid^=graph-audit-]").length',
  );
  const AUDIT_NODE_POS =
    '(() => [...document.querySelectorAll(".react-flow__node")].map((n) => n.id + "@" + n.style.transform).join(","))()';
  const posBeforeAudit = await page.evaluate(AUDIT_NODE_POS);
  await page.evaluate(clickTestId("graph-audit-protected"));
  const auditPressed = await waitFor(page, pressed("graph-audit-protected") + ' === "true"', 5000);
  const auditDim = await waitFor(
    page,
    '(() => { const cards = [...document.querySelectorAll("[data-testid^=project-graph-]")].filter((n) => n.className.includes("rounded-md"));' +
      " const ops = cards.map((n) => Number(getComputedStyle(n).opacity));" +
      " return ops.some((o) => o <= 0.41) && ops.some((o) => o >= 0.9); })()",
    5000,
  );
  const posDuringAudit = await page.evaluate(AUDIT_NODE_POS);
  const auditInUrl = await waitFor(
    page,
    '(() => { const gv = new URLSearchParams(location.search).get("gv"); if (!gv) return false;' +
      ' try { const v = JSON.parse(gv); return Array.isArray(v.a) && v.a.length === 1 && v.a[0] === "protected"; } catch { return false; } })()',
    5000,
  );
  record(
    auditMounted &&
      auditCounters === 4 &&
      auditPressed &&
      auditDim &&
      auditInUrl &&
      posBeforeAudit === posDuringAudit,
    "project graph: audit ribbon filters by dimming, rides the URL, never moves nodes",
    "mounted=" +
      auditMounted +
      " counters=" +
      auditCounters +
      " pressed=" +
      auditPressed +
      " dim=" +
      auditDim +
      " url=" +
      auditInUrl +
      " positionsHeld=" +
      (posBeforeAudit === posDuringAudit),
  );
  await page.evaluate(clickTestId("graph-audit-protected"));
  const auditCleared = await waitFor(page, pressed("graph-audit-protected") + ' === "false"', 5000);
  const auditAllBright = await waitFor(
    page,
    '(() => { const cards = [...document.querySelectorAll("[data-testid^=project-graph-]")].filter((n) => n.className.includes("rounded-md"));' +
      " return cards.length > 0 && cards.every((n) => Number(getComputedStyle(n).opacity) >= 0.9); })()",
    5000,
  );
  record(
    auditCleared && auditAllBright,
    "project graph: second click clears the audit filter",
    "pressed=" + auditCleared + " allBright=" + auditAllBright,
  );

  await page.evaluate(clickTestId("graph-chip-lens-data"));
  const secondaryMarked = await waitFor(
    page,
    '(() => { const c = document.querySelector("[data-testid=graph-chip-lens-contract]");' +
      ' return c !== null && (c.textContent || "").includes("secondary"); })()',
    5000,
  );
  await page.evaluate(clickTestId("graph-chip-lens-runtime"));
  const thirdAccepted = await waitFor(
    page,
    pressed("graph-chip-lens-runtime") + ' === "true"',
    5000,
  );
  await page.evaluate(clickTestId("graph-chip-lens-agent"));
  const hintShown = await waitFor(
    page,
    'Boolean(document.querySelector("[data-testid=graph-lens-hint]"))',
    5000,
  );
  const agentRefused = await page.evaluate(pressed("graph-chip-lens-agent"));
  record(
    secondaryMarked && thirdAccepted && hintShown && agentRefused === "false",
    "project graph: three lenses active (one dominant, two secondary), fourth refused with a hint",
    "secondary=" +
      secondaryMarked +
      " third=" +
      thirdAccepted +
      " hint=" +
      hintShown +
      " agent=" +
      agentRefused,
  );
  await page.evaluate(clickTestId("graph-chip-lens-runtime"));
  await page.evaluate(clickTestId("graph-chip-lens-data"));
  await page.evaluate(clickTestId("graph-chip-lens-contract"));
  await waitFor(page, pressed("graph-chip-lens-contract") + ' === "false"', 5000);
  const auditGone = await waitFor(
    page,
    '!document.querySelector("[data-testid=graph-audit-ribbon]")',
    5000,
  );
  record(auditGone, "project graph: audit ribbon leaves with the contract lens");
  await page.screenshot(ARTIFACTS + "/05d-project-graph-chips.png");

  // ── Bottom sheet (issue #59): below 1200px the details render as a sheet overlay — never a
  // layout sibling — and the selected node stays visible above it. ──
  await setViewport(1024, 768);
  await sleep(500);
  await page.evaluate(clickTestId("graph-hud-fit"));
  await sleep(500);
  const sheetBefore = await page.evaluate(CANVAS_RECT);
  await page.evaluate(clickTestId("project-graph-table"));
  const sheetShown = await waitFor(
    page,
    'Boolean(document.querySelector("[data-testid=project-graph-details-sheet]"))',
    5000,
  );
  await sleep(500); // let the reveal pan settle before measuring
  const sheetState = await page.evaluate(
    '(() => { const sheet = document.querySelector("[data-testid=project-graph-details-sheet]");' +
      ' const sat = document.querySelector("[data-testid=project-graph-details]");' +
      ' const card = document.querySelector("[data-testid=project-graph-table]");' +
      " if (!sheet || !card) return null;" +
      " const s = sheet.getBoundingClientRect(); const c = card.getBoundingClientRect();" +
      " return { satellite: Boolean(sat), cardClear: c.bottom <= s.top + 2," +
      " handle: Boolean(sheet.querySelector('[role=separator]')) }; })()",
  );
  const sheetAfter = await page.evaluate(CANVAS_RECT);
  const sheetStable =
    sheetBefore !== null &&
    sheetAfter !== null &&
    sheetBefore.x === sheetAfter.x &&
    sheetBefore.y === sheetAfter.y &&
    sheetBefore.w === sheetAfter.w &&
    sheetBefore.h === sheetAfter.h;
  record(
    sheetShown &&
      sheetState !== null &&
      !sheetState.satellite &&
      sheetState.cardClear &&
      sheetState.handle &&
      sheetStable,
    "project graph: narrow viewport renders a bottom sheet that keeps the node visible",
    JSON.stringify({ sheetShown, sheetState, sheetStable }),
  );
  await pressKey(page, "Escape", "Escape", 27);
  const sheetClosed = await waitFor(
    page,
    '!document.querySelector("[data-testid=project-graph-details-sheet]")',
    3000,
  );
  record(sheetClosed, "project graph: Esc closes the bottom sheet", String(sheetClosed));

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

  // ── Runtime lens (issue #72): per-route traffic, errors and latency from the dev-injected
  // client (D-200). The preview is serving (checked above) and same-origin in mode A, so
  // fetches issued INSIDE the preview frame travel through the injected client into the IDE
  // collector; the lens enables that seam with the graph's route templates. /api/todos answers
  // 401 on the example project (a client error, not a server error); a synthetic token-correct
  // batch posted from the preview frame exercises the 5xx error marker. ──
  const NODE_POS =
    '(() => [...document.querySelectorAll(".react-flow__node")].map((n) => n.id + "@" + n.style.transform).join(","))()';
  // The /api/todos card, not the /api/todos/{id} one: exact path, no trailing segment.
  const FIND_TODOS_CARD =
    'const cards = [...document.querySelectorAll("[data-testid=project-graph-route]")];' +
    ' const card = cards.find((c) => { const text = c.textContent || "";' +
    ' return text.includes("/api/todos") && !text.includes("/api/todos/"); }) || null;';
  const posBeforeRuntime = await page.evaluate(NODE_POS);
  await page.evaluate(clickTestId("graph-chip-lens-runtime"));
  const runtimeControls = await waitFor(
    page,
    'Boolean(document.querySelector("[data-testid=graph-runtime-controls]"))',
    5000,
  );
  const runtimeDefaultWindow = await page.evaluate(pressed("graph-runtime-window-5m"));
  const posDuringRuntime = await page.evaluate(NODE_POS);
  record(
    runtimeControls && runtimeDefaultWindow === "true" && posBeforeRuntime === posDuringRuntime,
    "runtime lens: controls dock with the lens (5m default), nodes never move",
    "controls=" +
      runtimeControls +
      " window=" +
      runtimeDefaultWindow +
      " positionsHeld=" +
      (posBeforeRuntime === posDuringRuntime),
  );

  // Live on: counts must appear within 2 s of the traffic and match the #71 buffer exactly.
  // The heat dot's aria-label carries the count at EVERY LOD (the corner dot is the chip-LOD
  // surface, epic rule 4); the inspector's runtime section carries the detailed facts.
  await page.evaluate(clickTestId("graph-runtime-live"));
  const livePressed = await waitFor(page, pressed("graph-runtime-live") + ' === "true"', 5000);
  const trafficSent = await page.evaluate(
    "(async () => { const f = [...document.querySelectorAll('iframe')].find((x) => /preview/.test(x.src || ''));" +
      " if (!f || !f.contentWindow) return 'NOFRAME';" +
      " for (let i = 0; i < 6; i++) { try { await f.contentWindow.fetch('/api/todos'); } catch (e) { return 'FETCHFAIL ' + e; } }" +
      " return 'OK'; })()",
  );
  const DOT_LABEL =
    "(() => { " +
    FIND_TODOS_CARD +
    " const dot = card && card.querySelector('[data-testid=runtime-heat-dot]');" +
    " return dot ? dot.getAttribute('aria-label') : null; })()";
  const heatWithin2s = await waitFor(
    page,
    "(() => { const label = " +
      DOT_LABEL +
      "; return Boolean(label && label.startsWith('6 requests')); })()",
    2000,
  );
  const trafficFacts = await page.evaluate(
    "(() => { const row = (window.__facilis ? window.__facilis.runtimeMetrics.snapshot() : []).find((r) => r.route === '/api/todos');" +
      FIND_TODOS_CARD +
      " const errorDot = card ? card.querySelector('[data-testid=runtime-error-dot]') : null;" +
      " return { buffer: row ? row.count : null, clientErrors: row ? row.clientErrors : null," +
      " errors: row ? row.errors : null, errorDot: Boolean(errorDot) }; })()",
  );
  // The details surface: selecting the route opens the inspector's runtime section.
  await page.evaluate("(() => { " + FIND_TODOS_CARD + " if (card) card.click(); return 'OK'; })()");
  const detailsCount = await waitFor(
    page,
    "(() => { const el = document.querySelector('[data-testid=runtime-stat-count]'); return el ? el.textContent : null; })() === '6'",
    5000,
  );
  const detailsFacts = await page.evaluate(
    "(() => { const spark = document.querySelectorAll('[data-testid=runtime-sparkline] rect').length;" +
      " const p50 = document.querySelector('[data-testid=runtime-stat-p50]');" +
      " const rate = document.querySelector('[data-testid=runtime-stat-error-rate]');" +
      " return { spark, p50: p50 ? p50.textContent : null, rate: rate ? rate.textContent : null }; })()",
  );
  record(
    trafficSent === "OK" &&
      livePressed &&
      heatWithin2s &&
      trafficFacts.buffer === 6 &&
      trafficFacts.clientErrors === 6 &&
      trafficFacts.errors === 0 &&
      !trafficFacts.errorDot &&
      detailsCount &&
      detailsFacts.spark === 60 &&
      detailsFacts.p50 !== null &&
      detailsFacts.rate === "0%",
    "runtime lens: live traffic within 2 s matches the #71 buffer (dot + details, 401 not an error)",
    "sent=" +
      trafficSent +
      " live=" +
      livePressed +
      " heat2s=" +
      heatWithin2s +
      " facts=" +
      JSON.stringify(trafficFacts) +
      " details=" +
      JSON.stringify(detailsFacts),
  );
  await page.evaluate(
    '(() => { const b = document.querySelector("[data-testid=project-graph-inspector] button"); if (b) b.click(); })()',
  );
  await sleep(200);

  // A 5xx sample with the correct boot token, posted from the preview frame like a real client
  // batch. If the frame path does not land, the IDE window posts it (mode A trusts the same
  // origin either way); the detail names which path delivered it.
  const ERRORS_NOW =
    "(() => { const row = (window.__facilis ? window.__facilis.runtimeMetrics.snapshot() : []).find((r) => r.route === '/api/todos');" +
    " return row ? row.errors : null; })()";
  const syntheticSent = await page.evaluate(
    "(() => { const ide = window.__ide; if (!ide || !ide.bridge) return 'NOIDE';" +
      " const m = /[?&]__vv_kernel=([^&#]+)/.exec(ide.bridge.sameOriginPreviewUrl(0, '/')); if (!m) return 'NOTOKEN';" +
      " const f = [...document.querySelectorAll('iframe')].find((x) => /preview/.test(x.src || ''));" +
      " if (!f || !f.contentWindow) return 'NOFRAME';" +
      " const payload = JSON.stringify({ source: 'vv-metrics', type: 'batch', token: decodeURIComponent(m[1])," +
      " samples: [{ route: '/api/todos', method: 'GET', status: 503, duration: 12 }] });" +
      // eval INSIDE the preview frame so event.source is the preview window, like a real batch.
      " f.contentWindow.eval('parent.postMessage(' + JSON.stringify(payload) + ', location.origin)');" +
      " return 'OK'; })()",
  );
  await sleep(400);
  let syntheticPath = "preview";
  let errorsNow = await page.evaluate(ERRORS_NOW);
  if (errorsNow === 0) {
    syntheticPath = "ide";
    await page.evaluate(
      "(() => { const ide = window.__ide; if (!ide || !ide.bridge) return 'NOIDE';" +
        " const m = /[?&]__vv_kernel=([^&#]+)/.exec(ide.bridge.sameOriginPreviewUrl(0, '/')); if (!m) return 'NOTOKEN';" +
        " const payload = JSON.stringify({ source: 'vv-metrics', type: 'batch', token: decodeURIComponent(m[1])," +
        " samples: [{ route: '/api/todos', method: 'GET', status: 503, duration: 12 }] });" +
        " window.postMessage(JSON.parse(payload), location.origin); return 'OK'; })()",
    );
    await sleep(400);
    errorsNow = await page.evaluate(ERRORS_NOW);
  }
  const errorDotShown = await waitFor(
    page,
    "(() => { " +
      FIND_TODOS_CARD +
      " return Boolean(card && card.querySelector('[data-testid=runtime-error-dot]')); })()",
    2000,
  );
  const errorLabel = await page.evaluate(DOT_LABEL);
  record(
    syntheticSent === "OK" &&
      errorDotShown &&
      errorsNow === 1 &&
      Boolean(errorLabel && errorLabel.startsWith("7 requests")),
    "runtime lens: a 5xx batch raises the error marker and the buffer agrees",
    "sent=" +
      syntheticSent +
      " path=" +
      syntheticPath +
      " dot=" +
      errorDotShown +
      " errors=" +
      errorsNow +
      " label=" +
      errorLabel,
  );

  // Detailed LOD: wheel-zoom centred ON the todos card (it stays on screen under
  // onlyRenderVisibleElements) until the count badge appears above RUNTIME_COMPACT_ZOOM.
  const VIEWPORT_ZOOM =
    '(() => { const v = document.querySelector(".react-flow__viewport"); if (!v) return null;' +
    ' const m = /scale[(]([^)]+)[)]/.exec(v.style.transform || ""); return m ? Number(m[1]) : null; })()';
  const cardPoint = await page.evaluate(
    "(() => { " +
      FIND_TODOS_CARD +
      " if (!card) return null; const r = card.getBoundingClientRect();" +
      " return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()",
  );
  const zoomTrace = [];
  for (let i = 0; i < 14 && cardPoint !== null; i += 1) {
    const zoom = await page.evaluate(VIEWPORT_ZOOM);
    zoomTrace.push(zoom);
    if (zoom !== null && zoom >= 0.6) break;
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: cardPoint.x,
      y: cardPoint.y,
      deltaX: 0,
      deltaY: -240,
    });
    await sleep(200);
  }
  const detailedZoom = await page.evaluate(VIEWPORT_ZOOM);
  const detailedBadge = await page.evaluate(
    "(() => { " +
      FIND_TODOS_CARD +
      " const badge = card && card.querySelector('[data-testid=runtime-count]');" +
      " const row = (window.__facilis ? window.__facilis.runtimeMetrics.snapshot() : []).find((r) => r.route === '/api/todos');" +
      " return { badge: badge ? badge.textContent : null, buffer: row ? row.count : null }; })()",
  );
  record(
    detailedZoom !== null &&
      detailedZoom >= 0.55 &&
      detailedBadge.badge === "7" &&
      detailedBadge.buffer === 7,
    "runtime lens: detailed count badge above the zoom threshold matches the buffer",
    "zoom=" +
      detailedZoom +
      " trace=" +
      JSON.stringify(zoomTrace) +
      " badge=" +
      JSON.stringify(detailedBadge),
  );

  // Window switch rides the gv URL parameter (the whole view round-trips, epic rule 6).
  await page.evaluate(clickTestId("graph-runtime-window-1m"));
  const windowSwitched = await waitFor(
    page,
    pressed("graph-runtime-window-1m") + ' === "true"',
    5000,
  );
  const windowInUrl = await waitFor(
    page,
    '(() => { const gv = new URLSearchParams(location.search).get("gv"); if (!gv) return false;' +
      ' try { const v = JSON.parse(gv); return v.rw === "1m" && v.rl === true && Array.isArray(v.l) && v.l.includes("runtime"); } catch { return false; } })()',
    5000,
  );
  record(
    windowSwitched && windowInUrl,
    "runtime lens: window switch rides the gv URL state",
    "pressed=" + windowSwitched + " url=" + windowInUrl,
  );

  // Live off freezes the surface on the last snapshot; a user action (window change) reads
  // the accumulated history again. The client flushes every 1 s, so 2.5 s covers the batch.
  await page.evaluate(clickTestId("graph-runtime-live"));
  const liveOff = await waitFor(page, pressed("graph-runtime-live") + ' === "false"', 5000);
  await page.evaluate(
    "(async () => { const f = [...document.querySelectorAll('iframe')].find((x) => /preview/.test(x.src || ''));" +
      " if (f && f.contentWindow) { for (let i = 0; i < 3; i++) { try { await f.contentWindow.fetch('/api/todos'); } catch { /* the buffer counts it */ } } }" +
      " return 'OK'; })()",
  );
  await sleep(2500);
  // The dot's aria-label is the frozen surface: live off must not push the new count into it.
  const frozenLabel = await page.evaluate(DOT_LABEL);
  await page.evaluate(clickTestId("graph-runtime-window-5m"));
  const caughtUp = await waitFor(
    page,
    "(() => { const label = " +
      DOT_LABEL +
      "; return Boolean(label && label.startsWith('10 requests')); })()",
    5000,
  );
  const frozenBuffer = await page.evaluate(
    "(() => { const row = (window.__facilis ? window.__facilis.runtimeMetrics.snapshot() : []).find((r) => r.route === '/api/todos');" +
      " return row ? row.count : null; })()",
  );
  record(
    liveOff &&
      Boolean(frozenLabel && frozenLabel.startsWith("7 requests")) &&
      caughtUp &&
      frozenBuffer === 10,
    "runtime lens: live off freezes the surface; a window change reads the last snapshot",
    "liveOff=" +
      liveOff +
      " frozen=" +
      frozenLabel +
      " caughtUp=" +
      caughtUp +
      " buffer=" +
      frozenBuffer,
  );

  // The full lens state (lens + window + live) round-trips through gv; then the lens leaves.
  await page.evaluate(clickTestId("graph-runtime-window-15m"));
  await page.evaluate(clickTestId("graph-runtime-live"));
  const fullStateInUrl = await waitFor(
    page,
    '(() => { const gv = new URLSearchParams(location.search).get("gv"); if (!gv) return false;' +
      ' try { const v = JSON.parse(gv); return v.rw === "15m" && v.rl === true && Array.isArray(v.l) && v.l[0] === "runtime"; } catch { return false; } })()',
    5000,
  );
  record(
    fullStateInUrl,
    "runtime lens: window + live + lens round-trip through gv",
    "url=" + fullStateInUrl,
  );
  await page.screenshot(ARTIFACTS + "/05e-project-graph-runtime.png");
  await page.evaluate(clickTestId("graph-chip-lens-runtime"));
  const runtimeGone = await waitFor(
    page,
    '!document.querySelector("[data-testid=graph-runtime-controls]") && !document.querySelector("[data-testid=runtime-marks-route]")',
    5000,
  );
  record(
    runtimeGone,
    "runtime lens: controls and marks leave with the lens",
    "gone=" + runtimeGone,
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
