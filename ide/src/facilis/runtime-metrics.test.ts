import { describe, expect, it } from "vitest";
import {
  METRICS_MAX_BATCH_SAMPLES,
  METRICS_MAX_MESSAGE_BYTES,
  METRICS_MAX_ROUTES,
  RuntimeMetricsCollector,
  getRuntimeMetrics,
  notifyRuntimeMetrics,
  parseRuntimeMetricsBatch,
  subscribeRuntimeMetrics,
} from "./runtime-metrics";

const TOKEN = "boot-token-abc";
const sample = (over: Record<string, unknown> = {}) => ({
  route: "/api/todos/{id}",
  method: "GET",
  status: 200,
  duration: 12.5,
  ...over,
});
const batch = (samples: unknown[] = [sample()], token: string = TOKEN) => ({
  source: "vv-metrics",
  type: "batch",
  token,
  samples,
});

describe("parseRuntimeMetricsBatch", () => {
  it("accepts a well-formed batch", () => {
    const result = parseRuntimeMetricsBatch(batch(), TOKEN);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.samples).toEqual([sample()]);
  });

  it("rejects non-objects, wrong source and wrong type", () => {
    for (const data of [null, undefined, 42, "x", []]) {
      expect(parseRuntimeMetricsBatch(data, TOKEN)).toEqual({ ok: false, reason: "not-object" });
    }
    expect(parseRuntimeMetricsBatch({ ...batch(), source: "vv-nav" }, TOKEN).ok).toBe(false);
    expect(parseRuntimeMetricsBatch({ ...batch(), type: "enable" }, TOKEN).ok).toBe(false);
  });

  it("rejects a missing or wrong kernel token", () => {
    const noToken = { source: "vv-metrics", type: "batch", samples: [sample()] };
    expect(parseRuntimeMetricsBatch(noToken, TOKEN)).toEqual({ ok: false, reason: "wrong-token" });
    expect(parseRuntimeMetricsBatch(batch([sample()], "other-boot"), TOKEN)).toEqual({
      ok: false,
      reason: "wrong-token",
    });
    expect(parseRuntimeMetricsBatch(batch([sample()], ""), TOKEN).ok).toBe(false);
    // A stale token from a previous boot must not pass either.
    expect(parseRuntimeMetricsBatch(batch([sample()], TOKEN + "-old"), TOKEN).ok).toBe(false);
  });

  it("rejects a payload above the 64 KiB size cap", () => {
    // 256 samples of a 128-char route is legal (~43 KiB); push past the cap with a
    // long method-legal payload built from many max-length routes.
    const big = batch(
      Array.from({ length: METRICS_MAX_BATCH_SAMPLES }, () =>
        sample({ route: "/" + "a".repeat(127), duration: 1 }),
      ),
    );
    const legal = parseRuntimeMetricsBatch(big, TOKEN);
    expect(legal.ok).toBe(true); // worst legal batch stays under the cap
    const oversized = { ...batch(), padding: "x".repeat(METRICS_MAX_MESSAGE_BYTES) };
    expect(parseRuntimeMetricsBatch(oversized, TOKEN)).toEqual({ ok: false, reason: "too-large" });
  });

  it("rejects malformed batches and samples strictly", () => {
    expect(parseRuntimeMetricsBatch({ ...batch(), samples: [] }, TOKEN)).toEqual({
      ok: false,
      reason: "bad-batch",
    });
    expect(parseRuntimeMetricsBatch({ ...batch(), samples: "nope" }, TOKEN)).toEqual({
      ok: false,
      reason: "bad-batch",
    });
    expect(
      parseRuntimeMetricsBatch(
        batch(Array.from({ length: METRICS_MAX_BATCH_SAMPLES + 1 }, () => sample())),
        TOKEN,
      ),
    ).toEqual({ ok: false, reason: "bad-batch" });
    const badSamples = [
      sample({ route: "/api/todos/123?secret=x" }), // query string leak
      sample({ route: "/api/todos#frag" }),
      sample({ route: "api/todos" }), // not absolute
      sample({ route: "/" + "a".repeat(128) }), // too long
      sample({ route: 42 }),
      sample({ method: "FETCH" }),
      sample({ method: "get" }), // contract is uppercase
      sample({ status: 200.5 }),
      sample({ status: 600 }),
      sample({ status: -1 }),
      sample({ status: "200" }),
      sample({ duration: -1 }),
      sample({ duration: Number.NaN }),
      sample({ duration: Number.POSITIVE_INFINITY }),
      sample({ duration: 3_600_001 }),
      null,
    ];
    for (const bad of badSamples) {
      const result = parseRuntimeMetricsBatch(batch([sample(), bad]), TOKEN);
      expect(result, JSON.stringify(bad)).toEqual({ ok: false, reason: "bad-sample" });
    }
  });

  it("accepts status 0 (aborted) and the full legal status range", () => {
    for (const status of [0, 100, 200, 404, 500, 599]) {
      expect(parseRuntimeMetricsBatch(batch([sample({ status })]), TOKEN).ok).toBe(true);
    }
  });

  it("rejects a cyclic payload without throwing", () => {
    const cyclic: Record<string, unknown> = batch();
    cyclic["self"] = cyclic;
    expect(parseRuntimeMetricsBatch(cyclic, TOKEN)).toEqual({ ok: false, reason: "bad-batch" });
  });
});

describe("RuntimeMetricsCollector", () => {
  it("is dormant until enabled and ignores messages while disabled", () => {
    const collector = new RuntimeMetricsCollector();
    expect(collector.isEnabled()).toBe(false);
    expect(collector.ingest(batch(), TOKEN, 1000)).toEqual({ ok: false, reason: "disabled" });
    expect(collector.snapshot(1000)).toEqual([]);
  });

  it("buffers per route and reports windowed facts", () => {
    const collector = new RuntimeMetricsCollector();
    collector.enable(["/api/todos/{id}", "/api/todos"]);
    expect(
      collector.ingest(
        batch([
          sample({ route: "/api/todos/{id}", status: 200, duration: 5 }),
          sample({ route: "/api/todos/{id}", status: 500, duration: 5 }),
          sample({ route: "/api/todos", status: 404, duration: 5 }),
        ]),
        TOKEN,
        1000,
      ).ok,
    ).toBe(true);
    const rows = collector.snapshot(1001);
    expect(rows.map((r) => r.route)).toEqual(["/api/todos", "/api/todos/{id}"]);
    expect(rows[1]).toMatchObject({ count: 2, errors: 1, clientErrors: 0 });
    expect(rows[0]).toMatchObject({ count: 1, errors: 0, clientErrors: 1 });
  });

  it("drops samples for routes outside the enable list", () => {
    const collector = new RuntimeMetricsCollector();
    collector.enable(["/api/todos"]);
    collector.ingest(batch([sample({ route: "/api/other" })]), TOKEN, 1000);
    expect(collector.snapshot(1001)).toEqual([]);
  });

  it("rejects a wrong-token message even while enabled", () => {
    const collector = new RuntimeMetricsCollector();
    collector.enable(["/api/todos/{id}"]);
    expect(collector.ingest(batch([sample()], "stolen"), TOKEN, 1000)).toEqual({
      ok: false,
      reason: "wrong-token",
    });
    expect(collector.snapshot(1001)).toEqual([]);
  });

  it("bounds the number of tracked routes", () => {
    const collector = new RuntimeMetricsCollector();
    const routes = Array.from({ length: METRICS_MAX_ROUTES + 10 }, (_, i) => "/r/" + i);
    collector.enable(routes);
    // Two legal batches (the per-message cap is 256 samples).
    collector.ingest(batch(routes.slice(0, 256).map((route) => sample({ route }))), TOKEN, 1000);
    collector.ingest(batch(routes.slice(256).map((route) => sample({ route }))), TOKEN, 1000);
    expect(collector.snapshot(1001).length).toBe(METRICS_MAX_ROUTES);
  });

  it("disable clears the buffers and re-enable starts fresh", () => {
    const collector = new RuntimeMetricsCollector();
    collector.enable(["/api/todos/{id}"]);
    collector.ingest(batch(), TOKEN, 1000);
    collector.disable();
    expect(collector.snapshot(1001)).toEqual([]);
    collector.enable(["/api/todos/{id}"]);
    expect(collector.snapshot(1001)).toEqual([]);
  });

  it("expires samples out of the 5 minute window on snapshot", () => {
    const collector = new RuntimeMetricsCollector();
    collector.enable(["/api/todos/{id}"]);
    collector.ingest(batch(), TOKEN, 1000);
    expect(collector.snapshot(1000 + 5 * 60 * 1000 + 1)).toEqual([]);
  });
});

describe("module seam", () => {
  it("notifies subscribers and unsubscribes cleanly", () => {
    let calls = 0;
    const unsubscribe = subscribeRuntimeMetrics(() => {
      calls++;
    });
    notifyRuntimeMetrics();
    expect(calls).toBe(1);
    unsubscribe();
    notifyRuntimeMetrics();
    expect(calls).toBe(1);
    expect(getRuntimeMetrics().isEnabled()).toBe(false);
  });
});
