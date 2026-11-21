// The runtime lens store's contract (issue #72). The headline test feeds IDENTICAL samples to
// the #71 collector and the store and asserts the 5-minute window is exactly equal at the same
// now — including ring-cap overflow, aborted requests and null percentiles. The render-count
// tests drive the store's routeSource pair through useSyncExternalStore's documented contract
// (a store notification re-renders the subscriber only when getSnapshot's identity changed):
// ide/ ships no jsdom, so this is the mechanism a route card's re-render count is made of.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNTIME_WINDOW,
  RUNTIME_HISTORY_CAP,
  RUNTIME_SPARK_BUCKETS,
  RUNTIME_WINDOW_IDS,
  RuntimeLensStore,
  getRuntimeLensStore,
  heatOf,
  normalizeRouteTemplate,
  routeTemplatesOf,
  runtimeLod,
  type RuntimeWindow,
} from "./graph-runtime";
import {
  RuntimeMetricsCollector,
  parseRuntimeMetricsBatch,
  type RuntimeMetricSample,
} from "./runtime-metrics";
import type { ProjectGraphNode } from "./graph-model";

const T0 = 1_700_000_000_000;
const TOKEN = "boot-token";
const A = "/api/todos";
const B = "/api/todos/{id}";

const sample = (over: Partial<RuntimeMetricSample> = {}): RuntimeMetricSample => ({
  route: A,
  method: "GET",
  status: 200,
  duration: 12,
  ...over,
});

/** Feed one batch to both the collector and the store at the same now. */
function feedBoth(
  collector: RuntimeMetricsCollector,
  store: RuntimeLensStore,
  samples: RuntimeMetricSample[],
  now: number,
): void {
  const batch = { source: "vv-metrics", type: "batch", token: TOKEN, samples };
  const parsed = parseRuntimeMetricsBatch(batch, TOKEN);
  expect(parsed.ok).toBe(true);
  const result = collector.ingest(batch, TOKEN, now);
  expect(result.ok).toBe(true);
  store.ingest(samples, now);
}

function expectWindowsEqual(
  collector: RuntimeMetricsCollector,
  store: RuntimeLensStore,
  now: number,
): void {
  // Align the store's observed now with the comparison instant (the wire's shared now).
  store.tick(now);
  const rows = collector.snapshot(now);
  for (const row of rows) {
    const stats = store.viewFor(row.route, "5m").stats;
    expect(stats, row.route).not.toBeNull();
    expect(stats).toMatchObject({
      count: row.count,
      errors: row.errors,
      clientErrors: row.clientErrors,
      aborted: row.aborted,
      p50Ms: row.p50Ms,
      p95Ms: row.p95Ms,
    });
  }
  // Routes the collector does not report must be empty in the store's 5m window too.
  for (const route of [A, B]) {
    if (!rows.some((row) => row.route === route)) {
      expect(store.viewFor(route, "5m").stats, route).toBeNull();
    }
  }
}

/**
 * A faithful useSyncExternalStore external-update runner: initial render reads the snapshot,
 * then each notification re-renders ONLY when the snapshot identity changed. renders() is the
 * count of store-driven renders a bound route card would perform.
 */
function bind(source: { subscribe: (l: () => void) => () => void; getSnapshot: () => unknown }) {
  let renders = 1;
  let snapshot = source.getSnapshot();
  const unsubscribe = source.subscribe(() => {
    const next = source.getSnapshot();
    if (next !== snapshot) {
      snapshot = next;
      renders += 1;
    }
  });
  return { renders: () => renders, snapshot: () => snapshot, unsubscribe };
}

describe("normalizeRouteTemplate", () => {
  it("keeps the analyzer's brace spelling and normalises hand-built brackets", () => {
    expect(normalizeRouteTemplate("/api/todos/{id}")).toBe("/api/todos/{id}");
    expect(normalizeRouteTemplate("/api/todos/[id]")).toBe("/api/todos/{id}");
    expect(normalizeRouteTemplate("/api/todos/[[id]]")).toBe("/api/todos/{id?}");
    expect(normalizeRouteTemplate("/files/[...slug]")).toBe("/files/{...slug}");
    expect(normalizeRouteTemplate("/files/[[...slug]]")).toBe("/files/{...slug?}");
    expect(normalizeRouteTemplate("/api/todos")).toBe("/api/todos");
    expect(normalizeRouteTemplate("/api/{id}/items/[item]")).toBe("/api/{id}/items/{item}");
  });
});

const routeNode = (path: string, method: string): ProjectGraphNode =>
  ({
    id: "route:" + method + " " + path,
    data: { kind: "route", path, method },
  }) as ProjectGraphNode;

describe("routeTemplatesOf", () => {
  it("deduplicates templates across methods and spellings, keeping route nodes only", () => {
    const nodes = [
      routeNode("/api/todos", "GET"),
      routeNode("/api/todos", "POST"),
      routeNode("/api/todos/[id]", "GET"),
      routeNode("/api/todos/{id}", "PATCH"),
      { id: "table:todos", data: { kind: "table" } } as ProjectGraphNode,
    ];
    expect(routeTemplatesOf(nodes)).toEqual(["/api/todos", "/api/todos/{id}"]);
  });
});

describe("heatOf and runtimeLod", () => {
  it("quantises the count to five buckets above zero; zero stays empty", () => {
    const cases: [number, number][] = [
      [0, 0],
      [1, 1],
      [4, 1],
      [5, 2],
      [24, 2],
      [25, 3],
      [99, 3],
      [100, 4],
      [499, 4],
      [500, 5],
      [100_000, 5],
    ];
    for (const [count, level] of cases) expect(heatOf(count), String(count)).toBe(level);
  });
  it("compacts to the corner dot below the local zoom threshold (#60 will subsume)", () => {
    expect(runtimeLod(0.54)).toBe("chip");
    expect(runtimeLod(0.55)).toBe("detailed");
    expect(runtimeLod(1)).toBe("detailed");
  });
});

describe("window stats", () => {
  it("counts per window with the ring's cutoff convention (at === cutoff stays)", () => {
    const store = new RuntimeLensStore();
    store.enable([A]);
    // Chronological, like the wire's Date.now() sequence: the ring's expiry walks from the
    // oldest entry and assumes non-decreasing timestamps.
    store.ingest([sample()], T0 - 900_000); // exactly the 15m cutoff at T0
    store.ingest([sample()], T0 - 300_000); // exactly the 5m cutoff at T0
    store.ingest([sample()], T0 - 60_000); // exactly the 1m cutoff at T0
    store.ingest([sample()], T0);
    expect(store.viewFor(A, "1m").stats?.count).toBe(2);
    expect(store.viewFor(A, "5m").stats?.count).toBe(3);
    expect(store.viewFor(A, "15m").stats?.count).toBe(4);
    store.tick(T0 + 1);
    expect(store.viewFor(A, "1m").stats?.count).toBe(1);
    expect(store.viewFor(A, "5m").stats?.count).toBe(2);
    expect(store.viewFor(A, "15m").stats?.count).toBe(3);
  });

  it("separates 5xx errors, 4xx client errors and aborts; errorRate is 5xx only", () => {
    const store = new RuntimeLensStore();
    store.enable([A]);
    store.ingest(
      [
        sample({ status: 200 }),
        sample({ status: 401 }),
        sample({ status: 503 }),
        sample({ status: 0, duration: 5 }),
      ],
      T0,
    );
    for (const window of RUNTIME_WINDOW_IDS) {
      const stats = store.viewFor(A, window).stats;
      expect(stats).toMatchObject({ count: 4, errors: 1, clientErrors: 1, aborted: 1 });
      expect(stats?.errorRate).toBe(0.25);
    }
  });

  it("keeps null percentiles null (overflow bucket), never a fabricated number", () => {
    const store = new RuntimeLensStore();
    store.enable([A]);
    store.ingest([sample({ duration: 40_000 }), sample({ duration: 50_000 })], T0);
    const stats = store.viewFor(A, "5m").stats;
    expect(stats?.p50Ms).toBeNull();
    expect(stats?.p95Ms).toBeNull();
  });

  it("empty is null stats with an all-zero sparkline — distinct from healthy traffic", () => {
    const store = new RuntimeLensStore();
    store.enable([A]);
    const empty = store.viewFor(A, "5m");
    expect(empty.stats).toBeNull();
    expect(empty.spark).toHaveLength(RUNTIME_SPARK_BUCKETS);
    expect(empty.spark.every((value) => value === 0)).toBe(true);
    store.ingest([sample()], T0);
    const healthy = store.viewFor(A, "5m");
    expect(healthy.stats).not.toBeNull();
    expect(healthy.stats?.errors).toBe(0);
    expect(healthy.stats?.heat).toBe(1);
  });

  it("drops samples for routes outside the enable list, like the collector", () => {
    const store = new RuntimeLensStore();
    store.enable([A]);
    store.ingest([sample({ route: B })], T0);
    expect(store.viewFor(B, "5m").stats).toBeNull();
    expect(store.viewFor(A, "5m").stats).toBeNull();
  });
});

describe("5-minute window equals collector.snapshot() exactly", () => {
  it("matches for mixed traffic across many instants", () => {
    const collector = new RuntimeMetricsCollector();
    const store = new RuntimeLensStore();
    collector.enable([A, B]);
    store.enable([A, B]);
    let now = T0;
    const statuses = [200, 201, 301, 401, 404, 500, 503, 0, 100];
    for (let round = 0; round < 40; round += 1) {
      const samples: RuntimeMetricSample[] = statuses.map((status, index) =>
        sample({
          route: index % 2 === 0 ? A : B,
          status,
          duration: status === 0 ? 3 : (index * 37) % 45_000,
        }),
      );
      feedBoth(collector, store, samples, now);
      expectWindowsEqual(collector, store, now);
      now += 7_000;
      // Expiry instants between batches must agree too.
      expectWindowsEqual(collector, store, now);
    }
  });

  it("matches when the 1000-sample ring overflows within the window", () => {
    const collector = new RuntimeMetricsCollector();
    const store = new RuntimeLensStore();
    collector.enable([A]);
    store.enable([A]);
    const samples = Array.from({ length: 1200 }, (_, index) =>
      sample({ duration: (index % 30) * 1000, status: index % 7 === 0 ? 500 : 200 }),
    );
    // The message contract caps a batch at 256 samples: feed legal chunks at the same now.
    for (let start = 0; start < samples.length; start += 256) {
      feedBoth(collector, store, samples.slice(start, start + 256), T0);
    }
    expectWindowsEqual(collector, store, T0);
    expect(store.viewFor(A, "5m").stats?.count).toBe(1000);
    // The raw history keeps more than the ring (documented bound): the 15m window sees all.
    expect(store.viewFor(A, "15m").stats?.count).toBe(1200);
    expectWindowsEqual(collector, store, T0 + 120_000);
  });

  it("matches at the exact expiry boundary and after full expiry", () => {
    const collector = new RuntimeMetricsCollector();
    const store = new RuntimeLensStore();
    collector.enable([A]);
    store.enable([A]);
    feedBoth(collector, store, [sample()], T0 - 300_000);
    expectWindowsEqual(collector, store, T0); // at the cutoff: still in
    expectWindowsEqual(collector, store, T0 + 1); // one ms past: gone
  });
});

describe("sparkline", () => {
  it("spans the selected window with 60 buckets of width window/60", () => {
    const store = new RuntimeLensStore();
    store.enable([A]);
    store.ingest([sample()], T0 - 59_500); // first bucket of the 1m window
    store.ingest([sample()], T0 - 30_000); // middle bucket (30)
    store.ingest([sample(), sample()], T0); // now -> last bucket
    const spark = store.viewFor(A, "1m").spark;
    expect(spark).toHaveLength(60);
    expect(spark[0]).toBe(1);
    expect(spark[30]).toBe(1);
    expect(spark[59]).toBe(2);
    expect(spark.reduce((sum, value) => sum + value, 0)).toBe(4);
    // The same traffic lands in different buckets for the 5m window (width 5 s):
    // (300000-59500)/5000 = 48.1 -> 48; (300000-30000)/5000 = 54; now clamps to 59.
    const wide = store.viewFor(A, "5m").spark;
    expect(wide[48]).toBe(1);
    expect(wide[54]).toBe(1);
    expect(wide[59]).toBe(2);
  });

  it("scrolls with the live tick without new traffic", () => {
    const store = new RuntimeLensStore();
    store.enable([A]);
    store.ingest([sample()], T0);
    expect(store.viewFor(A, "1m").spark[59]).toBe(1);
    store.tick(T0 + 2_000); // two 1s buckets of scroll
    const spark = store.viewFor(A, "1m").spark;
    expect(spark[59]).toBe(0);
    expect(spark[58]).toBe(1);
  });

  it("keeps the bucket sum equal to the window count while under the history cap", () => {
    const store = new RuntimeLensStore();
    store.enable([A]);
    for (let index = 0; index < 300; index += 1) {
      store.ingest([sample()], T0 - (299 - index) * 2_000); // ascending, ending at T0
    }
    for (const window of RUNTIME_WINDOW_IDS) {
      const view = store.viewFor(A, window);
      const sum = view.spark.reduce((total, value) => total + value, 0);
      expect(sum, window).toBe(view.stats?.count ?? 0);
    }
  });
});

describe("per-route render granularity (useSyncExternalStore contract)", () => {
  it("a batch touching route A re-renders A only; B's snapshot identity holds", () => {
    const store = new RuntimeLensStore();
    store.enable([A, B]);
    store.setLive(true, T0);
    const cardA = bind(store.routeSource(A, "5m"));
    const cardB = bind(store.routeSource(B, "5m"));
    const bSnapshot = cardB.snapshot();
    store.ingest([sample({ route: A })], T0 + 1_000);
    expect(cardA.renders()).toBe(2);
    expect(cardB.renders()).toBe(1);
    expect(cardB.snapshot()).toBe(bSnapshot);
    expect(store.viewFor(B, "5m")).toBe(bSnapshot);
    store.ingest([sample({ route: B })], T0 + 2_000);
    expect(cardA.renders()).toBe(2);
    expect(cardB.renders()).toBe(2);
    cardA.unsubscribe();
    cardB.unsubscribe();
  });

  it("a tick with no expiry and no new traffic re-renders nobody", () => {
    const store = new RuntimeLensStore();
    store.enable([A, B]);
    store.setLive(true, T0);
    store.ingest([sample({ route: A }), sample({ route: B })], T0);
    const cardA = bind(store.routeSource(A, "5m"));
    const cardB = bind(store.routeSource(B, "5m"));
    // Within one 5s sparkline bucket: no expiry, no scroll, no re-render.
    for (let tick = 1; tick <= 4; tick += 1) store.tick(T0 + tick * 1_000);
    expect(cardA.renders()).toBe(1);
    expect(cardB.renders()).toBe(1);
    cardA.unsubscribe();
    cardB.unsubscribe();
  });

  it("window expiry re-renders only the route whose window moved", () => {
    const store = new RuntimeLensStore();
    store.enable([A, B]);
    store.setLive(true, T0);
    store.ingest([sample({ route: A })], T0);
    store.ingest([sample({ route: B })], T0 + 59_000);
    const cardA = bind(store.routeSource(A, "1m"));
    const cardB = bind(store.routeSource(B, "5m"));
    store.tick(T0 + 61_000); // A's sample left the 1m window; B's 5m view is unmoved
    expect(cardA.renders()).toBe(2);
    expect(cardA.snapshot()).toMatchObject({ stats: null });
    expect(cardB.renders()).toBe(1);
    cardA.unsubscribe();
    cardB.unsubscribe();
  });

  it("the window change reads a different cached view without touching other routes", () => {
    const store = new RuntimeLensStore();
    store.enable([A]);
    store.ingest([sample()], T0 - 120_000); // outside 1m, inside 5m
    store.tick(T0); // observe at T0, like the live tick would
    const narrow = store.viewFor(A, "1m");
    const wide = store.viewFor(A, "5m");
    expect(narrow.stats).toBeNull();
    expect(wide.stats?.count).toBe(1);
    expect(store.viewFor(A, "1m")).toBe(narrow);
    expect(store.viewFor(A, "5m")).toBe(wide);
  });
});

describe("live mode", () => {
  it("live off accumulates history without notifying; reads recompute lazily", () => {
    const store = new RuntimeLensStore();
    store.enable([A]);
    store.setLive(false, T0);
    const card = bind(store.routeSource(A, "5m"));
    store.ingest([sample()], T0 + 1_000);
    expect(card.renders()).toBe(1); // frozen on the last snapshot
    store.setLive(true, T0 + 2_000);
    expect(card.renders()).toBe(2); // live on catches the surface up immediately
    expect(card.snapshot()).toMatchObject({ stats: { count: 1 } });
    // A user action while live off reads fresh data lazily — and that read already catches
    // the cached window up, so live on adds no render (identity-stable catch-up).
    store.setLive(false, T0 + 3_000);
    store.ingest([sample()], T0 + 4_000);
    expect(card.renders()).toBe(2);
    expect(store.viewFor(A, "5m").stats?.count).toBe(2);
    store.setLive(true, T0 + 5_000);
    expect(card.renders()).toBe(2);
    // Every window reads fresh at the last observed now, not only the bound one.
    expect(store.viewFor(A, "1m").stats?.count).toBe(2);
    card.unsubscribe();
  });

  it("live on notifies per batch; the tick keeps the sparkline scrolling", () => {
    const store = new RuntimeLensStore();
    store.enable([A]);
    store.setLive(true, T0);
    const card = bind(store.routeSource(A, "1m"));
    store.ingest([sample()], T0);
    expect(card.renders()).toBe(2);
    store.tick(T0 + 2_000);
    expect(card.renders()).toBe(3); // sparkline scrolled one bucket
    card.unsubscribe();
  });
});

describe("bounds and disposal", () => {
  it("caps the raw history per route at RUNTIME_HISTORY_CAP entries", () => {
    const store = new RuntimeLensStore();
    store.enable([A]);
    const total = RUNTIME_HISTORY_CAP + 500;
    for (let index = 0; index < total; index += 250) {
      const batch = Array.from({ length: Math.min(250, total - index) }, () => sample());
      store.ingest(batch, T0 + index * 100);
    }
    // Oldest entries dropped: the 15m window undercounts under sustained load (documented).
    expect(store.viewFor(A, "15m").stats?.count).toBe(RUNTIME_HISTORY_CAP);
    // The 5m window stays exact because it reads the collector's ring.
    expect(store.viewFor(A, "5m").stats?.count).toBe(1000);
  });

  it("caps tracked routes at METRICS_MAX_ROUTES like the collector", () => {
    const store = new RuntimeLensStore();
    const routes = Array.from({ length: 300 }, (_, index) => "/api/r" + index);
    store.enable(routes);
    store.ingest(
      routes.map((route) => sample({ route })),
      T0,
    );
    expect(store.viewFor(routes[0] as string, "5m").stats?.count).toBe(1);
    expect(store.viewFor(routes[255] as string, "5m").stats?.count).toBe(1);
    expect(store.viewFor(routes[299] as string, "5m").stats).toBeNull();
  });

  it("dispose clears history, subscribers and the enable list", () => {
    const store = new RuntimeLensStore();
    store.enable([A]);
    store.setLive(true, T0);
    store.ingest([sample()], T0);
    const card = bind(store.routeSource(A, "5m"));
    expect(store.subscriberCount(A)).toBe(1);
    store.dispose();
    expect(store.subscriberCount(A)).toBe(0);
    expect(store.viewFor(A, "5m").stats).toBeNull();
    store.ingest([sample()], T0 + 1_000); // no enable list: dropped
    expect(store.viewFor(A, "5m").stats).toBeNull();
    expect(card.renders()).toBe(1);
    card.unsubscribe();
  });

  it("re-enable resets the history (analysis refresh starts clean)", () => {
    const store = new RuntimeLensStore();
    store.enable([A]);
    store.ingest([sample()], T0);
    store.enable([A, B]);
    expect(store.viewFor(A, "5m").stats).toBeNull();
    store.ingest([sample({ route: B })], T0);
    expect(store.viewFor(B, "5m").stats?.count).toBe(1);
  });

  it("the module singleton is the same store every call", () => {
    expect(getRuntimeLensStore()).toBe(getRuntimeLensStore());
  });
});

describe("defaults", () => {
  it("ships 1m/5m/15m windows with 5m selected", () => {
    expect(RUNTIME_WINDOW_IDS).toEqual(["1m", "5m", "15m"]);
    expect(DEFAULT_RUNTIME_WINDOW).toBe("5m");
    const widths: Record<RuntimeWindow, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000 };
    for (const window of RUNTIME_WINDOW_IDS) {
      expect(widths[window] / RUNTIME_SPARK_BUCKETS).toBeGreaterThan(0);
    }
  });
});
