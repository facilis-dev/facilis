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

// A canvas that exists but has no area, or draws nothing, is the blank-canvas regression this
// gate exists to catch (#182). Measure the surface root and its inner canvas, and sample the
// painted pixels against the canvas background: a passed check means a human would SEE a graph.
const GRAPH_SNAPSHOT = `(() => {
  const root = document.querySelector('[data-testid="project-graph-canvas"]');
  const panel = document.querySelector('[data-testid="project-graph-panel"]');
  const canvas = root ? root.querySelector('canvas') : null;
  const box = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  };
  let painted = -1;
  let pixels = null;
  let background = null;
  if (canvas && canvas.width > 0 && canvas.height > 0) {
    try {
      const ctx = canvas.getContext('2d');
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = image.data;
      background = [data[0], data[1], data[2], data[3]];
      let count = 0;
      // Sample every 4th pixel on a small panel: enough evidence of a frame, cheap enough to
      // run on every poll while the analysis loads.
      for (let index = 0; index < data.length; index += 16) {
        if (
          Math.abs(data[index] - background[0]) > 10 ||
          Math.abs(data[index + 1] - background[1]) > 10 ||
          Math.abs(data[index + 2] - background[2]) > 10
        ) count += 1;
      }
      painted = count;
      pixels = { width: canvas.width, height: canvas.height, sampled: Math.ceil(data.length / 16) };
    } catch (error) {
      painted = -2;
      background = String(error && error.message ? error.message : error);
    }
  }
  return JSON.stringify({
    panel: panel !== null,
    root: root !== null,
    rootBox: box(root),
    canvasBox: box(canvas),
    canvasPixels: pixels,
    painted,
    background,
    mode: root ? root.getAttribute('data-graph-mode') : null,
    domain: root ? root.getAttribute('data-graph-domain') : null,
    columns: root ? root.getAttribute('data-graph-columns') : null,
    camera: root ? root.getAttribute('data-graph-camera') : null,
    selectedY: root ? root.getAttribute('data-graph-selected-y') : null,
    selectedRect: root ? root.getAttribute('data-graph-selected-rect') : null,
    bounds: root ? root.getAttribute('data-graph-bounds') : null,
    content: root ? root.getAttribute('data-graph-content') : null,
    hudTop: root ? root.getAttribute('data-graph-hud-top') : null,
    nodeLists: document.querySelectorAll('[data-testid="project-graph-node-list"]').length,
    testIds: document.querySelectorAll('[data-testid^="project-graph-"]').length,
    canScrollX: document.documentElement.scrollWidth > window.innerWidth + 1,
    text: panel ? (panel.innerText || '').slice(-240) : '',
  });
})()`;

async function graphSnapshot(page) {
  return JSON.parse(await page.evaluate(GRAPH_SNAPSHOT));
}

// The HUD is DOM (breadcrumb + lens switcher), the graph is canvas: measure both against the same
// surface root and prove numerically that content and selection stay outside the HUD rows (#144).
const HUD_RECTS = `(() => {
  const root = document.querySelector('[data-testid="project-graph-canvas"]');
  if (!root) return JSON.stringify(null);
  const base = root.getBoundingClientRect();
  const parts = ['project-graph-breadcrumb', 'project-graph-lens-bar']
    .map((id) => {
      const element = document.querySelector('[data-testid="' + id + '"]');
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { id, x: rect.x - base.x, y: rect.y - base.y, w: rect.width, h: rect.height };
    })
    .filter(Boolean);
  if (parts.length === 0) return JSON.stringify(null);
  const left = Math.min(...parts.map((part) => part.x));
  const right = Math.max(...parts.map((part) => part.x + part.w));
  const top = Math.min(...parts.map((part) => part.y));
  const bottom = Math.max(...parts.map((part) => part.y + part.h));
  return JSON.stringify({ parts, union: { x: left, y: top, w: right - left, h: bottom - top } });
})()`;

const parseRect = (value) => {
  const [x, y, w, h] = value ? value.split(",").map(Number) : [];
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h)
    ? { x, y, w, h }
    : null;
};
const rectsIntersect = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The DOM HUD union plus the canvas data attributes of the content box / bounds / selection. */
async function hudOverlap(page) {
  const hud = JSON.parse(await page.evaluate(HUD_RECTS));
  const state = await graphSnapshot(page);
  return {
    hud,
    state,
    content: parseRect(state.content),
    bounds: parseRect(state.bounds),
    selected: parseRect(state.selectedRect),
  };
}

/** 390x844 with touch, the issue #191 acceptance viewport. */
async function emulatePhone(page, mobile) {
  if (mobile) {
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    return;
  }
  // Restore the desktop viewport smoke-ide pinned at boot: clearing the override would drop
  // headless Chrome back to 800x600, which is the narrow shell (< 1024px, #195).
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: false });
}

/** One-finger drag through CDP touch events; the canvas reacts through real PointerEvents. */
async function touchDrag(page, from, to, steps = 10) {
  const point = (x, y) => ({
    x: Math.round(x),
    y: Math.round(y),
    radiusX: 2,
    radiusY: 2,
    force: 1,
    id: 1,
  });
  await page.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(from.x, from.y)],
  });
  for (let step = 1; step <= steps; step += 1) {
    await sleep(16);
    const x = from.x + ((to.x - from.x) * step) / steps;
    const y = from.y + ((to.y - from.y) * step) / steps;
    await page.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(x, y)],
    });
  }
  await sleep(80);
  await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const OVERVIEW_CLICK =
  "(() => { const back = document.querySelector('[data-testid=\"project-graph-overview\"]');" +
  " if (back && back.tagName === 'BUTTON') back.click(); return true; })()";

// The no-reflow reference must be a domain that really has several lanes. The a11y list groups
// the overview by domain, so pick a node in the group with the most lane kinds: clicking it
// drills into that domain and opens the inspector, exactly like a canvas click.
const PICK_RICHEST = `(() => {
  const groups = [...document.querySelectorAll('[data-testid="project-graph-node-list"] [role="group"]')];
  const LANE = { 'project-graph-page': 'page', 'project-graph-route': 'route', 'project-graph-table': 'data', 'project-graph-view': 'data', 'project-graph-workflow': 'workflow' };
  let best = null;
  for (const group of groups) {
    const buttons = [...group.querySelectorAll('button[data-testid^="project-graph-"]')];
    const lanes = new Set(buttons.map((button) => LANE[button.getAttribute('data-testid')] ?? button.getAttribute('data-testid')));
    const heading = group.querySelector('h2');
    const candidate = { domain: heading ? heading.textContent : '', lanes: lanes.size, group };
    if (candidate.lanes < 2) continue;
    if (best === null || candidate.lanes > best.lanes) best = candidate;
  }
  if (best === null) return JSON.stringify({ domain: null, lanes: 0, clicked: 'NONE' });
  const button = best.group.querySelector('button[data-testid="project-graph-page"]') || best.group.querySelector('button');
  button.click();
  return JSON.stringify({ domain: best.domain, lanes: best.lanes, clicked: button.getAttribute('data-testid') });
})()`;

async function pickRichestNode(page) {
  return JSON.parse(await page.evaluate(PICK_RICHEST));
}

async function drawerState(page) {
  return JSON.parse(
    await page.evaluate(
      "(() => { const d = document.querySelector('[data-testid=\"project-graph-drawer\"]');" +
        " const r = d ? d.getBoundingClientRect() : null;" +
        " return JSON.stringify({ layout: d ? d.getAttribute('data-layout') : null," +
        " rect: r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null," +
        " overflowX: document.documentElement.scrollWidth - window.innerWidth," +
        " viewport: { width: window.innerWidth, height: window.innerHeight } }); })()",
    ),
  );
}

// Poll until the surface paints something, logging every state transition: the failure mode
// we chase is "DOM mounted, canvas blank", so the log must show geometry and pixel counts.
async function waitForGraphState(page, predicate, limitMs) {
  const until = Date.now() + limitMs;
  let snapshot = await graphSnapshot(page);
  while (Date.now() < until) {
    if (predicate(snapshot)) return snapshot;
    await sleep(250);
    snapshot = await graphSnapshot(page);
  }
  return snapshot;
}

async function waitForPaintedGraph(page, limitMs) {
  const until = Date.now() + limitMs;
  let previous = "";
  let snapshot = await graphSnapshot(page);
  while (Date.now() < until) {
    const next = JSON.stringify(snapshot);
    if (next !== previous) {
      console.log("graph surface: " + next);
      previous = next;
    }
    if (snapshot.root && snapshot.painted > 0) return snapshot;
    await sleep(2000);
    snapshot = await graphSnapshot(page);
  }
  return snapshot;
}

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
  const surface = await waitForPaintedGraph(page, 240000);
  record(
    surface.root,
    "project graph: analyzer result rendered",
    surface.root ? "" : JSON.stringify(surface).slice(0, 400),
  );
  record(
    surface.root !== null && surface.rootBox.width >= 200 && surface.rootBox.height >= 160,
    "project graph: canvas has a usable area",
    surface.root === null ? "NO SURFACE" : JSON.stringify(surface.rootBox),
  );
  record(
    surface.painted > 0,
    "project graph: canvas painted",
    JSON.stringify({
      painted: surface.painted,
      canvasBox: surface.canvasBox,
      pixels: surface.canvasPixels,
      background: surface.background,
    }),
  );
  record(
    surface.nodeLists > 0 && surface.testIds > 0,
    "project graph: accessible node list rendered",
    JSON.stringify({ nodeLists: surface.nodeLists, testIds: surface.testIds }),
  );
  // The old #144 class: a HUD overlay on top of a domain card. Compare the measured DOM HUD union
  // with the scene bounds (every drawn card is inside it) and with the reserved content box.
  const overviewHud = await hudOverlap(page);
  record(
    overviewHud.hud !== null &&
      overviewHud.content !== null &&
      overviewHud.bounds !== null &&
      !rectsIntersect(overviewHud.bounds, overviewHud.hud.union) &&
      overviewHud.bounds.y >= overviewHud.hud.union.y + overviewHud.hud.union.h - 1,
    "project graph: HUD never covers a domain card",
    JSON.stringify({
      hud: overviewHud.hud === null ? null : overviewHud.hud.union,
      content: overviewHud.content,
      bounds: overviewHud.bounds,
    }),
  );
  record(
    await waitFor(page, COUNT('[data-testid="project-graph-table"]') + " > 0", 15000),
    "project graph: tables rendered",
  );
  record(
    await waitFor(page, COUNT('[data-testid="project-graph-route"]') + " > 0", 15000),
    "project graph: routes rendered",
  );
  record(
    await waitFor(page, COUNT('[data-testid="project-graph-page"]') + " > 0", 15000),
    "project graph: pages rendered",
  );
  await page.screenshot(ARTIFACTS + "/05b-project-graph.png");

  // ── Prerender diagnostics (D-202, issue #84): the page inspector carries the toggle and
  // the analyzer's eligibility chips. Every todo-app page is auth-guarded, dynamic or a
  // redirect, so the toggle must stay disabled with the blocking reason named (fail closed). ──
  record(
    (await page.evaluate(clickTestId("project-graph-page"))) === "OK",
    "prerender: page node selected",
  );
  const prerenderToggle = await waitFor(
    page,
    "Boolean(document.querySelector('[data-testid=\"project-graph-prerender-toggle\"]'))",
    15000,
  );
  record(prerenderToggle, "prerender: toggle mounted in the page inspector");
  const prerenderState = await page.evaluate(
    "(() => { const t = document.querySelector('[data-testid=\"project-graph-prerender-toggle\"]');" +
      " const chips = document.querySelector('[data-testid=\"project-graph-prerender-chips\"]');" +
      " return JSON.stringify({ disabled: t ? t.disabled : null," +
      " checked: t ? t.getAttribute('aria-checked') : null," +
      " chips: chips ? chips.innerText : '' }); })()",
  );
  let prerenderBlocked = false;
  try {
    const state = JSON.parse(prerenderState);
    prerenderBlocked =
      state.disabled === true && state.checked === "false" && state.chips.length > 0;
  } catch {
    /* the detail below reports the raw state */
  }
  record(
    prerenderBlocked,
    "prerender: ineligible page blocks the toggle with its reason",
    prerenderState,
  );
  // Centre-on-node must keep the selected card fully below the HUD rows (#144).
  await waitForGraphState(
    page,
    (state) => state.mode === "detail" && state.selectedRect !== null && state.selectedRect !== "",
    5000,
  );
  const detailHud = await hudOverlap(page);
  record(
    detailHud.hud !== null &&
      detailHud.selected !== null &&
      !rectsIntersect(detailHud.selected, detailHud.hud.union),
    "prerender: selected node is not covered by the HUD",
    JSON.stringify({
      selected: detailHud.selected,
      hud: detailHud.hud === null ? null : detailHud.hud.union,
    }),
  );
  await page.screenshot(ARTIFACTS + "/05c-prerender-inspector.png");

  // Desktop reference for the no-reflow assertion: the same multi-lane detail domain must keep
  // its swimlane count on a phone, because the layout is screen-size independent by design.
  await page.evaluate(OVERVIEW_CLICK);
  await waitForGraphState(page, (state) => state.mode === "overview", 5000);
  const desktopPick = await pickRichestNode(page);
  const desktopDetail = await waitForGraphState(
    page,
    (state) => state.mode === "detail" && state.domain === desktopPick.domain,
    15000,
  );
  console.log("desktop detail: " + JSON.stringify({ desktopPick, desktopDetail }));

  // ── Mobile acceptance (issue #191): 390x844 with emulated touch. The hard requirement is
  // that the phone keeps the spatial layout and the drawer becomes a bottom sheet — the graph
  // must never reflow the swimlanes into one column. ──
  await emulatePhone(page, true);
  await sleep(1000);
  // The narrow shell can land on Preview when the viewport shrinks, and a late preview status
  // can re-open it: collapse it until the Code surface sticks, then re-open the graph tab.
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.evaluate("window.__ide.togglePreview(false)");
    await sleep(300);
    if (await page.evaluate("window.__ide.getSnapshot().previewCollapsed")) break;
  }
  await page.evaluate("window.__ide.openProjectGraph()");
  await waitFor(
    page,
    "Boolean(document.querySelector('[data-testid=\"project-graph-canvas\"] canvas'))",
    15000,
  );
  await sleep(500);
  await page.evaluate(OVERVIEW_CLICK);
  const mobileOverview = await waitForGraphState(
    page,
    (state) => state.mode === "overview" && state.painted > 0,
    15000,
  );
  console.log("mobile overview: " + JSON.stringify(mobileOverview));
  record(
    mobileOverview.root !== null &&
      mobileOverview.rootBox.width >= 120 &&
      mobileOverview.rootBox.height >= 240,
    "mobile: graph canvas has area at 390x844",
    mobileOverview.root === null ? "NO SURFACE" : JSON.stringify(mobileOverview.rootBox),
  );
  record(
    mobileOverview.root !== null &&
      mobileOverview.painted > 0 &&
      mobileOverview.canvasPixels !== null,
    "mobile: graph canvas painted at 390x844",
    JSON.stringify({
      painted: mobileOverview.painted,
      pixels: mobileOverview.canvasPixels,
    }),
  );
  record(
    mobileOverview.mode === "overview" && Number(mobileOverview.columns) >= 2,
    "mobile: overview keeps its domain grid",
    JSON.stringify({ mode: mobileOverview.mode, columns: mobileOverview.columns }),
  );
  const cameraBefore = mobileOverview.camera;
  // The mobile IDE can clip the panel against a sibling pane: hit-test a point that the canvas
  // actually owns instead of assuming its geometric centre is reachable.
  const panStart = await page.evaluate(
    "(() => { const canvas = document.querySelector('[data-testid=\"project-graph-canvas\"] canvas');" +
      " if (!canvas) return null; const rect = canvas.getBoundingClientRect();" +
      " const maxX = Math.min(rect.right, window.innerWidth) - 20;" +
      " const maxY = Math.min(rect.bottom, window.innerHeight) - 20;" +
      " for (let y = Math.max(20, Math.min(rect.top, window.innerHeight) + 20); y < maxY; y += 20) {" +
      " for (let x = Math.max(20, Math.min(rect.left, window.innerWidth) + 20); x < maxX; x += 20) {" +
      " if (document.elementFromPoint(x, y) === canvas) return { x, y }; } }" +
      " return null; })()",
  );
  if (panStart !== null) {
    await touchDrag(page, panStart, { x: panStart.x + 70, y: panStart.y + 45 });
  }
  const box = panStart;
  const panned = await waitForGraphState(
    page,
    (state) => state.camera !== null && state.camera !== cameraBefore,
    5000,
  );
  record(
    box !== null && panned.camera !== cameraBefore,
    "mobile: one-finger drag pans the camera",
    JSON.stringify({ before: cameraBefore, after: panned.camera }),
  );
  await page.screenshot(ARTIFACTS + "/05d-mobile-overview.png");

  const mobilePick = await pickRichestNode(page);
  const mobileDetail = await waitForGraphState(
    page,
    (state) => state.mode === "detail" && state.domain === mobilePick.domain,
    15000,
  );
  const drawer = await drawerState(page);
  console.log("mobile detail: " + JSON.stringify({ mobileDetail, drawer }));
  record(
    mobilePick.domain !== null && mobileDetail.mode === "detail",
    "mobile: a node opens the detail view",
    JSON.stringify({ pick: mobilePick, mode: mobileDetail.mode, domain: mobileDetail.domain }),
  );
  record(
    mobileDetail.mode === "detail" &&
      desktopDetail.mode === "detail" &&
      Number(mobileDetail.columns) >= 2 &&
      mobilePick.domain === desktopPick.domain &&
      mobileDetail.columns === desktopDetail.columns,
    "mobile: detail swimlanes keep their columns",
    JSON.stringify({
      mobile: mobileDetail.columns,
      desktop: desktopDetail.columns,
      domain: mobileDetail.domain,
      picked: mobilePick.domain,
    }),
  );
  const nodeAboveSheet =
    drawer.rect !== null &&
    mobileDetail.rootBox !== null &&
    mobileDetail.selectedY !== null &&
    mobileDetail.selectedY !== "" &&
    mobileDetail.rootBox.y + Number(mobileDetail.selectedY) < drawer.rect.y;
  record(
    drawer.layout === "sheet" && nodeAboveSheet,
    "mobile: drawer opens as a bottom sheet with the node above it",
    JSON.stringify({
      layout: drawer.layout,
      drawerTop: drawer.rect === null ? null : drawer.rect.y,
      nodeY:
        mobileDetail.rootBox === null || !mobileDetail.selectedY
          ? null
          : Math.round(mobileDetail.rootBox.y + Number(mobileDetail.selectedY)),
    }),
  );
  record(
    drawer.overflowX <= 1,
    "mobile: no horizontal overflow",
    JSON.stringify({ overflowX: drawer.overflowX, viewport: drawer.viewport }),
  );
  await page.screenshot(ARTIFACTS + "/05e-mobile-detail.png");
  // Leave the narrow shell on Preview before restoring the desktop viewport: the Data Explorer
  // probes below read the preview frame, which the Code surface unmounts.
  await page.evaluate(
    "document.querySelectorAll('[data-slot=\"mobile-shell-nav\"] button')[2].click()",
  );
  await sleep(300);
  // The palette and the lens chips are the two mobile entry points into the lenses (issue
  // #204): neither may disappear when the drawer is a bottom sheet.
  await page.evaluate("window.__ide.openPalette('command')");
  record(
    await waitFor(page, COUNT('[data-slot="command-item"]') + " > 0", 5000),
    "mobile: the palette stays reachable",
  );
  await page.evaluate("window.__ide.closePalette()");
  record(
    await waitFor(page, "!document.querySelector('[data-slot=\"command-item\"]')", 5000),
    "mobile: the palette closes again",
  );
  record(
    await waitFor(
      page,
      "Boolean(document.querySelector('[data-testid=\"project-graph-lens-security\"]'))",
      5000,
    ),
    "mobile: lens chips stay reachable",
  );
  await emulatePhone(page, false);
  await sleep(500);
  const backToDesktop = await page.evaluate("window.innerWidth");
  record(
    backToDesktop > 700,
    "mobile: emulation reset for the remaining checks",
    "innerWidth=" + backToDesktop,
  );

  // ── Lens palette (epic #196, #204): the registry-backed commands reach the same selectLens
  // the chips use, and a chip's tooltip teaches the picker chord. ──
  await page.evaluate("window.__ide.openPalette('command')");
  record(
    await waitFor(page, COUNT('[data-slot="command-item"]') + " > 0", 5000),
    "lens palette: commands listed",
  );
  const lensItem = await page.evaluate(
    "(() => { const items = [...document.querySelectorAll('[data-slot=\"command-item\"]')];" +
      " const item = items.find((el) => (el.innerText || '').startsWith('Lens:'));" +
      " return item ? item.innerText.replace(/\\s+/g, ' ').trim() : 'NO LENS ITEM'; })()",
  );
  record(lensItem.startsWith("Lens: Q5"), "lens palette: registry lens listed", lensItem);
  const lensClicked = await page.evaluate(
    "(() => { const items = [...document.querySelectorAll('[data-slot=\"command-item\"]')];" +
      " const item = items.find((el) => (el.innerText || '').startsWith('Lens:'));" +
      " if (!item) return 'NO LENS ITEM'; item.click(); return 'OK'; })()",
  );
  record(lensClicked === "OK", "lens palette: command clicked", lensClicked);
  record(
    await waitFor(
      page,
      "(() => { const c = document.querySelector('[data-testid=\"project-graph-lens-security\"]');" +
        " return c !== null && c.getAttribute('aria-pressed') === 'true'; })()",
      15000,
    ),
    "lens palette: command activates the lens",
  );
  const chipHint = await page.evaluate(
    "(() => { const c = document.querySelector('[data-testid=\"project-graph-lens-security\"]');" +
      " return c === null ? '' : (c.getAttribute('title') || '') + '|' + (c.getAttribute('aria-label') || ''); })()",
  );
  // The chip teaches the picker chord in the platform's own spelling (issue #223): the
  // registry formats it, so the assertion has to follow the platform the browser reports
  // rather than assume the macOS glyphs.
  const lensChord = await page.evaluate(
    "/mac|iphone|ipad/i.test(navigator.platform) ? '⌘⇧L' : 'Ctrl+Shift+L'",
  );
  record(chipHint.includes(lensChord), "lens bar: chip teaches the picker chord", chipHint);
  await page.screenshot(ARTIFACTS + "/05f-lens-palette.png");
  // The palette closes before the next command: wait out its exit animation so the following
  // open is not queued behind a closing dialog.
  record(
    await waitFor(page, COUNT('[data-slot="command-item"]') + " === 0", 5000),
    "lens palette: closes after the command",
  );
  await sleep(300);

  // Running the active lens's command again turns it off: the command is the chip's toggle.
  await page.evaluate("window.__ide.openPalette('command')");
  await waitFor(page, COUNT('[data-slot="command-item"]') + " > 0", 5000);
  const toggledOff = await page.evaluate(
    "(() => { const items = [...document.querySelectorAll('[data-slot=\"command-item\"]')];" +
      " const item = items.find((el) => (el.innerText || '').startsWith('Lens:'));" +
      " if (!item) return 'NO LENS ITEM'; item.click(); return 'OK'; })()",
  );
  record(
    toggledOff === "OK" &&
      (await waitFor(
        page,
        "(() => { const c = document.querySelector('[data-testid=\"project-graph-lens-security\"]');" +
          " return c !== null && c.getAttribute('aria-pressed') === 'false'; })()",
        15000,
      )),
    "lens palette: running the active command turns the lens off",
  );
  record(
    await waitFor(page, COUNT('[data-slot="command-item"]') + " === 0", 5000),
    "lens palette: closes after the toggle",
  );
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
  // The prerender surface (issue #84) shows even when the schema/API diff is empty.
  const prerenderSection = await waitFor(
    page,
    "Boolean(document.querySelector('[data-testid=\"release-prerender-section\"]'))",
    30000,
  );
  record(prerenderSection, "release: prerender surface section rendered");
  const prerenderRows = await page.evaluate(
    "(() => { const s = document.querySelector('[data-testid=\"release-prerender-section\"]');" +
      " return s ? (s.innerText || '').slice(0, 300) : 'NO SECTION'; })()",
  );
  record(
    prerenderSection && prerenderRows.includes("client"),
    "release: per-page render modes listed",
    prerenderRows,
  );
  await page.screenshot(ARTIFACTS + "/06-release-preview.png");
  return { checks };
}
