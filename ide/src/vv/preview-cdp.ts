// Programmatic CDP client for the running preview (D-111).
//
// The preview Service Worker injects chobitsu — a CDP backend — into every preview page
// (ide/public/sw.js, CDP_BOOTSTRAP). The DevTools panel relays it to the chii frontend; this
// module gives the IDE the same channel without the panel: one CDP session per preview tab,
// with console and network events buffered so the AI tools can read them.
//
// Host-side only: the single DOM assumption is the frame's contentWindow.postMessage, so the
// tests drive it with a scripted fake.

import {
  consoleText,
  evaluated,
  exceptionText,
  isRecord,
  type PreviewConsoleEntry,
  type PreviewNetworkEntry,
} from "./preview-cdp-events";
import type { PreviewTab } from "./preview-session";

export type { PreviewConsoleEntry, PreviewNetworkEntry } from "./preview-cdp-events";

export interface PreviewCdpTargets {
  /** The tab to drive: the active preview tab with a dev-server port, or null. */
  active(): PreviewTab | null;
  /** The iframe a tab is mounted in. */
  frame(tabId: string): HTMLIFrameElement | undefined;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface TabState {
  ready: boolean;
  initAt: number;
  nextId: number;
  pending: Map<number, Pending>;
  console: PreviewConsoleEntry[];
  network: Map<string, PreviewNetworkEntry>;
}

const CONSOLE_BUFFER = 80;
const NETWORK_BUFFER = 120;
const SEND_TIMEOUT_MS = 2_000;
const PROBE_TIMEOUT_MS = 250;
const PROBE_ATTEMPTS = 12;

/** One CDP session against the chobitsu agent of one preview frame. */
export class PreviewCdp {
  private readonly targets: PreviewCdpTargets;
  private readonly tabs = new Map<string, TabState>();

  constructor(targets: PreviewCdpTargets) {
    this.targets = targets;
  }

  /** A frame finished loading: the previous document's session and buffers are gone. */
  onFrameLoad(tabId: string): void {
    this.reset(tabId);
  }

  /** A tab closed: drop the session and reject whatever was in flight. */
  forget(tabId: string): void {
    this.reset(tabId);
    this.tabs.delete(tabId);
  }

  /** The tab to drive, or null when no project is running. */
  activeTab(): PreviewTab | null {
    return this.targets.active();
  }

  /** The app is running and its iframe is mounted: the tools may try to talk to it. */
  mounted(): boolean {
    const tab = this.activeTab();
    return tab !== null && this.targets.frame(tab.id) !== undefined;
  }

  /** Console rows (all levels + exceptions) recorded since the page loaded, newest last. */
  consoleEntries(): readonly PreviewConsoleEntry[] {
    const tab = this.activeTab();
    return tab === null ? [] : (this.tabs.get(tab.id)?.console ?? []);
  }

  /** Network rows (insertion order, capped); status arrives with the response event. */
  networkEntries(): readonly PreviewNetworkEntry[] {
    const tab = this.activeTab();
    const entries = tab === null ? undefined : this.tabs.get(tab.id)?.network;
    return entries === undefined ? [] : [...entries.values()];
  }

  /** Route one `vv-cdp` target message from the preview bootstrap (PreviewDevtools). */
  dispatch(tabId: string, raw: unknown): void {
    if (typeof raw !== "string") return;
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(message)) return;
    const id = message.id;
    const pending = typeof id === "number" ? this.tabs.get(tabId)?.pending.get(id) : undefined;
    if (typeof id === "number" && pending !== undefined) {
      this.tabs.get(tabId)?.pending.delete(id);
      clearTimeout(pending.timer);
      const error = message.error;
      if (isRecord(error) && typeof error.message === "string") {
        pending.reject(new Error(error.message));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (typeof message.method !== "string") return;
    this.handleEvent(tabId, message.method, message.params);
  }

  /** Run one expression in the page and return its JSON value. */
  async evaluate(expression: string, timeoutMs = SEND_TIMEOUT_MS): Promise<unknown> {
    const tab = this.activeTab();
    if (tab === null) throw new Error("no preview is running");
    await this.ensure(tab.id);
    const result = await this.send(
      tab.id,
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true, userGesture: true },
      timeoutMs,
    );
    return evaluated(result);
  }

  private stateOf(tabId: string): TabState {
    const existing = this.tabs.get(tabId);
    if (existing !== undefined) return existing;
    const created: TabState = {
      ready: false,
      initAt: 0,
      nextId: 0,
      pending: new Map(),
      console: [],
      network: new Map(),
    };
    this.tabs.set(tabId, created);
    return created;
  }

  private reset(tabId: string): void {
    const state = this.tabs.get(tabId);
    if (state === undefined) return;
    for (const pending of state.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("the preview reloaded"));
    }
    state.pending.clear();
    state.ready = false;
    state.initAt = 0;
    state.console = [];
    state.network.clear();
  }

  /** Attach the bootstrap's CDP domains, then probe until the agent answers. */
  private async ensure(tabId: string): Promise<TabState> {
    const state = this.stateOf(tabId);
    if (state.ready) return state;
    if (state.initAt === 0) {
      if (!this.post(tabId, { source: "vv-cdp", dir: "init" })) {
        throw new Error("the preview frame is gone: restart the project");
      }
      state.initAt = Date.now();
    }
    for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt += 1) {
      try {
        const value = await this.send(
          tabId,
          "Runtime.evaluate",
          { expression: "1", returnByValue: true },
          PROBE_TIMEOUT_MS,
        );
        if (evaluated(value) === 1) {
          state.ready = true;
          return state;
        }
      } catch {
        // The document is still loading (or the bootstrap is not installed): retry.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("the preview did not answer: wait for the app to load, then retry");
  }

  private send(
    tabId: string,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    const state = this.stateOf(tabId);
    const id = ++state.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(id);
        reject(new Error(method + " timed out after " + timeoutMs + " ms"));
      }, timeoutMs);
      state.pending.set(id, { resolve, reject, timer });
      const posted = this.post(tabId, {
        source: "vv-cdp",
        dir: "frontend",
        data: JSON.stringify({ id, method, params }),
      });
      if (!posted) {
        clearTimeout(timer);
        state.pending.delete(id);
        reject(new Error("the preview frame is gone: restart the project"));
      }
    });
  }

  private post(tabId: string, message: unknown): boolean {
    const frame = this.targets.frame(tabId);
    const contentWindow = frame?.contentWindow;
    if (!contentWindow) return false;
    contentWindow.postMessage(message, "*");
    return true;
  }

  private handleEvent(tabId: string, method: string, params: unknown): void {
    if (!isRecord(params)) return;
    const state = this.stateOf(tabId);
    if (method === "Runtime.consoleAPICalled") {
      const kind = typeof params.type === "string" ? params.type : "log";
      state.console.push({
        kind: (kind === "warning" ? "warn" : kind) as PreviewConsoleEntry["kind"],
        text: consoleText(params),
      });
      if (state.console.length > CONSOLE_BUFFER) state.console.shift();
      return;
    }
    if (method === "Runtime.exceptionThrown") {
      state.console.push({ kind: "exception", text: exceptionText(params) });
      if (state.console.length > CONSOLE_BUFFER) state.console.shift();
      return;
    }
    if (method === "Network.requestWillBeSent") {
      const request = params.request;
      if (!isRecord(request)) return;
      const requestId = typeof params.requestId === "string" ? params.requestId : "";
      if (requestId === "") return;
      const url = typeof request.url === "string" ? request.url : "";
      const requestMethod = typeof request.method === "string" ? request.method : "GET";
      state.network.set(requestId, { method: requestMethod, url });
      const oldest = state.network.keys().next().value;
      if (state.network.size > NETWORK_BUFFER && oldest !== undefined) {
        state.network.delete(oldest);
      }
      return;
    }
    if (method === "Network.responseReceived") {
      const requestId = typeof params.requestId === "string" ? params.requestId : "";
      const entry = state.network.get(requestId);
      const response = params.response;
      if (entry === undefined || !isRecord(response)) return;
      if (typeof response.status === "number") entry.status = response.status;
      return;
    }
    if (method === "Network.loadingFailed") {
      const requestId = typeof params.requestId === "string" ? params.requestId : "";
      const entry = state.network.get(requestId);
      if (entry === undefined) return;
      entry.error =
        typeof params.errorText === "string" && params.errorText.length > 0
          ? params.errorText
          : "request failed";
    }
  }
}
