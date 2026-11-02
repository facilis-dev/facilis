// Source Control acceptance: the diff tab (D-089) and the commit graph (D-088).
//
// The project under test already has a git repository with commits (smoke-write.mjs inits
// it and commits the write checks), so the graph has real history. One tracked file is made
// dirty through the VFS to have a change row to click; the working tree is restored before
// the Release Preview checks run, so they still see the committed state.

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

/** Click the Source Control activity only when the sidebar is not already showing it. */
async function showScm(page) {
  const shown = await page.evaluate(
    "(() => { const snap = window.__ide.getSnapshot();" +
      " return snap.activeView === 'scm' && !snap.sidebarCollapsed; })()",
  );
  if (shown) return true;
  return (await page.evaluate(clickActivity("Source Control"))) === "OK";
}

export async function runScmChecks({ page, check, ARTIFACTS }) {
  const record = (ok, label, detail = "") => check(ok, label, detail);

  record(await showScm(page), "scm: panel shown");

  // Make one tracked file dirty so there is a change row: a VFS write + scm.refresh is the
  // same path a save takes, without depending on Monaco keystrokes.
  const dirty = await page.evaluate(
    "(async () => { const ide = window.__ide; const root = ide.activeFolder.rootPath;" +
      " const path = root + '/src/app.tsx'; const text = await ide.readFileText(path);" +
      " ide.bridge.post('vv-write', { path, contents: text + String.fromCharCode(10) + '// smoke diff' + String.fromCharCode(10) });" +
      " for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 100)); await ide.scm.refresh();" +
      " const repo = ide.scm.getSnapshot().repos.find((r) => r.root === root);" +
      " if (repo && repo.changes.some((c) => c.path === 'src/app.tsx')) return 'OK'; }" +
      " return 'TIMEOUT'; })()",
  );
  record(dirty === "OK", "scm: a change row is available");

  record(
    (await page.evaluate(
      "(() => { const rows = [...document.querySelectorAll('.group.flex.h-6.cursor-pointer')];" +
        " const row = rows.find((entry) => (entry.title || '') === 'src/app.tsx');" +
        " if (!row) return 'NOTFOUND'; row.click(); return 'OK'; })()",
    )) === "OK",
    "scm: clicking a change opens the diff tab",
  );

  record(
    await waitFor(
      page,
      "(() => { const orig = document.querySelector('.monaco-diff-editor .editor.original');" +
        " const mod = document.querySelector('.monaco-diff-editor .editor.modified');" +
        " if (!orig || !mod) return false;" +
        " const w = (el) => el.getBoundingClientRect().width;" +
        " return w(orig) > 100 && w(mod) > 100; })()",
      20000,
    ),
    "scm: the diff is side by side (both panes mounted)",
  );
  record(
    await waitFor(
      page,
      "(() => { const d = window.__ide.diffSession && window.__ide.diffSession.editor;" +
        " if (!d) return false; const changes = d.getLineChanges();" +
        " return !!changes && changes.length > 0; })()",
      20000,
    ),
    "scm: the diff is computed",
  );
  if (ARTIFACTS) await page.screenshot(ARTIFACTS + "/05a-scm-diff.png");

  // The graph is opened from the repo header, so the SCM panel must be visible.
  record(await showScm(page), "commit graph: SCM panel visible");
  record(
    (await page.evaluate(
      "(() => { const button = [...document.querySelectorAll('button')].find(" +
        " (candidate) => (candidate.getAttribute('aria-label') || '') === 'Open commit graph');" +
        " if (!button) return 'NOTFOUND'; button.click(); return 'OK'; })()",
    )) === "OK",
    "commit graph: the repo-header button opens the tab",
  );
  record(
    await waitFor(
      page,
      "Boolean(document.querySelector('[data-testid=\"commit-graph-panel\"]'))",
      20000,
    ),
    "commit graph: panel mounted",
  );
  record(
    await waitFor(
      page,
      "document.querySelectorAll('[data-testid=\"commit-graph-node\"]').length > 0",
      20000,
    ),
    "commit graph: commits rendered as nodes",
  );
  record(
    (await page.evaluate(
      "(() => { const node = document.querySelector('[data-testid=\"commit-graph-node\"]');" +
        " if (!node) return 'NOTFOUND'; node.click(); return 'OK'; })()",
    )) === "OK",
    "commit graph: a commit can be selected",
  );
  record(
    await waitFor(
      page,
      "Boolean(document.querySelector('[data-testid=\"commit-graph-details\"]'))",
      10000,
    ),
    "commit graph: the details inspector opens",
  );
  if (ARTIFACTS) await page.screenshot(ARTIFACTS + "/05b-commit-graph.png");

  // Restore the working tree, so the Release Preview checks see the committed state.
  await page.evaluate(
    "(async () => { const ide = window.__ide; const root = ide.activeFolder.rootPath;" +
      " await ide.scm.refresh();" +
      " const repo = ide.scm.getSnapshot().repos.find((r) => r.root === root);" +
      " const change = repo && repo.changes.find((c) => c.path === 'src/app.tsx');" +
      " if (change) await ide.scm.discard(root, change); })()",
  );
}
