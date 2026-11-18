// The AI chat acceptance step (D-045/D-046, write path D-192).
//
// No model is called in CI: the smoke drives the same UI a user does, but the provider it
// picks is the dev-only mock. It answers with a write script, so the run exercises the real
// path end to end — saved settings, prompt assembly (the manifest may be unreachable), the
// parser, the clean-tree gate, write_file through the validator, the git-changes footer and
// Undo — without a key or the network. Headless Chrome runs in English, which is why the
// labels below are English.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(page, expression, limitMs) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    if (await page.evaluate(expression)) return true;
    await sleep(250);
  }
  return false;
}

const bodyHas = (text) => "(document.body.innerText || '').includes(" + JSON.stringify(text) + ")";

function clickIn(scope, text) {
  return (
    "(() => { const root = document.querySelector(" +
    JSON.stringify(scope) +
    "); if (!root) return 'NOTFOUND'; const button = [...root.querySelectorAll('button')].find(" +
    "(candidate) => (candidate.innerText || '').trim() === " +
    JSON.stringify(text) +
    "); if (!button || button.disabled) return 'NOTFOUND'; button.click(); return 'OK'; })()"
  );
}

const SET_TEXTAREA =
  "(() => { const aside = document.querySelector('aside[aria-label=\"AI Chat\"]');" +
  "const textarea = aside && aside.querySelector('textarea'); if (!textarea) return 'NOTFOUND';" +
  "const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;" +
  "setter.call(textarea, 'Create a demo file');" +
  "textarea.dispatchEvent(new Event('input', { bubbles: true })); return 'OK'; })()";

const CLICK_SEND =
  "(() => { const aside = document.querySelector('aside[aria-label=\"AI Chat\"]'); if (!aside) return 'NOTFOUND';" +
  "const button = [...aside.querySelectorAll('button')].find(" +
  "(candidate) => (candidate.getAttribute('aria-label') || '') === 'Send');" +
  "if (!button || button.disabled) return 'NOTFOUND'; button.click(); return 'OK'; })()";

const SET_MOCK_PROVIDER =
  "(() => { const select = document.querySelector('#chat-provider'); if (!select) return 'NOTFOUND';" +
  "const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;" +
  "setter.call(select, 'mock'); select.dispatchEvent(new Event('change', { bubbles: true })); return 'OK'; })()";

const OPEN_CHAT =
  "(() => { const button = [...document.querySelectorAll('button')].find(" +
  "(candidate) => (candidate.getAttribute('aria-label') || '') === 'AI Chat');" +
  "if (!button) return 'NOTFOUND'; button.click(); return 'OK'; })()";

const MODEL_IS_MOCK = "(document.querySelector('#chat-model')?.value || '') === 'mock'";

const GATE_LABELS = JSON.stringify(["Initialize repository and continue", "Commit and continue"]);

const GATE_VISIBLE =
  "(() => { const aside = document.querySelector('aside[aria-label=\"AI Chat\"]'); if (!aside) return false;" +
  "return [...aside.querySelectorAll('button')].some((candidate) => !candidate.disabled && " +
  GATE_LABELS +
  ".includes((candidate.innerText || '').trim())); })()";

function clickAnyIn(scope, labels) {
  return (
    "(() => { const root = document.querySelector(" +
    JSON.stringify(scope) +
    "); if (!root) return 'NOTFOUND'; const button = [...root.querySelectorAll('button')].find(" +
    "(candidate) => !candidate.disabled && " +
    JSON.stringify(labels) +
    ".includes((candidate.innerText || '').trim())); if (!button) return 'NOTFOUND'; button.click(); return 'OK'; })()"
  );
}

const CLICK_INSTRUCTIONS =
  "(() => { const aside = document.querySelector('aside[aria-label=\"AI Chat\"]'); if (!aside) return 'NOTFOUND';" +
  "const button = [...aside.querySelectorAll('button')].find(" +
  "(candidate) => (candidate.getAttribute('aria-label') || '').startsWith('Project instructions'));" +
  "if (!button) return 'NOTFOUND'; button.click(); return 'OK'; })()";

const INSTRUCTIONS_IN_VFS =
  "(async () => { const root = window.__ide?.snap?.workspaceFolders?.[0]?.rootPath;" +
  "if (!root) return 'NO ROOT'; for (let attempt = 0; attempt < 40; attempt++) {" +
  "const text = await window.__ide.readFileText(root + '/AGENTS.md');" +
  "if (text.includes('# Agent instructions')) return 'OK';" +
  "await new Promise((resolve) => setTimeout(resolve, 250)); } return 'EMPTY'; })()";

const PATCH_GONE =
  "(async () => { const root = window.__ide?.snap?.workspaceFolders?.[0]?.rootPath;" +
  "if (!root) return 'NO ROOT'; for (let attempt = 0; attempt < 40; attempt++) {" +
  "const text = await window.__ide.readFileText(root + '/src/chat-demo.ts');" +
  "if (text.length === 0) return 'OK'; await new Promise((resolve) => setTimeout(resolve, 250)); }" +
  "return 'STILL THERE'; })()";

const FILE_READY =
  "(async () => { const root = window.__ide?.snap?.workspaceFolders?.[0]?.rootPath;" +
  "if (!root) return false; const text = await window.__ide.readFileText(root + '/src/chat-demo.ts');" +
  "return text.length > 0; })()";

const PATCH_IN_VFS =
  "(async () => { const root = window.__ide?.snap?.workspaceFolders?.[0]?.rootPath;" +
  "if (!root) return 'NO ROOT'; for (let attempt = 0; attempt < 40; attempt++) {" +
  "const text = await window.__ide.readFileText(root + '/src/chat-demo.ts');" +
  "if (text.length > 0) return 'OK'; await new Promise((resolve) => setTimeout(resolve, 250)); }" +
  "return 'EMPTY'; })()";

export async function runChatChecks({ page, check, ARTIFACTS }) {
  const checks = [];
  const record = (ok, label, detail = "") => {
    check(ok, label, detail);
    checks.push({ ok, label, detail });
  };
  const panel = 'aside[aria-label="AI Chat"]';
  const dialog = '[data-slot="dialog-content"]';

  record((await page.evaluate(OPEN_CHAT)) === "OK", "chat panel opens");
  record(await waitFor(page, bodyHas("Build with the assistant"), 10000), "chat empty state");

  record(
    (await page.evaluate(clickIn(panel, "Configure a provider"))) === "OK",
    "chat settings open",
  );
  const picker = await waitFor(page, "Boolean(document.querySelector('#chat-provider'))", 10000);
  record(picker, "chat provider picker listed");
  if (picker) {
    record((await page.evaluate(SET_MOCK_PROVIDER)) === "OK", "chat mock provider selected");
    record(await waitFor(page, MODEL_IS_MOCK, 5000), "chat model filled from the preset");
    record((await page.evaluate(clickIn(dialog, "Save"))) === "OK", "chat settings saved");
  }

  const composer = await waitFor(
    page,
    "Boolean(document.querySelector('aside[aria-label=\"AI Chat\"] textarea'))",
    10000,
  );
  record(composer, "chat composer ready");
  if (composer) {
    record((await page.evaluate(SET_TEXTAREA)) === "OK", "chat message typed");
    await sleep(200);
    record((await page.evaluate(CLICK_SEND)) === "OK", "chat message sent");
    // The mock trickles its answer, so the streaming bubble is observable: the
    // panel marks data-streaming while the message field is arriving.
    let streamingSeen = false;
    for (let attempt = 0; attempt < 200 && !streamingSeen; attempt++) {
      streamingSeen = await page.evaluate(
        'Boolean(document.querySelector(\'aside[aria-label="AI Chat"][data-streaming="true"]\'))',
      );
      if (!streamingSeen) await sleep(25);
    }
    record(streamingSeen, "chat streaming bubble shown");
    // The mock writes src/chat-demo.ts; the clean-tree gate may pause the first write. When
    // it does, "commit and continue" is the real user action (initializing the repo too).
    let gateShown = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await page.evaluate(GATE_VISIBLE)) {
        gateShown = true;
        break;
      }
      if (await page.evaluate(FILE_READY)) break;
      await sleep(250);
    }
    if (gateShown) {
      record(
        (await page.evaluate(
          clickAnyIn(panel, ["Initialize repository and continue", "Commit and continue"]),
        )) === "OK",
        "chat clean-tree gate committed",
      );
    }
    const inVfs = await page.evaluate(PATCH_IN_VFS);
    const failureDetail =
      inVfs === "OK"
        ? ""
        : await page.evaluate(
            "(() => { const a = document.querySelector('aside[aria-label=\\\"AI Chat\\\"]');" +
              " if (!a) return 'NO PANEL';" +
              " const pre = a.querySelector('pre');" +
              " return ((a.innerText || '') + ' || DETAIL: ' + (pre ? pre.textContent : 'NO DETAIL')).slice(0, 900); })()",
          );
    record(inVfs === "OK", "chat written file reached the VFS", failureDetail);
    record(
      await waitFor(page, bodyHas("the git-changes footer shows the file"), 20000),
      "chat final summary shown",
    );
    record(await waitFor(page, bodyHas("Git changes (1)"), 10000), "chat git footer shown");
    record(
      (await page.evaluate(clickIn(panel, "Undo this turn"))) === "OK",
      "chat turn undo clicked",
    );
    record((await page.evaluate(PATCH_GONE)) === "OK", "chat undo removed the file from the VFS");
    record((await page.evaluate(CLICK_INSTRUCTIONS)) === "OK", "chat project instructions button");
    record(
      (await page.evaluate(INSTRUCTIONS_IN_VFS)) === "OK",
      "chat created AGENTS.md in the project",
    );
  }

  await page.screenshot(ARTIFACTS + "/04-chat.png");
  return { checks };
}
