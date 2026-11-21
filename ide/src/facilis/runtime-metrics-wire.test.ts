import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KernelBridge } from "@/vv/kernel";
import { getRuntimeMetrics, subscribeRuntimeMetrics } from "./runtime-metrics";
import {
  disableRuntimeMetrics,
  enableRuntimeMetrics,
  kernelTokenOf,
  runtimeMetricsSession,
  trustedOriginPredicate,
  type RuntimeMetricsPreview,
} from "./runtime-metrics-wire";

// The IDE's vitest environment is node (no jsdom): install the minimal window/location
// globals the wiring touches, and drive the message listener by hand.
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
const emit = (origin: string, data: unknown) => {
  for (const handler of Array.from(handlers)) handler({ origin, data });
};

const bridge = {
  mode: "same-origin",
  sameOriginPreviewUrl: (port: number, pathAndQuery = "/") =>
    "/preview/" + port + pathAndQuery + "?__vv_kernel=tok-123",
  isTrustedPreviewOrigin: (origin: string) => origin === "https://preview.example",
} as unknown as KernelBridge;

const posted: unknown[] = [];
const preview = {
  activePreviewTab: () => ({ id: "tab1", port: 3000 }),
  frameFor: () => ({ contentWindow: { postMessage: (m: unknown) => posted.push(m) } }),
} as unknown as RuntimeMetricsPreview;

const batch = (token = "tok-123") => ({
  source: "vv-metrics",
  type: "batch",
  token,
  samples: [{ route: "/api/todos", method: "GET", status: 200, duration: 4 }],
});

beforeEach(() => {
  (globalThis as Record<string, unknown>).window = fakeWindow;
  (globalThis as Record<string, unknown>).location = { origin: HERE };
  posted.length = 0;
  handlers.clear();
});

afterEach(() => {
  disableRuntimeMetrics();
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).location;
});

describe("kernelTokenOf", () => {
  it("reads the boot token from the bridge's preview URL", () => {
    expect(kernelTokenOf(bridge)).toBe("tok-123");
  });
  it("null when the URL carries no token", () => {
    const bare = { sameOriginPreviewUrl: () => "/preview/3000/" } as unknown as KernelBridge;
    expect(kernelTokenOf(bare)).toBeNull();
  });
});

describe("trustedOriginPredicate", () => {
  it("same-origin mode trusts only the IDE's own origin", () => {
    const trust = trustedOriginPredicate(bridge);
    expect(trust(HERE)).toBe(true);
    expect(trust("https://evil.example")).toBe(false);
  });
  it("cross-origin modes delegate to the bridge's allowlist", () => {
    const shared = { ...bridge, mode: "shared" } as unknown as KernelBridge;
    const trust = trustedOriginPredicate(shared);
    expect(trust("https://preview.example")).toBe(true);
    expect(trust(HERE)).toBe(false);
  });
});

describe("runtimeMetricsSession", () => {
  it("posts control messages into the active preview frame", () => {
    const session = runtimeMetricsSession(bridge, preview);
    expect(session?.token).toBe("tok-123");
    session?.postToPreview({ hello: true });
    expect(posted).toEqual([{ hello: true }]);
  });
  it("null without a kernel token", () => {
    const bare = { sameOriginPreviewUrl: () => "/preview/3000/" } as unknown as KernelBridge;
    expect(runtimeMetricsSession(bare, preview)).toBeNull();
  });
});

describe("enable/disable wiring", () => {
  it("enable posts the control message with token and routes, and wakes the collector", () => {
    const session = runtimeMetricsSession(bridge, preview);
    expect(session).not.toBeNull();
    if (session === null) return;
    expect(enableRuntimeMetrics(session, ["/api/todos"])).toBe(true);
    expect(posted).toEqual([
      { source: "vv-metrics", type: "enable", token: "tok-123", routes: ["/api/todos"] },
    ]);
    expect(getRuntimeMetrics().isEnabled()).toBe(true);
  });

  it("ingests a valid batch from a trusted origin and notifies subscribers", () => {
    const session = runtimeMetricsSession(bridge, preview);
    if (session === null) throw new Error("session");
    let notified = 0;
    const unsubscribe = subscribeRuntimeMetrics(() => {
      notified++;
    });
    enableRuntimeMetrics(session, ["/api/todos"]);
    const before = notified;
    emit(HERE, batch());
    expect(notified).toBe(before + 1);
    expect(getRuntimeMetrics().snapshot()).toMatchObject([{ route: "/api/todos", count: 1 }]);
    unsubscribe();
  });

  it("rejects messages from an untrusted origin", () => {
    const session = runtimeMetricsSession(bridge, preview);
    if (session === null) throw new Error("session");
    enableRuntimeMetrics(session, ["/api/todos"]);
    emit("https://evil.example", batch());
    expect(getRuntimeMetrics().snapshot()).toEqual([]);
  });

  it("rejects messages without the current kernel token", () => {
    const session = runtimeMetricsSession(bridge, preview);
    if (session === null) throw new Error("session");
    enableRuntimeMetrics(session, ["/api/todos"]);
    emit(HERE, batch("stale-token"));
    emit(HERE, { source: "vv-metrics", type: "batch", samples: batch().samples });
    expect(getRuntimeMetrics().snapshot()).toEqual([]);
  });

  it("disable posts the control, removes the listener and clears the buffer", () => {
    const session = runtimeMetricsSession(bridge, preview);
    if (session === null) throw new Error("session");
    enableRuntimeMetrics(session, ["/api/todos"]);
    emit(HERE, batch());
    disableRuntimeMetrics();
    expect(posted[posted.length - 1]).toEqual({ source: "vv-metrics", type: "disable" });
    expect(handlers.size).toBe(0);
    expect(getRuntimeMetrics().isEnabled()).toBe(false);
    expect(getRuntimeMetrics().snapshot()).toEqual([]);
  });

  it("re-enable replaces the previous listener (no double ingest)", () => {
    const session = runtimeMetricsSession(bridge, preview);
    if (session === null) throw new Error("session");
    enableRuntimeMetrics(session, ["/api/todos"]);
    enableRuntimeMetrics(session, ["/api/todos"]);
    expect(handlers.size).toBe(1);
    emit(HERE, batch());
    expect(getRuntimeMetrics().snapshot()[0]?.count).toBe(1);
  });

  it("returns false without a window (non-browser context)", () => {
    delete (globalThis as Record<string, unknown>).window;
    const session = runtimeMetricsSession(bridge, preview);
    if (session === null) throw new Error("session");
    expect(enableRuntimeMetrics(session, [])).toBe(false);
  });
});
