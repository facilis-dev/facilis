import type { Context, Span } from "@opentelemetry/api";

/** The active trace context of a request, carried on the Nitro event (D-203 §1). */
export interface RequestTelemetry {
  readonly span: Span;
  readonly context: Context;
}

const CONTEXT_KEY = "__facilisOtel";

type EventWithContext = { context: Record<string, unknown> };

/**
 * Nitro runtime hooks cannot wrap the route handler, so the request context travels on
 * `event.context` and the framework's DB wrapper starts its spans from it. Keeping the
 * passing explicit is what the production `ctx.db` surface can do as well.
 */
export function setRequestTelemetry(event: EventWithContext, telemetry: RequestTelemetry): void {
  event.context[CONTEXT_KEY] = telemetry;
}

export function getRequestTelemetry(event: EventWithContext): RequestTelemetry | null {
  const value = event.context[CONTEXT_KEY];
  if (value === null || typeof value !== "object" || !("span" in value) || !("context" in value)) {
    return null;
  }
  return value as RequestTelemetry;
}
