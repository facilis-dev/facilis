// The AI-facing facade over the preview CDP client (D-111).
//
// The PTC tools need friendly operations ("click this selector", "what is on screen") and a
// strict JSON result; the CDP client (ide/src/vv/preview-cdp.ts) stays a transport. "The app is
// not running" is reported as data, not as an exception, so the model can ask the user to Run.
//
// Nothing here writes to the project: clicks/typing act on the running app's own state.

import type { PreviewSession, PreviewTab } from "@/vv/preview-session";
import type { PtcJson } from "./ptc/protocol";

export interface PreviewAccess {
  /** The app is running and its preview frame is mounted. */
  available(): boolean;
  state(): Promise<PtcJson>;
  console(): PtcJson;
  network(): PtcJson;
  /** `outerHTML` of a selector, or the body text when the selector is null. */
  dom(selector: string | null, maxChars: number): Promise<PtcJson>;
  click(selector: string): Promise<PtcJson>;
  fill(selector: string, text: string): Promise<PtcJson>;
  open(path: string): Promise<PtcJson>;
  /** Wait until a selector matches (or for `ms` when the selector is null). */
  wait(selector: string | null, ms: number): Promise<PtcJson>;
}

const STATE_TEXT_CHARS = 600;
const CONSOLE_LIMIT = 20;
const NETWORK_LIMIT = 20;
const WAIT_STEP_MS = 120;

function stateExpression(): string {
  return `(() => ({
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    text: ((document.body && document.body.innerText) || "").slice(0, ${String(STATE_TEXT_CHARS)})
  }))()`;
}

function domExpression(selector: string | null, maxChars: number): string {
  if (selector === null) {
    return `(() => ({ matched: true, text: ((document.body && document.body.innerText) || "").slice(0, ${String(maxChars)}) }))()`;
  }
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { matched: false };
    return { matched: true, tag: el.tagName.toLowerCase(), html: el.outerHTML.slice(0, ${String(maxChars)}) };
  })()`;
}

function clickExpression(selector: string): string {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, reason: "no element matches " + ${JSON.stringify(selector)} };
    el.scrollIntoView({ block: "center", inline: "center" });
    const tag = el.tagName.toLowerCase();
    const text = ((el.innerText || el.value || "") + "").trim().slice(0, 80);
    el.click();
    return { ok: true, tag, text };
  })()`;
}

function fillExpression(selector: string, text: string): string {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, reason: "no element matches " + ${JSON.stringify(selector)} };
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : null;
    if (proto === null) return { ok: false, reason: "the element is not an input or textarea" };
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(proto, "value");
    if (!setter || !setter.set) return { ok: false, reason: "the value setter is unavailable" };
    setter.set.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, tag: el.tagName.toLowerCase(), value: el.value };
  })()`;
}

export function createPreviewAccess(session: PreviewSession): PreviewAccess {
  const tab = (): PreviewTab | null => session.activePreviewTab();
  const evaluate = (expression: string): Promise<unknown> => session.cdp.evaluate(expression);
  return {
    available() {
      const current = tab();
      return current !== null && session.cdp.mounted();
    },
    async state() {
      return (await evaluate(stateExpression())) as PtcJson;
    },
    console() {
      const rows = session.cdp.consoleEntries().map((entry) => ({
        kind: entry.kind,
        text: entry.text,
      }));
      const of = (kind: string) =>
        rows.filter((entry) => entry.kind === kind).slice(-CONSOLE_LIMIT);
      return {
        available: true,
        errors: of("error"),
        warnings: of("warn"),
        exceptions: of("exception"),
        entries: rows.slice(-CONSOLE_LIMIT),
      };
    },
    network() {
      const rows = session.cdp.networkEntries().map((entry) => ({
        method: entry.method,
        url: entry.url,
        ...(entry.status === undefined ? {} : { status: entry.status }),
        ...(entry.error === undefined ? {} : { error: entry.error }),
      }));
      const failures = rows.filter(
        (entry) => entry.error !== undefined || (entry.status !== undefined && entry.status >= 400),
      );
      return {
        available: true,
        failures: failures.slice(-NETWORK_LIMIT),
        recent: rows.slice(-NETWORK_LIMIT),
        total: rows.length,
      };
    },
    async dom(selector, maxChars) {
      return (await evaluate(domExpression(selector, maxChars))) as PtcJson;
    },
    async click(selector) {
      return (await evaluate(clickExpression(selector))) as PtcJson;
    },
    async fill(selector, text) {
      return (await evaluate(fillExpression(selector, text))) as PtcJson;
    },
    async open(path) {
      const current = tab();
      if (current === null) throw new Error("no preview is running");
      session.navigatePreviewPath(current.id, path);
      return { ok: true, path, note: "the preview reloads on the new route" };
    },
    async wait(selector, ms) {
      const started = Date.now();
      if (selector === null) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
        return { ok: true, waitedMs: Date.now() - started };
      }
      for (;;) {
        const found = await evaluate(
          `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
        );
        if (found === true) return { ok: true, waitedMs: Date.now() - started };
        if (Date.now() - started >= ms) return { ok: false, waitedMs: Date.now() - started };
        await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
      }
    },
  };
}
