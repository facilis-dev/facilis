/**
 * Client-side value-free scrub (D-203 §2, D-209): defense in depth. The server allowlist
 * (packages/nitro/src/runtime/telemetry/ingest/scrub.ts) is the final gate; this processor
 * keeps the payload that leaves the browser already minimal, so no export path can carry
 * what the client never sends.
 */
import type { Attributes } from "@opentelemetry/api";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-web";

/**
 * The server vocabulary names plus the RUM triple and the legacy keys the 0.217
 * instrumentations emit (spike F6). The server maps the legacy method/status keys itself
 * and drops the rest; keeping them here lets the client scrub URL-bearing legacy keys
 * instead of passing raw URLs through.
 */
const ALLOWED: ReadonlySet<string> = new Set([
  "http.request.method",
  "http.route",
  "http.response.status_code",
  "db.system.name",
  "db.operation.name",
  "db.collection.name",
  "facilis.job.name",
  "facilis.job.attempt",
  "facilis.workflow.name",
  "facilis.workflow.step",
  "facilis.workflow.step.kind",
  "browser.web_vital.name",
  "browser.web_vital.value",
  "browser.web_vital.rating",
  "error.type",
  "facilis.rum.source",
  "http.method",
  "http.status_code",
  "http.url",
  "http.target",
  "http.scheme",
  "http.host",
  "net.peer.name",
  "net.peer.port",
]);

/** Keys whose value is a URL: only the templated pathname may survive. */
const URL_BEARING: ReadonlySet<string> = new Set([
  "http.url",
  "http.target",
  "url.full",
  "url.path",
  "http.route",
]);

// Mirrors the server's sanitizeSpanName patterns (ingest/scrub.ts): concrete ids collapse
// to ":id" so span names and paths stay low-cardinality route templates.
const UUID = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;
const NUMERIC_SEGMENT = /\/\d+(?=\/|$)/g;
// An email-shaped segment is an identifier, not a route (mirrors the server's pattern).
const EMAIL_SEGMENT = /\/[^/?#\s]*@[^/?#\s]*(?=\/|$)/g;
const MAX_SPAN_NAME = 120;
const MAX_ATTRIBUTE_STRING = 128;

/** Replace UUID, numeric and email-shaped path segments with ":id" (the server's templating). */
export function templateSegments(path: string): string {
  return path.replace(UUID, "/:id").replace(NUMERIC_SEGMENT, "/:id").replace(EMAIL_SEGMENT, "/:id");
}

/** Keep only the pathname: query, fragment, scheme, host and userinfo never leave. */
export function scrubUrl(raw: string): string {
  const withoutQuery = raw.split(/[?#]/)[0] ?? "";
  let pathname = withoutQuery;
  try {
    // A dummy base parses relative targets too; only the pathname is kept.
    pathname = new URL(withoutQuery, "http://rum.invalid").pathname;
  } catch {
    // Not a URL: keep the query-free string; id templating below still applies.
  }
  return templateSegments(pathname).slice(0, MAX_ATTRIBUTE_STRING);
}

/** Allowlisted keys, scalars only, URL-bearing keys reduced to templated pathnames. */
export function scrubSpanAttributes(attributes: Attributes): Attributes {
  const kept: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!ALLOWED.has(key)) continue;
    if (URL_BEARING.has(key)) {
      if (typeof value === "string") kept[key] = scrubUrl(value);
      continue;
    }
    // An allowed key must not smuggle a structure (mirrors the server's scalar filter).
    // Non-finite numbers are dropped: they serialize to JSON null and are never a metric.
    if (typeof value === "string") kept[key] = value.slice(0, MAX_ATTRIBUTE_STRING);
    else if (typeof value === "number" && Number.isFinite(value)) kept[key] = value;
    else if (typeof value === "boolean") kept[key] = value;
  }
  return kept;
}

/** Absolute http(s) URLs must not leak scheme/host into span names (mirrors the server). */
function pathnameOf(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") return url.pathname;
  } catch {
    // Not an absolute URL: a route template or a fixed span name, kept as-is.
  }
  return raw;
}

/** Span names get the same query/fragment strip and id templating, capped like the server. */
export function scrubSpanName(name: string): string {
  const withoutQuery = pathnameOf(name).split(/[?#]/)[0] ?? "";
  return templateSegments(withoutQuery).slice(0, MAX_SPAN_NAME);
}

/**
 * Scrubs each span before the batch processor queues it. The SDK hands onEnd the live Span
 * object; ReadableSpan is its read-only view, so narrow to the mutable shape (no `any`)
 * and rewrite in place — every exporter downstream then sees scrubbed data.
 */
export class ScrubProcessor implements SpanProcessor {
  onStart(): void {}

  onEnd(span: ReadableSpan): void {
    const mutable = span as unknown as { name: string; attributes: Attributes };
    mutable.name = scrubSpanName(span.name);
    mutable.attributes = scrubSpanAttributes(span.attributes);
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}
