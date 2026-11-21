// The runtime lens's window maths (issue #72), split from graph-runtime.ts so both files stay
// under the 300-line source limit. Pure functions over the raw history entries: the 1m/15m
// window stats, the 60-bucket sparkline and the view-equality check that keeps snapshot object
// identity stable while the data is unchanged (useSyncExternalStore re-renders only on a new
// identity). The 5-minute window does NOT live here: it reads the collector's own ring so its
// stats are exactly collector.snapshot() for the same now. The dependency runs one way —
// graph-runtime.ts imports this module, never the reverse (a cycle would TDZ the constants).

import {
  BUCKET_COUNT,
  percentileFromBuckets,
  type RouteWindowStats,
  type StatusClass,
} from "./runtime-metrics-buffer";

export const RUNTIME_SPARK_BUCKETS = 60;
/** Heat quantisation: count >= threshold[i] earns level i+1; zero traffic is level 0 (empty). */
export const RUNTIME_HEAT_THRESHOLDS: readonly number[] = [1, 5, 25, 100, 500];

/** 0 = empty (no traffic), 1..5 = the quantised request count. Empty is never "healthy". */
export function heatOf(count: number): number {
  let level = 0;
  for (const threshold of RUNTIME_HEAT_THRESHOLDS) {
    if (count >= threshold) level += 1;
  }
  return level;
}

export interface RouteRuntimeStats extends RouteWindowStats {
  /** errors / count (0 when count is 0). 5xx only: 4xx is clientErrors, not errors. */
  readonly errorRate: number;
  readonly heat: number;
}

export interface RouteRuntimeView {
  /** null = no traffic in the window: the empty state, distinct from healthy traffic. */
  readonly stats: RouteRuntimeStats | null;
  /** RUNTIME_SPARK_BUCKETS request counts spanning the window, oldest bucket first. */
  readonly spark: readonly number[];
}

export interface HistoryEntry {
  at: number;
  /** -1 = no latency sample (aborted requests), like the ring's entries. */
  bucket: number;
  cls: StatusClass;
}

const EMPTY_SPARK: readonly number[] = Array.from({ length: RUNTIME_SPARK_BUCKETS }, () => 0);
/** Shared empty view: no traffic in the window, never a green/healthy guess (epic rule 5). */
export const EMPTY_VIEW: RouteRuntimeView = { stats: null, spark: EMPTY_SPARK };

export function withRate(stats: RouteWindowStats): RouteRuntimeStats {
  return {
    ...stats,
    errorRate: stats.count > 0 ? stats.errors / stats.count : 0,
    heat: heatOf(stats.count),
  };
}

/** Window stats from the raw history (1m/15m); entries at the cutoff stay, like the ring. */
export function statsFromEntries(
  entries: readonly HistoryEntry[],
  now: number,
  windowMs: number,
): RouteRuntimeStats | null {
  const cutoff = now - windowMs;
  const bucketCounts: number[] = Array.from({ length: BUCKET_COUNT }, () => 0);
  let count = 0;
  let errors = 0;
  let clientErrors = 0;
  let aborted = 0;
  let latencyCount = 0;
  for (const entry of entries) {
    if (entry.at < cutoff) continue;
    count += 1;
    if (entry.cls === "serverError") errors += 1;
    if (entry.cls === "clientError") clientErrors += 1;
    if (entry.bucket === -1) aborted += 1;
    else {
      bucketCounts[entry.bucket] = (bucketCounts[entry.bucket] ?? 0) + 1;
      latencyCount += 1;
    }
  }
  if (count === 0) return null;
  return withRate({
    count,
    errors,
    clientErrors,
    aborted,
    p50Ms: percentileFromBuckets(bucketCounts, latencyCount, 0.5),
    p95Ms: percentileFromBuckets(bucketCounts, latencyCount, 0.95),
  });
}

/** Request counts per bucket; bucket width is window/60, the oldest bucket first. */
export function sparkFromEntries(
  entries: readonly HistoryEntry[],
  now: number,
  windowMs: number,
): number[] {
  const spark: number[] = Array.from({ length: RUNTIME_SPARK_BUCKETS }, () => 0);
  const start = now - windowMs;
  const width = windowMs / RUNTIME_SPARK_BUCKETS;
  for (const entry of entries) {
    if (entry.at < start) continue;
    const index = Math.min(RUNTIME_SPARK_BUCKETS - 1, Math.floor((entry.at - start) / width));
    spark[index] = (spark[index] ?? 0) + 1;
  }
  return spark;
}

/** Deep equality of two views: the identity-stability gate for per-route re-renders. */
export function sameView(a: RouteRuntimeView, b: RouteRuntimeView): boolean {
  const sa = a.stats;
  const sb = b.stats;
  if (sa === null || sb === null) return sa === sb;
  return (
    sa.count === sb.count &&
    sa.errors === sb.errors &&
    sa.clientErrors === sb.clientErrors &&
    sa.aborted === sb.aborted &&
    sa.p50Ms === sb.p50Ms &&
    sa.p95Ms === sb.p95Ms &&
    sa.errorRate === sb.errorRate &&
    sa.heat === sb.heat &&
    a.spark.length === b.spark.length &&
    a.spark.every((value, index) => value === b.spark[index])
  );
}
