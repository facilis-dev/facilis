// Issue #57 acceptance, driven through the same CDP page as the rest of the smoke: the
// full-bleed canvas owns the tab, selection never resizes it, zen hides the HUD and Esc
// restores it, and the stats counters filter with aria-pressed. Viewports are pinned with
// Emulation.setDeviceMetricsOverride and restored afterwards so the checks are deterministic.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(page, expression, limitMs) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    if (await page.evaluate(expression)) return true;
    await sleep(250);
  }
  return false;
}

async function pressEscape(page) {
  const shape = { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 };
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...shape });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...shape });
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

// Panel and canvas boxes plus their area ratio, measured in the page (no layout assumptions).
const MEASURE =
  "(() => {" +
  " const panel = document.querySelector('[data-testid=\"project-graph-panel\"]');" +
  " const canvas = document.querySelector('[data-testid=\"project-graph-canvas\"]');" +
  " if (!panel || !canvas) return null;" +
  " const p = panel.getBoundingClientRect(); const c = canvas.getBoundingClientRect();" +
  " if (p.width < 2 || p.height < 2) return null;" +
  " return { panel: { w: p.width, h: p.height }," +
  " canvas: { x: c.x, y: c.y, w: c.width, h: c.height }," +
  " ratio: (c.width * c.height) / (p.width * p.height) }; })()";

const INSPECTOR = '[data-testid="project-graph-inspector"]';
const HUD_TOP_RIGHT = '[data-testid="project-graph-hud-top-right"]';
const has = (selector) => "Boolean(document.querySelector(" + JSON.stringify(selector) + "))";
const count = (selector) => "document.querySelectorAll(" + JSON.stringify(selector) + ").length";
const pressed = (testId) =>
  "(document.querySelector('[data-testid=" +
  testId +
  "]') || {}).getAttribute ? " +
  "document.querySelector('[data-testid=" +
  testId +
  "]').getAttribute('aria-pressed') : null";

export async function runGraphHudChecks({ page, record, ARTIFACTS }) {
  const setViewport = (width, height) =>
    page.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  try {
    // ── Full-bleed: with nothing selected the canvas owns ≥95% of the tab at both sizes. ──
    for (const [width, height] of [
      [1024, 768],
      [1920, 1080],
    ]) {
      await setViewport(width, height);
      await sleep(400); // let the IDE layout and React Flow settle on the new size
      await page.evaluate("document.querySelector('.react-flow__pane')?.click()");
      await sleep(150);
      const m = await page.evaluate(MEASURE);
      record(
        m !== null && m.ratio >= 0.95,
        `project graph: canvas >=95% of tab at ${width}x${height}`,
        m === null ? "no panel/canvas" : `ratio=${m.ratio.toFixed(3)}`,
      );
    }

    // ── Selection stability: the inspector is an overlay, the canvas rect must not move. ──
    const before = await page.evaluate(MEASURE);
    const clicked = (await page.evaluate(clickTestId("project-graph-table"))) === "OK";
    const opened = await waitFor(page, has(INSPECTOR), 5000);
    const after = await page.evaluate(MEASURE);
    record(
      clicked &&
        opened &&
        before !== null &&
        after !== null &&
        JSON.stringify(before.canvas) === JSON.stringify(after.canvas) &&
        JSON.stringify(before.panel) === JSON.stringify(after.panel),
      "project graph: selection keeps canvas rect (no resize, no shift)",
      JSON.stringify({ before: before && before.canvas, after: after && after.canvas }),
    );

    // ── Zen hides every HUD surface; Esc restores them and keeps the selection. ──
    record(
      (await page.evaluate(clickActivity("Zen mode"))) === "OK",
      "project graph: zen action found",
    );
    record(
      await waitFor(
        page,
        "!" +
          has(HUD_TOP_RIGHT) +
          " && !" +
          has(INSPECTOR) +
          " && !document.querySelector('.react-flow__minimap')",
        5000,
      ),
      "project graph: zen hides HUD, inspector and minimap",
    );
    await pressEscape(page);
    record(
      await waitFor(page, has(HUD_TOP_RIGHT) + " && " + has(INSPECTOR), 5000),
      "project graph: Esc restores HUD and inspector",
    );
    await pressEscape(page);
    record(
      await waitFor(page, "!" + has(INSPECTOR), 5000),
      "project graph: second Esc closes the inspector",
    );

    // ── Stats counters are filters: aria-pressed flips and the graph follows. ──
    const edgeChip = "project-graph-filter-page-route";
    const edgeBefore = await page.evaluate(pressed(edgeChip));
    await page.evaluate(clickTestId(edgeChip));
    const flipped = await waitFor(
      page,
      pressed(edgeChip) + " !== " + JSON.stringify(edgeBefore),
      5000,
    );
    record(edgeBefore !== null && flipped, "project graph: edge counter toggles aria-pressed");
    await page.evaluate(clickTestId(edgeChip));
    await waitFor(page, pressed(edgeChip) + " === " + JSON.stringify(edgeBefore), 5000);

    await page.evaluate(clickTestId("project-graph-filter-page"));
    record(
      await waitFor(page, count('[data-testid="project-graph-page"]') + " === 0", 5000),
      "project graph: node counter filters the graph",
    );
    await page.evaluate(clickTestId("project-graph-filter-page"));
    record(
      await waitFor(page, count('[data-testid="project-graph-page"]') + " > 0", 5000),
      "project graph: node counter restores the graph",
    );
  } finally {
    await page.send("Emulation.clearDeviceMetricsOverride");
    await sleep(300);
  }
  await page.screenshot(ARTIFACTS + "/05c-project-graph-hud.png");
}
