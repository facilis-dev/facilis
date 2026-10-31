// The AI chat acceptance step (D-045/D-046).
//
// No model is called in CI: the smoke drives the same UI a user does, but the
// provider it picks is the dev-only mock, which answers with a fixed AIResponse.
// That still exercises the real path end to end — saved settings, prompt assembly
// (the manifest may be unreachable), the parser, the proposal card, Apply, and the
// kernel write — without a key or the network. Headless Chrome runs in English,
// which is why the labels below are English.

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

const PATCH_GONE =
  "(async () => { const root = window.__ide?.snap?.workspaceFolders?.[0]?.rootPath;" +
  "if (!root) return 'NO ROOT'; for (let attempt = 0; attempt < 40; attempt++) {" +
  "const text = await window.__ide.readFileText(root + '/src/chat-demo.ts');" +
  "if (text.length === 0) return 'OK'; await new Promise((resolve) => setTimeout(resolve, 250)); }" +
  "return 'STILL THERE'; })()";

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
    record(await waitFor(page, bodyHas("Proposed changes"), 20000), "chat proposal shown");
    record(await waitFor(page, bodyHas("src/chat-demo.ts"), 5000), "chat proposal lists the file");
    record((await page.evaluate(clickIn(panel, "Apply all"))) === "OK", "chat apply clicked");
    record(await waitFor(page, bodyHas("Applied 1 file(s)"), 15000), "chat patch applied");
    record((await page.evaluate(PATCH_IN_VFS)) === "OK", "chat patch reached the VFS");
    record(
      (await page.evaluate(clickIn(panel, "Undo applied changes"))) === "OK",
      "chat undo clicked",
    );
    record(await waitFor(page, bodyHas("Reverted 1 file(s)"), 15000), "chat patch reverted");
    record((await page.evaluate(PATCH_GONE)) === "OK", "chat undo removed the file from the VFS");
  }

  await page.screenshot(ARTIFACTS + "/04-chat.png");
  return { checks };
}
