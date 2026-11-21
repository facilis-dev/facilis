// The IDE side of the dev-only runtime metrics source (D-200, issue #71): the message
// contract, its validation, and the dormant collector the graph runtime lens (#72) will
// enable on demand. Nothing here runs until enableRuntimeMetrics() is called; the
// injected preview client is equally dormant until the IDE posts its enable message.
//
// Payload contract (both directions carry the source tag "vv-metrics"):
//   IDE → preview:  { source, type: "enable", token, routes: string[] } | { source, type: "disable" }
//   preview → IDE:  { source, type: "batch", token, samples: [{ route, method, status, duration }] }
// route is a template ("/api/todos/{id}"), never a concrete path: no query strings,
// bodies or headers ever enter a sample. The token is this boot's kernel token; the SW
// strips it from preview URLs before the app loads (D-132), so the IDE hands it to the
// client in the enable message and every batch must echo it back.

import {
  RouteRingBuffer,
  type RouteWindowStats,
} from "./runtime-metrics-buffer";

export const RUNTIME_METRICS_SOURCE = "vv-metrics";
/**
 * 64 KiB of UTF-8 JSON. A legal batch is at most 256 samples of ~170 bytes each
 * (~43 KiB worst case with 128-char routes), so the cap never truncates honest
 * traffic but bounds what a hostile or buggy frame can make the IDE allocate.
 */
export const METRICS_MAX_MESSAGE_BYTES = 64 * 1024;
export const METRICS_MAX_BATCH_SAMPLES = 256;
export const METRICS_MAX_ROUTE_LENGTH = 128;
/** Routes tracked at once; beyond this, new routes are dropped (memory bound). */
export const METRICS_MAX_ROUTES = 256;
/** A sample's duration is capped at one hour: anything else is a clock bug, not data. */
export const METRICS_MAX_DURATION_MS = 3_600_000;

export interface RuntimeMetricSample {
  route: string;
  method: string;
  /** 0 = aborted / network failure; otherwise the HTTP status. */
  status: number;
  /** Milliseconds to response headers (streaming bodies are not waited for). */
  duration: number;
}

export interface RouteRuntimeMetrics extends RouteWindowStats {
  route: string;
}

export type MetricsRejection =
  | "disabled"
  | "not-object"
  | "wrong-source"
  | "wrong-type"
  | "wrong-token"
  | "too-large"
  | "bad-batch"
  | "bad-sample";

export type ParseResult =
  | { ok: true; samples: RuntimeMetricSample[] }
  | { ok: false; reason: MetricsRejection };

const METHODS: ReadonlySet<string> = new Set([
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSample(value: unknown): value is RuntimeMetricSample {
  if (!isRecord(value)) return false;
  const { route, method, status, duration } = value;
  if (typeof route !== "string" || route.length === 0 || route.length > METRICS_MAX_ROUTE_LENGTH) return false;
  // Defense in depth: the client already strips queries; a concrete path with one is
  // a contract violation (and a potential ID/PII leak), so the batch is rejected.
  if (!route.startsWith("/") || route.includes("?") || route.includes("#")) return false;
  if (typeof method !== "string" || !METHODS.has(method)) return false;
  if (typeof status !== "number" || !Number.isInteger(status) || status < 0 || status > 599) return false;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0 || duration > METRICS_MAX_DURATION_MS) return false;
  return true;
}

/**
 * Validate one preview message against the contract. Strict: a single malformed
 * sample rejects the whole batch, so a buggy client cannot poison the buffer with
 * partial data. The size cap is measured on the UTF-8 JSON encoding, before the
 * samples are touched.
 */
export function parseRuntimeMetricsBatch(data: unknown, expectedToken: string): ParseResult {
  if (!isRecord(data)) return { ok: false, reason: "not-object" };
  if (data["source"] !== RUNTIME_METRICS_SOURCE) return { ok: false, reason: "wrong-source" };
  if (data["type"] !== "batch") return { ok: false, reason: "wrong-type" };
  if (typeof data["token"] !== "string" || data["token"] !== expectedToken) {
    return { ok: false, reason: "wrong-token" };
  }
  let json: string;
  try {
    json = JSON.stringify(data);
  } catch {
    return { ok: false, reason: "bad-batch" };
  }
  if (json === undefined || new TextEncoder().encode(json).byteLength > METRICS_MAX_MESSAGE_BYTES) {
    return { ok: false, reason: "too-large" };
  }
  const samples = data["samples"];
  if (!Array.isArray(samples) || samples.length === 0 || samples.length > METRICS_MAX_BATCH_SAMPLES) {
    return { ok: false, reason: "bad-batch" };
  }
  for (const sample of samples) {
    if (!validSample(sample)) return { ok: false, reason: "bad-sample" };
  }
  return { ok: true, samples: samples as RuntimeMetricSample[] };
}

/**
 * The per-route buffer set. Dormant until enable(); ingest() is the only write path
 * and it re-validates every message (the wire layer's origin check is not a substitute
 * for the token check). The route list given at enable time is authoritative: samples
 * for routes outside it are dropped, mirroring the client's template matching.
 */
export class RuntimeMetricsCollector {
  private readonly buffers = new Map<string, RouteRingBuffer>();
  private routes: ReadonlySet<string> = new Set();
  private enabled = false;

  enable(routes: readonly string[]): void {
    this.enabled = true;
    this.routes = new Set(routes);
    this.buffers.clear();
  }

  disable(): void {
    this.enabled = false;
    this.routes = new Set();
    this.buffers.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  ingest(data: unknown, expectedToken: string, now: number = Date.now()): ParseResult {
    if (!this.enabled) return { ok: false, reason: "disabled" };
    const parsed = parseRuntimeMetricsBatch(data, expectedToken);
    if (!parsed.ok) return parsed;
    for (const sample of parsed.samples) {
      if (!this.routes.has(sample.route)) continue;
      let buffer = this.buffers.get(sample.route);
      if (buffer === undefined) {
        if (this.buffers.size >= METRICS_MAX_ROUTES) continue;
        buffer = new RouteRingBuffer();
        this.buffers.set(sample.route, buffer);
      }
      buffer.add(now, sample.status, sample.duration);
    }
    return parsed;
  }

  /** Windowed facts per route, sorted by template; empty while dormant. */
  snapshot(now: number = Date.now()): RouteRuntimeMetrics[] {
    const rows: RouteRuntimeMetrics[] = [];
    for (const [route, buffer] of this.buffers) {
      const stats = buffer.snapshot(now);
      if (stats !== null) rows.push({ route, ...stats });
    }
    rows.sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : 0));
    return rows;
  }
}

// The module-level seam (the graph-live.ts pattern): one collector per IDE tab, a
// subscription for "the buffer changed", and no controller callback. #72's runtime
// lens enables it with the route templates it already derives from the manifest and
// subscribes for repaints; nothing else in the IDE knows it exists.
const collector = new RuntimeMetricsCollector();
type Listener = () => void;
const listeners = new Set<Listener>();

export function getRuntimeMetrics(): RuntimeMetricsCollector {
  return collector;
}

/** Returns the unsubscribe function (use it as the effect cleanup). */
export function subscribeRuntimeMetrics(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyRuntimeMetrics(): void {
  // Snapshot: a listener that unsubscribes mid-notify must not disturb the loop.
  for (const listener of Array.from(listeners)) listener();
}
