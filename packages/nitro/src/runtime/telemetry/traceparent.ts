/**
 * W3C Trace Context extraction (D-203 §1).
 *
 * The server span continues the browser's trace by taking the incoming `traceparent` header as
 * its parent. The header is the only inbound value the framework reads for telemetry, and it is
 * parsed here rather than through a global propagator so the framework owns the rule and keeps
 * the dependency to `@opentelemetry/api`.
 */
import { context, trace, type Context, type SpanContext } from "@opentelemetry/api";

const TRACEPARENT_FIELD = "traceparent";
const INVALID_VERSION = "ff";
const HEX_VERSION = /^[0-9a-f]{2}$/;
const HEX_TRACE_ID = /^[0-9a-f]{32}$/;
const HEX_SPAN_ID = /^[0-9a-f]{16}$/;
const HEX_FLAGS = /^[0-9a-f]{2}$/;
const ZERO_TRACE_ID = "00000000000000000000000000000000";
const ZERO_SPAN_ID = "0000000000000000";

/**
 * The span context a `traceparent` header describes, or null when it is absent or does not
 * parse. All-zero identifiers and the reserved "ff" version are rejected as the spec requires.
 */
export function parseTraceparent(value: string | null | undefined): SpanContext | null {
  if (typeof value !== "string") return null;
  const parts = value.trim().split("-");
  // Version 00 is exactly four fields; a later version may append fields this parser ignores.
  if (parts.length < 4) return null;
  const [version, traceId, spanId, flags] = parts;
  if (version === undefined || traceId === undefined || spanId === undefined || flags === undefined)
    return null;
  if (version === "00" && parts.length !== 4) return null;
  if (!HEX_VERSION.test(version) || version === INVALID_VERSION) return null;
  if (!HEX_TRACE_ID.test(traceId) || traceId === ZERO_TRACE_ID) return null;
  if (!HEX_SPAN_ID.test(spanId) || spanId === ZERO_SPAN_ID) return null;
  if (!HEX_FLAGS.test(flags)) return null;
  return { traceId, spanId, traceFlags: Number.parseInt(flags, 16), isRemote: true };
}

/**
 * The context to start a server span in: the caller's trace when the header parses, otherwise
 * whatever context is active (a root span for a direct request).
 */
export function parentContextFromHeaders(headers: Headers): Context {
  const parent = parseTraceparent(headers.get(TRACEPARENT_FIELD));
  return parent === null ? context.active() : trace.setSpanContext(context.active(), parent);
}
