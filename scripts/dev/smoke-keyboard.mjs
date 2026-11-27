// Keyboard acceptance for the accessibility work (#209, #212, #214, #218, #211, #217, #223).
//
// The IDE ships no jsdom, so focus movement cannot be unit-tested: this module is where the
// claims become evidence. It drives the real UI through CDP on the page the other checks
// already booted (a project is open, an editor tab and a terminal exist) and asserts on
// document.activeElement, which is the only honest witness of where the keyboard went.

import { openPage } from "./cdp.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(page, expression, limitMs) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    if (await page.evaluate(expression)) return true;
    await sleep(200);
  }
  return false;
}

// CDP modifiers: Alt 1, Ctrl 2, Meta 4, Shift 8.
async function pressKey(page, key, code, keyCode, modifiers = 0) {
  const shape = { key, code, windowsVirtualKeyCode: keyCode, modifiers };
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...shape });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...shape });
  await sleep(120);
}

const FOCUSED =
  "(() => { const el = document.activeElement; return el === null ? 'NONE' : (el.getAttribute('role') || el.tagName) + '|' + (el.id || '') + '|' + ((el.textContent || '').trim().slice(0, 40)); })()";

export async function runKeyboardChecks({ page, client, devUrl, check, ARTIFACTS }) {
  const checks = [];
  const record = (ok, label, detail = "") => {
    check(ok, label, detail);
    checks.push({ ok, label, detail });
  };

  // Two editor tabs, so the strip has something to switch between.
  await page.evaluate(`(() => {
    const snap = window.__ide.getSnapshot();
    const root = snap.workspaceFolders[0].rootPath;
    const files = snap.files.filter((rel) => /[.](ts|tsx|json|md)$/.test(rel)).slice(0, 2);
    for (const rel of files) window.__ide.openFile(root + '/' + rel);
  })()`);
  const twoTabs = await waitFor(
    page,
    "document.querySelectorAll('[role=\"tab\"]').length >= 2",
    15000,
  );
  record(
    twoTabs,
    "keyboard: the editor strip is a tablist with two tabs",
    await page.evaluate("document.querySelectorAll('[role=\"tab\"]').length + ' tabs'"),
  );

  // One roving tab stop: exactly one tab is in the tab order.
  const stops = await page.evaluate(
    'document.querySelectorAll(\'[role="tab"][tabindex="0"]\').length',
  );
  record(stops === 1, "keyboard: the tab strip has one tab stop", stops + " tabbable tab(s)");

  // Arrow keys move and activate.
  await page.evaluate('document.querySelector(\'[role="tab"][tabindex="0"]\').focus()');
  const beforeArrow = await page.evaluate("document.activeElement.textContent.trim()");
  await pressKey(page, "ArrowLeft", "ArrowLeft", 37);
  const afterArrow = await page.evaluate(FOCUSED);
  const arrowMoved =
    afterArrow.startsWith("tab|") &&
    (await page.evaluate("document.activeElement.getAttribute('aria-selected')")) === "true";
  record(
    arrowMoved,
    "keyboard: ArrowLeft moves focus between tabs and activates",
    beforeArrow + " -> " + afterArrow,
  );

  // Alt+2 selects the second tab from anywhere in the workspace.
  await page.evaluate("document.activeElement.blur()");
  await pressKey(page, "2", "Digit2", 50, 1);
  const second = await page.evaluate(
    "(() => { const tabs = [...document.querySelectorAll('[role=\"tab\"]')]; return tabs.length > 1 && tabs[1].getAttribute('aria-selected') === 'true'; })()",
  );
  record(second, "keyboard: Alt+2 selects the second editor tab");

  // Delete closes the focused tab through the dirty-aware queue (this file is clean).
  await page.evaluate('document.querySelector(\'[role="tab"][tabindex="0"]\').focus()');
  const tabsBeforeDelete = await page.evaluate(
    "document.querySelectorAll('[role=\"tab\"]').length",
  );
  await pressKey(page, "Delete", "Delete", 46);
  const closed = await waitFor(
    page,
    `document.querySelectorAll('[role="tab"]').length < ${tabsBeforeDelete}`,
    8000,
  );
  const focusKept = await page.evaluate(
    "document.activeElement !== document.body && document.activeElement !== null",
  );
  record(
    closed && focusKept,
    "keyboard: Delete closes the focused tab and keeps focus in the strip",
  );

  // The shortcut help is reachable with "?" and lists the registry.
  await page.evaluate("document.activeElement.blur()");
  await pressKey(page, "?", "Slash", 191, 8);
  const helpOpen = await waitFor(
    page,
    "Boolean(document.querySelector('[role=\"dialog\"]'))",
    5000,
  );
  record(helpOpen, "keyboard: ? opens the shortcut help");
  if (helpOpen) {
    const helpText = await page.evaluate(
      "(() => { const d = document.querySelector('[role=\"dialog\"]'); return d ? (d.innerText || '').replace(/\\s+/g, ' ').trim() : ''; })()",
    );
    record(helpText.length > 40, "keyboard: the help lists the bindings", helpText.slice(0, 120));
    await page.screenshot(ARTIFACTS + "/07-shortcut-help.png");
    await pressKey(page, "Escape", "Escape", 27);
    record(
      await waitFor(page, "document.querySelector('[role=\"dialog\"]') === null", 5000),
      "keyboard: Escape closes the help",
    );
  }

  // The Explorer tree: one tab stop, arrows move between rows.
  await page.evaluate(`(() => {
    // The activity bar names the tree's view through t("activity.workspace").
    const button = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Workspace');
    if (button) button.click();
  })()`);
  const treeReady = await waitFor(
    page,
    'Boolean(document.querySelector(\'[role="tree"] [role="treeitem"][tabindex="0"]\'))',
    8000,
  );
  record(treeReady, "keyboard: the Explorer tree exposes one tab stop");
  if (treeReady) {
    await page.evaluate(
      'document.querySelector(\'[role="tree"] [role="treeitem"][tabindex="0"]\').focus()',
    );
    const rowBefore = await page.evaluate(
      "document.activeElement.getAttribute('title') || document.activeElement.textContent.trim()",
    );
    await pressKey(page, "ArrowDown", "ArrowDown", 40);
    const rowAfter = await page.evaluate(
      "(() => { const el = document.activeElement; return el.getAttribute('title') || (el.textContent || '').trim(); })()",
    );
    record(
      rowBefore !== rowAfter && rowAfter !== "",
      "keyboard: ArrowDown moves the tree focus",
      rowBefore + " -> " + rowAfter,
    );
  }

  // F6 leaves a focused terminal (issue #211). The terminal may need creating.
  const terminal = await waitFor(
    page,
    "Boolean(document.querySelector('.vv-term-host .xterm-helper-textarea'))",
    8000,
  );
  if (!terminal) await page.evaluate("window.__ide.terminals.newShellTerminal()");
  const terminalReady = await waitFor(
    page,
    "Boolean(document.querySelector('.vv-term-host .xterm-helper-textarea'))",
    15000,
  );
  if (terminalReady) {
    await page.evaluate("document.querySelector('.vv-term-host .xterm-helper-textarea').focus()");
    await pressKey(page, "F6", "F6", 117);
    const left = await page.evaluate(
      "document.activeElement !== null && document.activeElement.closest('.vv-term-host') === null",
    );
    record(left, "keyboard: F6 moves focus out of the terminal", await page.evaluate(FOCUSED));
  } else {
    record(false, "keyboard: F6 moves focus out of the terminal", "no terminal mounted");
  }

  // Home covers the workspace: one inert frame, and Tab stays inside Home (issue #212/#217).
  // It runs in its OWN tab: leaving Home on the main page disposes Monaco and aborts its
  // pending worker fetch, which the run-wide failed-request probe would rightly report.
  const homePage = await openPage(client, devUrl);
  const homeInert = await waitFor(
    homePage,
    "Boolean(document.querySelector('[data-workspace-frame][inert]'))",
    180000,
  );
  record(homeInert, "keyboard: Home inerts the workspace frame");
  if (homeInert) {
    await homePage.evaluate("document.activeElement && document.activeElement.blur()");
    await pressKey(homePage, "Tab", "Tab", 9);
    const insideHome = await homePage.evaluate(
      "(() => { const el = document.activeElement; return el !== null && el.closest('[data-workspace-frame]') === null; })()",
    );
    record(
      insideHome,
      "keyboard: Tab from Home never lands in the covered shell",
      await homePage.evaluate(FOCUSED),
    );
  }
  return { checks };
}
