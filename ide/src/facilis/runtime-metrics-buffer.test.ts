import { describe, expect, it } from "vitest";
import {
  BUCKET_COUNT,
  ROUTE_SAMPLE_CAPACITY,
  ROUTE_WINDOW_MS,
  RouteRingBuffer,
  bucketIndexOf,
  percentileFromBuckets,
  statusClassOf,
} from "./runtime-metrics-buffer";

const T0 = 1_000_000;

describe("bucketIndexOf", () => {
  it("places a duration in the first bucket whose bound exceeds it", () => {
    expect(bucketIndexOf(0)).toBe(0);
    expect(bucketIndexOf(0.9)).toBe(0);
    expect(bucketIndexOf(1)).toBe(1); // bounds are exclusive upper limits
    expect(bucketIndexOf(49.9)).toBe(5);
    expect(bucketIndexOf(50)).toBe(6);
    expect(bucketIndexOf(29_999)).toBe(13);
  });
  it("overflow bucket catches everything at or beyond the last bound", () => {
    expect(bucketIndexOf(30_000)).toBe(BUCKET_COUNT - 1);
    expect(bucketIndexOf(10_000_000)).toBe(BUCKET_COUNT - 1);
  });
});

describe("statusClassOf", () => {
  it("classifies the status ranges the lens reports", () => {
    expect(statusClassOf(200)).toBe("ok");
    expect(statusClassOf(304)).toBe("ok");
    expect(statusClassOf(404)).toBe("clientError");
    expect(statusClassOf(500)).toBe("serverError");
    expect(statusClassOf(599)).toBe("serverError");
    expect(statusClassOf(0)).toBe("other");
    expect(statusClassOf(100)).toBe("other");
  });
});

describe("percentileFromBuckets", () => {
  it("returns the upper bound of the bucket holding the nearest rank", () => {
    // 10 samples: 5 in [0,1), 5 in [1,2). p50 rank 5 -> bucket 0 bound 1.
    const counts = Array.from({ length: BUCKET_COUNT }, () => 0);
    counts[0] = 5;
    counts[1] = 5;
    expect(percentileFromBuckets(counts, 10, 0.5)).toBe(1);
    expect(percentileFromBuckets(counts, 10, 0.95)).toBe(2); // rank 10 -> bucket 1
  });
  it("single sample lands in its own bucket for every percentile", () => {
    const counts = Array.from({ length: BUCKET_COUNT }, () => 0);
    counts[7] = 1; // [100,200)
    expect(percentileFromBuckets(counts, 1, 0.5)).toBe(200);
    expect(percentileFromBuckets(counts, 1, 0.95)).toBe(200);
  });
  it("null for no samples and for a rank in the overflow bucket", () => {
    const counts = Array.from({ length: BUCKET_COUNT }, () => 0);
    expect(percentileFromBuckets(counts, 0, 0.5)).toBeNull();
    counts[BUCKET_COUNT - 1] = 3;
    expect(percentileFromBuckets(counts, 3, 0.95)).toBeNull();
  });
});

describe("RouteRingBuffer", () => {
  it("is empty before any sample and after full expiry", () => {
    const ring = new RouteRingBuffer();
    expect(ring.snapshot(T0)).toBeNull();
    ring.add(T0, 200, 5);
    expect(ring.snapshot(T0 + ROUTE_WINDOW_MS + 1)).toBeNull();
  });

  it("keeps at most ROUTE_SAMPLE_CAPACITY samples, evicting the oldest", () => {
    const ring = new RouteRingBuffer();
    for (let i = 0; i < ROUTE_SAMPLE_CAPACITY + 25; i++) {
      ring.add(T0 + i, 200, 5); // bucket 3 ([5,10))
    }
    const snap = ring.snapshot(T0 + ROUTE_SAMPLE_CAPACITY + 25);
    expect(snap?.count).toBe(ROUTE_SAMPLE_CAPACITY);
    expect(snap?.p50Ms).toBe(10);
    // The 25 oldest entries are gone: expiry at a cutoff that only the evicted
    // entries would have failed must not shrink the ring further.
    const snap2 = ring.snapshot(T0 + ROUTE_SAMPLE_CAPACITY + 25);
    expect(snap2?.count).toBe(ROUTE_SAMPLE_CAPACITY);
  });

  it("expires samples older than the 5 minute window", () => {
    const ring = new RouteRingBuffer();
    ring.add(T0, 200, 5);
    ring.add(T0 + ROUTE_WINDOW_MS - 1, 200, 5);
    ring.add(T0 + ROUTE_WINDOW_MS, 200, 5);
    // The boundary is inclusive: a sample exactly WINDOW old is still in.
    expect(ring.snapshot(T0 + ROUTE_WINDOW_MS)?.count).toBe(3);
    // One tick later the first sample leaves the window.
    expect(ring.snapshot(T0 + ROUTE_WINDOW_MS + 1)?.count).toBe(2);
    expect(ring.snapshot(T0 + 2 * ROUTE_WINDOW_MS + 1)).toBeNull();
  });

  it("counts status classes and excludes aborted requests from latency", () => {
    const ring = new RouteRingBuffer();
    ring.add(T0, 200, 5);
    ring.add(T0 + 1, 404, 5);
    ring.add(T0 + 2, 500, 5);
    ring.add(T0 + 3, 503, 5);
    ring.add(T0 + 4, 0, 500); // aborted: counted, not timed
    const snap = ring.snapshot(T0 + 5);
    expect(snap).toEqual({
      count: 5,
      errors: 2,
      clientErrors: 1,
      aborted: 1,
      p50Ms: 10,
      p95Ms: 10,
    });
  });

  it("keeps histogram counters consistent across eviction and expiry", () => {
    const ring = new RouteRingBuffer();
    // Fill the ring with slow samples, then overwrite with fast ones.
    for (let i = 0; i < ROUTE_SAMPLE_CAPACITY; i++) ring.add(T0 + i, 200, 5000);
    for (let i = 0; i < ROUTE_SAMPLE_CAPACITY; i++) ring.add(T0 + 1000 + i, 200, 0.5);
    const snap = ring.snapshot(T0 + 2000);
    expect(snap?.count).toBe(ROUTE_SAMPLE_CAPACITY);
    expect(snap?.p50Ms).toBe(1); // all slow samples evicted
    expect(snap?.p95Ms).toBe(1);
    // Expire everything: a later add must not see ghost counts.
    ring.add(T0 + 2000 + ROUTE_WINDOW_MS + 10, 500, 50);
    const after = ring.snapshot(T0 + 2000 + ROUTE_WINDOW_MS + 10);
    expect(after).toEqual({
      count: 1,
      errors: 1,
      clientErrors: 0,
      aborted: 0,
      p50Ms: 100,
      p95Ms: 100,
    });
  });

  it("aborted count survives eviction correctly", () => {
    const ring = new RouteRingBuffer();
    for (let i = 0; i < ROUTE_SAMPLE_CAPACITY; i++) ring.add(T0 + i, 0, 10);
    for (let i = 0; i < ROUTE_SAMPLE_CAPACITY; i++) ring.add(T0 + 1000 + i, 200, 1);
    const snap = ring.snapshot(T0 + 2000);
    expect(snap?.aborted).toBe(0);
    expect(snap?.count).toBe(ROUTE_SAMPLE_CAPACITY);
    expect(snap?.p50Ms).toBe(2);
  });
});
