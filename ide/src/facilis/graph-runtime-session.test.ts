// The runtime lens session's lifecycle (issue #72) — the acceptance leak check: activation
// owns exactly one window listener, one sample-tap subscription and (live only) one repaint
// subscription + one interval; deactivation drops ALL of them and resets the store. The node
// vitest has no jsdom, so window/timers are fakes driven by hand, the runtime-metrics-wire
// pattern. The React hook is a thin wrapper over this factory, so this is the hook's cleanup.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KernelBridge } from "@/vv/kernel";
import { getRuntimeMetrics } from "./runtime-metrics";
import {
  disableRuntimeMetrics,
  enableRuntimeMetrics,
  runtimeMetricsSession,
  type RuntimeMetricsPreview,
} from "./runtime-metrics-wire";
import { getRuntimeLensStore } from "./graph-runtime";
import { RUNTIME_TICK_MS, createRuntimeLensSession } from "./graph-runtime-session";

type MessageHandler = (event: { origin: string; data: unknown }) => void;
const handlers = new Set<MessageHandler>();
const fakeWindow = {
  addEventListener: (type: string, fn: MessageHandler) => {
    if (type === "message") handlers.add(fn);
  },
  removeEventListener: (type: string, fn: MessageHandler) => {
    if (type === "message") handlers.delete(fn);
  },
};
const HERE = "http://localhost:5173";
const emit = (data: unknown) => {
  for (const handler of Array.from(handlers)) handler({ origin: HERE, data });
};

const bridge = {
  mode: "same-origin",
  sameOriginPreviewUrl: () => "/preview/3000/?__vv_kernel=tok-123",
  isTrustedPreviewOrigin: () => false,
} as unknown as KernelBridge;
const posted: unknown[] = [];
const preview = {
  activePreviewTab: () => ({ id: "tab1", port: 3000 }),
  frameFor: () => ({ contentWindow: { postMessage: (m: unknown) => posted.push(m) } }),
} as unknown as RuntimeMetricsPreview;

const batch = (route = "/api/todos", status = 200) => ({
  source: "vv-metrics",
  type: "batch",
  token: "tok-123",
  samples: [{ route, method: "GET", status, duration: 4 }],
});

// Hand-driven timers: the leak check counts them, the tick test fires them.
const intervals = new Map<number, { fn: () => void; ms: number }>();
let nextTimerId = 1;
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;

const NOW = 1_700_000_000_000;
const buildSession = () => runtimeMetricsSession(bridge, preview);

beforeEach(() => {
  (globalThis as Record<string, unknown>).window = fakeWindow;
  (globalThis as Record<string, unknown>).location = { origin: HERE };
  (globalThis as Record<string, unknown>).setInterval = (fn: () => void, ms: number) => {
    const id = nextTimerId++;
    intervals.set(id, { fn, ms });
    return id;
  };
  (globalThis as Record<string, unknown>).clearInterval = (id: number) => {
    intervals.delete(id);
  };
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  posted.length = 0;
  handlers.clear();
  intervals.clear();
});

afterEach(() => {
  disableRuntimeMetrics();
  getRuntimeLensStore().dispose();
  vi.restoreAllMocks();
  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).location;
});

describe("activation", () => {
  it("enables the seam with the templates and accumulates tapped samples", () => {
    const session = createRuntimeLensSession(buildSession);
    session.activate(["/api/todos"], false);
    expect(session.isActive()).toBe(true);
    expect(handlers.size).toBe(1);
    expect(posted[0]).toEqual({
      source: "vv-metrics",
      type: "enable",
      token: "tok-123",
      routes: ["/api/todos"],
    });
    expect(getRuntimeMetrics().isEnabled()).toBe(true);
    emit(batch());
    // Live off: history still accumulates (the store reads it on the next user action).
    expect(getRuntimeLensStore().viewFor("/api/todos", "5m").stats?.count).toBe(1);
    session.deactivate();
  });

  it("a null session (no kernel token) keeps the empty state and never throws", () => {
    const session = createRuntimeLensSession(() => null);
    session.activate(["/api/todos"], true);
    expect(session.isActive()).toBe(true);
    expect(handlers.size).toBe(0); // no wire without a token
    expect(getRuntimeMetrics().isEnabled()).toBe(false);
    expect(getRuntimeLensStore().viewFor("/api/todos", "5m").stats).toBeNull();
    session.deactivate();
    // Deactivation must not post a disable for a session it never woke.
    expect(posted).toEqual([]);
  });

  it("re-activation (analysis refresh) replaces the listener and resets the history", () => {
    const session = createRuntimeLensSession(buildSession);
    session.activate(["/api/todos"], false);
    emit(batch());
    session.activate(["/api/todos", "/api/todos/{id}"], false);
    expect(handlers.size).toBe(1);
    expect(getRuntimeLensStore().viewFor("/api/todos", "5m").stats).toBeNull();
    emit(batch("/api/todos/{id}"));
    expect(getRuntimeLensStore().viewFor("/api/todos/{id}", "5m").stats?.count).toBe(1);
    session.deactivate();
  });
});

describe("live mode", () => {
  it("live on adds exactly one interval and a repaint subscription; live off removes both", () => {
    const session = createRuntimeLensSession(buildSession);
    session.activate(["/api/todos"], false);
    expect(intervals.size).toBe(0);
    session.setLive(true);
    expect(intervals.size).toBe(1);
    expect([...intervals.values()][0]?.ms).toBe(RUNTIME_TICK_MS);
    session.setLive(false);
    expect(intervals.size).toBe(0);
    session.setLive(true);
    expect(intervals.size).toBe(1);
    session.deactivate();
    expect(intervals.size).toBe(0);
  });

  it("the interval tick expires windows without new traffic", () => {
    const session = createRuntimeLensSession(buildSession);
    session.activate(["/api/todos"], true);
    emit(batch());
    const store = getRuntimeLensStore();
    expect(store.viewFor("/api/todos", "1m").stats?.count).toBe(1);
    vi.spyOn(Date, "now").mockReturnValue(NOW + 61_000);
    const tick = [...intervals.values()][0]?.fn;
    tick?.();
    expect(store.viewFor("/api/todos", "1m").stats).toBeNull();
    session.deactivate();
  });

  it("live off freezes the surfaces: a batch accumulates but notifies nobody", () => {
    const session = createRuntimeLensSession(buildSession);
    session.activate(["/api/todos"], false);
    const store = getRuntimeLensStore();
    let notified = 0;
    const unsubscribe = store.subscribeRoute("/api/todos", () => {
      notified += 1;
    });
    // The mounted card's initial render caches the (empty) snapshot.
    expect(store.viewFor("/api/todos", "5m").stats).toBeNull();
    emit(batch());
    expect(notified).toBe(0); // live off: frozen surface
    expect(store.viewFor("/api/todos", "5m").stats?.count).toBe(1); // lazy read is fresh
    session.setLive(true);
    // The lazy read already caught the surface up: identical data, no re-render.
    expect(notified).toBe(0);
    emit(batch());
    expect(notified).toBe(1);
    unsubscribe();
    session.deactivate();
  });
});

describe("deactivation leak check (acceptance criterion 6)", () => {
  it("drops the listener, the tap, the repaint, the interval and the store state", () => {
    const session = createRuntimeLensSession(buildSession);
    session.activate(["/api/todos"], true);
    const store = getRuntimeLensStore();
    let notified = 0;
    const unsubscribe = store.subscribeRoute("/api/todos", () => {
      notified += 1;
    });
    // The mounted card's initial render caches the (empty) snapshot.
    expect(store.viewFor("/api/todos", "5m").stats).toBeNull();
    emit(batch());
    expect(notified).toBe(1);
    expect(store.subscriberCount("/api/todos")).toBe(1);

    session.deactivate();

    expect(session.isActive()).toBe(false);
    expect(handlers.size).toBe(0); // window listener gone
    expect(intervals.size).toBe(0); // timer gone
    expect(getRuntimeMetrics().isEnabled()).toBe(false); // collector asleep
    expect(posted[posted.length - 1]).toEqual({ source: "vv-metrics", type: "disable" });
    expect(store.subscriberCount("/api/todos")).toBe(0); // store subscriptions cleared
    expect(store.viewFor("/api/todos", "5m").stats).toBeNull(); // history cleared
    // Nothing reaches the store anymore: neither the tap nor repaints are subscribed.
    emit(batch());
    expect(notified).toBe(1);
    expect(store.viewFor("/api/todos", "5m").stats).toBeNull();
    unsubscribe();
  });

  it("deactivating an inactive session is a silent no-op", () => {
    const session = createRuntimeLensSession(buildSession);
    session.deactivate();
    expect(handlers.size).toBe(0);
    expect(intervals.size).toBe(0);
    expect(posted).toEqual([]);
  });

  it("does not sleep a seam it never woke (the dev handle may own it)", () => {
    // The dev handle enables the collector directly, without the lens.
    const devSession = runtimeMetricsSession(bridge, preview);
    if (devSession === null) throw new Error("session");
    expect(enableRuntimeMetrics(devSession, ["/api/todos"])).toBe(true);
    const session = createRuntimeLensSession(() => null);
    session.activate(["/api/todos"], false);
    session.deactivate();
    expect(getRuntimeMetrics().isEnabled()).toBe(true); // the dev handle's session survives
    disableRuntimeMetrics();
  });
});
