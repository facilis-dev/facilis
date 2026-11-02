// Phase 3 visualizer acceptance: the API Flow (now an editor-area tab, D-087) and the
// Release Preview panel.
//
// The project under test has routes, a schema, client pages that call the API and (after
// the write checks) commits, so both panels have real data: the API Flow reads the
// AST-augmented /_openapi.json and scans src/ for consumers, the Release Preview reads the
// git refs out of the VFS. No mocking and no network: this is the same UI a developer uses.

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

function clickByText(scope, text) {
  return (
    "(() => { const root = document.querySelector(" +
    JSON.stringify(scope) +
    "); if (!root) return 'NOTFOUND'; const button = [...root.querySelectorAll('button')].find(" +
    "(candidate) => (candidate.innerText || '').trim().includes(" +
    JSON.stringify(text) +
    ")); if (!button || button.disabled) return 'NOTFOUND'; button.click(); return 'OK'; })()"
  );
}

const COUNT = (selector) => "document.querySelectorAll(" + JSON.stringify(selector) + ").length";
const ACTIVE_TAB = "String(window.__ide.getSnapshot().activeTab || '')";

export async function runPanelChecks({ page, check, ARTIFACTS }) {
  const checks = [];
  const record = (ok, label, detail = "") => {
    check(ok, label, detail);
    checks.push({ ok, label, detail });
  };

  // ── API Flow: an editor-area tab (D-087), not a sidebar view ──
  record((await page.evaluate(clickActivity("API Flow"))) === "OK", "api flow: activity opens");
  record(
    await waitFor(
      page,
      "Boolean(document.querySelector('[data-testid=\"api-flow-panel\"]'))",
      15000,
    ),
    "api flow: panel mounted",
  );
  record(
    await waitFor(
      page,
      "(() => { const el = document.querySelector('[data-testid=\"api-flow-panel\"]');" +
        " const group = document.querySelector('[data-testid=\"editor-group\"]');" +
        " return !!el && !!group && group.contains(el) && el.getBoundingClientRect().width > 150; })()",
      15000,
    ),
    "api flow: panel uses the center area, not the sidebar",
  );
  record(
    await waitFor(
      page,
      "Boolean(document.querySelector('[data-testid=\"api-flow-canvas\"]'))",
      15000,
    ),
    "api flow: canvas mounted",
  );
  const nodes = await waitFor(page, COUNT('[data-testid="api-flow-node"]') + " > 0", 30000);
  record(
    nodes,
    "api flow: routes rendered as nodes",
    nodes ? "" : await page.evaluate("(document.body.innerText || '').slice(0, 300)"),
  );
  record(
    await waitFor(page, COUNT('[data-testid="api-flow-table"]') + " > 0", 15000),
    "api flow: tables rendered as nodes",
  );
  record(
    await waitFor(page, COUNT('[data-testid="api-flow-page"]') + " > 0", 20000),
    "api flow: the client pages that call the API are shown",
  );

  // Focus mode: hiding sidebar + preview gives the graph the window width.
  const focusClicked = await page.evaluate(
    "(() => { const button = [...document.querySelectorAll('button')].find(" +
      " (candidate) => (candidate.getAttribute('aria-label') || '').startsWith('Focus: hide'));" +
      " if (!button) return 'NOTFOUND'; button.click(); return 'OK'; })()",
  );
  record(focusClicked === "OK", "api flow: focus mode control present");
  record(
    await waitFor(
      page,
      "(() => { const el = document.querySelector('[data-testid=\"api-flow-panel\"]');" +
        " return !!el && el.getBoundingClientRect().width > 500; })()",
      10000,
    ),
    "api flow: focus mode gives the graph the window width",
  );

  // Selecting a node opens the inspector; its "Open file" button jumps to the source.
  // Not every route has x-facilis-source (the template's /health does not), so try the
  // nodes until one offers an enabled "Open file".
  let selected = "NOTFOUND";
  const nodeCount = await page.evaluate(COUNT('[data-testid="api-flow-node"]'));
  for (let index = 0; index < Math.min(nodeCount, 12) && selected !== "OK"; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- driving the browser one click at a time
    await page.evaluate(
      "(() => { const nodes = [...document.querySelectorAll('[data-testid=\"api-flow-node\"]')];" +
        " const node = nodes[" +
        index +
        "]; if (!node) return 'NOTFOUND'; node.click(); return 'OK'; })()",
    );
    // oxlint-disable-next-line no-await-in-loop -- the inspector renders after the click
    await sleep(150);
    // oxlint-disable-next-line no-await-in-loop -- same interaction, sequential by nature
    selected = await page.evaluate(
      "(() => { const aside = document.querySelector('[data-testid=\"api-flow-inspector\"]');" +
        " if (!aside) return 'NOTFOUND';" +
        " const button = [...aside.querySelectorAll('button')].find(" +
        " (candidate) => (candidate.innerText || '').includes('Open file') && !candidate.disabled);" +
        " return button ? 'OK' : 'NOTFOUND'; })()",
    );
  }
  record(selected === "OK", "api flow: a route with a source file was selected");
  record(
    await waitFor(
      page,
      "Boolean(document.querySelector('[data-testid=\"api-flow-inspector\"]'))",
      10000,
    ),
    "api flow: inspector shows the node details",
  );
  record(
    (await page.evaluate(clickByText('[data-testid="api-flow-inspector"]', "Open file"))) === "OK",
    "api flow: inspector opens the source file",
  );
  record(
    await waitFor(page, "/server\\/routes\\//.test(" + ACTIVE_TAB + ")", 10000),
    "api flow: code jump reached the route source",
    await page.evaluate(ACTIVE_TAB),
  );

  // Opening the file switched the active tab; bring the API Flow back for the list toggle.
  record(
    (await page.evaluate(clickActivity("API Flow"))) === "OK",
    "api flow: tab re-focused after the jump",
  );
  await waitFor(
    page,
    "Boolean(document.querySelector('[data-testid=\"api-flow-canvas\"]'))",
    15000,
  );

  // The list view is the same data without the graph; the toggle must switch it.
  record(
    (await page.evaluate(clickByText('[data-testid="api-flow-panel"]', "List"))) === "OK",
    "api flow: list view selected",
  );
  record(
    await waitFor(
      page,
      "Boolean(document.querySelector('[data-testid=\"api-flow-list\"]'))",
      10000,
    ),
    "api flow: list view rendered",
  );
  record(
    (await page.evaluate(clickByText('[data-testid="api-flow-panel"]', "Graph"))) === "OK",
    "api flow: graph view restored",
  );
  await page.screenshot(ARTIFACTS + "/05-api-flow.png");

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
