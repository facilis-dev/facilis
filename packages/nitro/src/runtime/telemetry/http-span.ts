/**
 * HTTP server spans (D-203 §1) on Nitro's runtime hooks.
 *
 * Nitro cannot wrap the route handler, so the `request` hook starts the span and stores its
 * trace on the event context; the framework's route wrapper enters that trace for the handler
 * (so DB spans continue it) and the `response` hook names the span after the matched route
 * TEMPLATE and ends it.
 */
import { SpanKind, SpanStatusCode, trace, type Span, type Tracer } from "@opentelemetry/api";
import type { QueryTrace } from "@facilis.dev/db";

import { createQueryTrace } from "./query-trace.ts";
import { parentContextFromHeaders } from "./traceparent.ts";
import { HTTP_METHOD, HTTP_ROUTE, HTTP_STATUS, httpSpanName } from "./vocabulary.ts";

interface MatchedRoute {
  readonly route?: unknown;
}

/**
 * The structural part of a Nitro event the hooks read. Keeping it structural (rather than
 * importing h3's generic event) lets the hooks be tested with a plain fake event; `context`
 * is optional because Nitro's hook type does not declare it even though the runtime event
 * carries it (the framework's middleware relies on the same object).
 */
export interface TelemetryEvent {
  readonly req: { readonly method: string; readonly headers: Headers };
  readonly context?: unknown;
}

export interface HttpSpanHooks {
  readonly request: (event: TelemetryEvent) => void;
  readonly response: (response: Response, event: TelemetryEvent) => void;
}

export function createHttpSpanHooks(tracer: Tracer): HttpSpanHooks {
  // Responses may be produced without awaiting the handler's promise chain, so the pending
  // span is keyed by the event object rather than carried through a context manager.
  const pending = new WeakMap<object, Span>();

  return {
    request(event) {
      const parent = parentContextFromHeaders(event.req.headers);
      const span = tracer.startSpan(
        httpSpanName(event.req.method, null),
        { kind: SpanKind.SERVER },
        parent,
      );
      pending.set(event, span);
      setEventTrace(event, createQueryTrace(tracer, trace.setSpan(parent, span)));
    },

    response(response, event) {
      const span = pending.get(event);
      if (span === undefined) return;
      pending.delete(event);
      const route = matchedRouteTemplate(event);
      span.setAttribute(HTTP_METHOD, event.req.method);
      span.setAttribute(HTTP_STATUS, response.status);
      if (route !== null) span.setAttribute(HTTP_ROUTE, route);
      span.updateName(httpSpanName(event.req.method, route));
      // An error status is all that is recorded: an error body may carry application values.
      if (response.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    },
  };
}

/**
 * The matched route template (`/orders/:id`), never the concrete path: a raw URL would leak
 * the path parameters and the query string into the trace (D-203 §2).
 */
function matchedRouteTemplate(event: TelemetryEvent): string | null {
  const context = event.context as { readonly matchedRoute?: MatchedRoute } | undefined;
  const route = context?.matchedRoute?.route;
  return typeof route === "string" && route.length > 0 ? route : null;
}

function setEventTrace(event: TelemetryEvent, queryTrace: QueryTrace): void {
  if (typeof event.context !== "object" || event.context === null) return;
  (event.context as Record<string, unknown>)["trace"] = queryTrace;
}
