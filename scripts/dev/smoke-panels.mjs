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

function typeIntoTestId(testId, value) {
  return (
    "(() => { const element = document.querySelector('[data-testid=" +
    JSON.stringify(testId) +
    "]'); if (!element) return 'NOTFOUND';" +
    " const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;" +
    " setter.call(element, " +
    JSON.stringify(value) +
    "); element.dispatchEvent(new Event('input', { bubbles: true })); return 'OK'; })()"
  );
}

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

  // ── Data Explorer sidebar and its SQL console (D-083/D-097): the sidebar keeps the
  // table list; the console posts to the same-origin dev endpoint through the kernel. The
  // activity entry toggles the sidebar, so a second click reopens it if it was collapsed. ──
  let dataTables = await waitFor(page, COUNT('[data-testid="data-explorer-table"]') + " > 0", 750);
  if (dataTables) {
    record(true, "data explorer: activity opens");
  } else {
    record((await page.evaluate(clickActivity("Data"))) === "OK", "data explorer: activity opens");
    dataTables = await waitFor(page, COUNT('[data-testid="data-explorer-table"]') + " > 0", 20000);
    if (!dataTables) {
      await page.evaluate(clickActivity("Data"));
      dataTables = await waitFor(
        page,
        COUNT('[data-testid="data-explorer-table"]') + " > 0",
        20000,
      );
    }
  }
  record(
    dataTables,
    "data explorer: tables rendered",
    dataTables ? "" : await page.evaluate("(document.body.innerText || '').slice(0, 400)"),
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
  record(
    (await page.evaluate(
      typeIntoTestId("data-query-editor", "select count(*) as count from todos"),
    )) === "OK",
    "query console: SQL entered",
  );
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
