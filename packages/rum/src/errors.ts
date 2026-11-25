/**
 * Window-level error capture (D-203 §2): type + source only. Message, stack, filename and
 * reason values are PII carriers and are never recorded — the server allowlist would drop
 * them anyway; the client never sends them.
 */
import type { Tracer } from "@opentelemetry/api";

export type RumErrorSource = "window.onerror" | "unhandledrejection" | "react-boundary";

export const ERROR_SPAN_NAME = "browser.error";

// Constructor names are low-cardinality identifiers; anything else collapses to a constant.
const ERROR_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

/** Sanitized constructor name for Error values; every non-Error reason is "NonError". */
export function sanitizeErrorType(error: unknown): string {
  if (!(error instanceof Error)) return "NonError";
  const name = error.constructor.name;
  return ERROR_TYPE_PATTERN.test(name) ? name : "Error";
}

// Null until an enabled boot wires a tracer: disabled/dev builds never emit (D-200).
let errorTracer: Tracer | null = null;

export function captureRumError(error: unknown, source: RumErrorSource): void {
  if (errorTracer === null) return;
  const span = errorTracer.startSpan(ERROR_SPAN_NAME, {
    attributes: { "error.type": sanitizeErrorType(error), "facilis.rum.source": source },
  });
  span.end();
}

export function wireWindowErrors(tracer: Tracer): void {
  errorTracer = tracer;
  window.addEventListener("error", (event: Event) => {
    captureRumError((event as ErrorEvent).error, "window.onerror");
  });
  window.addEventListener("unhandledrejection", (event: Event) => {
    captureRumError((event as PromiseRejectionEvent).reason, "unhandledrejection");
  });
}
