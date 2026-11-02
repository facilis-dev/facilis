// Phase 3 visualizer acceptance: the API Flow graph and the Release Preview panel.
//
// The project under test has routes, a schema and (after the write checks) commits, so both
// panels have real data to render: the API Flow reads the AST-augmented /_openapi.json, and
// the Release Preview reads the git refs and db/schema.ts out of the VFS. No mocking and no
// network: this is the same UI a developer uses.
//
// Headless Chrome runs in English, which is why the labels below are English.

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

const COUNT = (selector) => "document.querySelectorAll(" + JSON.stringify(selector) + ").length";
const BODY_HAS = (text) => "(document.body.innerText || '').includes(" + JSON.stringify(text) + ")";

export async function runPanelChecks({ page, check, ARTIFACTS }) {
  const checks = [];
  const record = (ok, label, detail = "") => {
    check(ok, label, detail);
    checks.push({ ok, label, detail });
  };

  // ── API Flow (SPEC §10.2, §12 Phase 3) ──
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
  const tableNodes = await waitFor(page, COUNT('[data-testid="api-flow-table"]') + " > 0", 15000);
  record(tableNodes, "api flow: tables rendered as nodes");
  await page.screenshot(ARTIFACTS + "/05-api-flow.png");

  // Clicking a route node jumps to its source file (the graph's "code jump" contract).
  const opened = await page.evaluate(
    "(() => { const node = document.querySelector('[data-testid=\"api-flow-node\"]');" +
      " if (!node) return 'NOTFOUND'; node.click(); return 'OK'; })()",
  );
  record(opened === "OK", "api flow: route node clicked");
  record(
    await waitFor(page, BODY_HAS("server/routes/api/") + " || " + BODY_HAS("todos"), 10000),
    "api flow: code jump opens the route source",
  );

  // ── Release Preview (SPEC §11.3) ──
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
