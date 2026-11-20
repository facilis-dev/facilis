// Per-route runtime metrics storage (D-200, issue #71): a bounded ring of samples plus
// an incrementally maintained latency histogram. Percentiles come from the buckets,
// never from sorting raw latencies, so a route's memory is O(capacity) small entries
// plus a fixed 15-counter histogram regardless of traffic.
//
// Pure and clock-agnostic: every operation takes the caller's timestamp, which keeps
// the module unit-testable in the IDE's node vitest environment (no jsdom).

/** Samples kept per route; the oldest is overwritten when the ring is full. */
export const ROUTE_SAMPLE_CAPACITY = 1000;
/** Samples older than this leave the window (and the histogram) on the next touch. */
export const ROUTE_WINDOW_MS = 5 * 60 * 1000;
/**
 * Latency bucket upper bounds in ms. The last bucket is overflow (>= 30 s) and reports
 * a null percentile: "beyond the measurable range", not a fabricated number.
 */
export const LATENCY_BOUNDS_MS: readonly number[] = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000,
];
export const BUCKET_COUNT = LATENCY_BOUNDS_MS.length + 1;

export type StatusClass = "ok" | "clientError" | "serverError" | "other";

/** 2xx/3xx ok; 4xx client error; 5xx server error; 0 (aborted/network) and 1xx other. */
export function statusClassOf(status: number): StatusClass {
  if (status >= 200 && status < 400) return "ok";
  if (status >= 400 && status < 500) return "clientError";
  if (status >= 500 && status < 600) return "serverError";
  return "other";
}

/** The bucket a duration falls in: first bound strictly greater than the duration. */
export function bucketIndexOf(durationMs: number): number {
  for (let i = 0; i < LATENCY_BOUNDS_MS.length; i++) {
    if (durationMs < (LATENCY_BOUNDS_MS[i] as number)) return i;
  }
  return LATENCY_BOUNDS_MS.length;
}

/**
 * Nearest-rank percentile over bucket counts: the upper bound of the bucket holding
 * the ceil(p * total)-th sample. Coarse by design (D-200) — the lens shows a latency
 * band, not a false-precision number. Null when there are no samples or the rank
 * lands in the overflow bucket.
 */
export function percentileFromBuckets(
  counts: readonly number[],
  total: number,
  p: number,
): number | null {
  if (total <= 0) return null;
  const rank = Math.ceil(p * total);
  let seen = 0;
  for (let i = 0; i < counts.length; i++) {
    seen += counts[i] as number;
    if (seen >= rank) {
      return i < LATENCY_BOUNDS_MS.length ? (LATENCY_BOUNDS_MS[i] as number) : null;
    }
  }
  return null;
}

/** One window's facts for a route; the collector adds the route template. */
export interface RouteWindowStats {
  count: number;
  /** 5xx responses — the error rate numerator the lens shows. */
  errors: number;
  clientErrors: number;
  /** Status 0: aborted or network-failed; counted, but excluded from latency. */
  aborted: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

interface RingEntry {
  at: number;
  /** -1 = no latency sample (aborted requests). */
  bucket: number;
  cls: StatusClass;
}

/**
 * A circular buffer of the last ROUTE_SAMPLE_CAPACITY samples, expiring entries older
 * than ROUTE_WINDOW_MS. Bucket and class counters are maintained incrementally on
 * add/evict/expire, so a snapshot never walks raw latencies.
 */
export class RouteRingBuffer {
  private readonly entries: (RingEntry | undefined)[] = Array.from({
    length: ROUTE_SAMPLE_CAPACITY,
  });
  private readonly bucketCounts: number[] = Array.from({ length: BUCKET_COUNT }, () => 0);
  private readonly classCounts: Record<StatusClass, number> = {
    ok: 0,
    clientError: 0,
    serverError: 0,
    other: 0,
  };
  private head = 0;
  private tail = 0;
  private size = 0;
  private latencyCount = 0;
  private abortedCount = 0;

  add(at: number, status: number, durationMs: number): void {
    this.expire(at);
    if (this.size === ROUTE_SAMPLE_CAPACITY) this.dropOldest();
    const cls = statusClassOf(status);
    // An aborted request has no meaningful server latency: count it, don't time it.
    const bucket = status === 0 ? -1 : bucketIndexOf(durationMs);
    this.entries[this.head] = { at, bucket, cls };
    this.head = (this.head + 1) % ROUTE_SAMPLE_CAPACITY;
    this.size++;
    this.classCounts[cls]++;
    if (bucket >= 0) {
      this.bucketCounts[bucket] = (this.bucketCounts[bucket] as number) + 1;
      this.latencyCount++;
    }
    if (status === 0) this.abortedCount++;
  }

  /** Drop entries older than the window relative to now; counters stay in sync. */
  expire(now: number): void {
    const cutoff = now - ROUTE_WINDOW_MS;
    while (this.size > 0) {
      const oldest = this.entries[this.tail];
      if (oldest === undefined || oldest.at >= cutoff) break;
      this.dropOldest();
    }
  }

  snapshot(now: number): RouteWindowStats | null {
    this.expire(now);
    if (this.size === 0) return null;
    return {
      count: this.size,
      errors: this.classCounts.serverError,
      clientErrors: this.classCounts.clientError,
      aborted: this.abortedCount,
      p50Ms: percentileFromBuckets(this.bucketCounts, this.latencyCount, 0.5),
      p95Ms: percentileFromBuckets(this.bucketCounts, this.latencyCount, 0.95),
    };
  }

  private dropOldest(): void {
    const oldest = this.entries[this.tail];
    this.entries[this.tail] = undefined;
    this.tail = (this.tail + 1) % ROUTE_SAMPLE_CAPACITY;
    this.size--;
    if (oldest === undefined) return;
    this.classCounts[oldest.cls]--;
    if (oldest.bucket >= 0) {
      this.bucketCounts[oldest.bucket] = (this.bucketCounts[oldest.bucket] as number) - 1;
      this.latencyCount--;
    }
    if (oldest.cls === "other" && oldest.bucket === -1) this.abortedCount--;
  }
}
