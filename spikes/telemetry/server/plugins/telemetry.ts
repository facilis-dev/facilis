import {
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CBaggagePropagator, W3CTraceContextPropagator, CompositePropagator } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { definePlugin, type HTTPEvent } from "nitro";
import { useNitroHooks } from "nitro/app";
import { INGESTION_PATH, readTelemetryConfig } from "../lib/telemetry/config";
import { setRequestTelemetry } from "../lib/telemetry/event-context";
import { createOtlpJsonExporter } from "../lib/telemetry/exporter";
import { matchedRouteTemplate } from "../lib/telemetry/route-template";

interface PendingSpan {
  readonly span: Span;
  readonly parentContext: Context;
}

const pending = new WeakMap<HTTPEvent, PendingSpan>();

function header(event: HTTPEvent, name: string): string | undefined {
  const value = event.req.headers.get(name);
  return value === null || value === "" ? undefined : value;
}

/**
 * Framework-owned backend instrumentation (D-203 §1) on Nitro's request/response runtime
 * hooks: the incoming W3C `traceparent` is extracted so the server span continues the
 * browser trace, and span attributes stay on the framework vocabulary (method, route
 * template, status) — no values, paths, query strings or headers.
 */
export default definePlugin(() => {
  const config = readTelemetryConfig();
  if (!config.enabled || config.collectorUrl === null) {
    return;
  }

  const exporter = createOtlpJsonExporter(config.collectorUrl);
  const provider = new TracerProvider({
    resource: resourceFromAttributes({
      "service.name": "facilis-spike-app",
      "deployment.environment.name": "production",
    }),
    spanProcessors: [new BatchSpanProcessor({ exporter, scheduledDelayMillis: 300 })],
  });
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  );
  // OTel JS 3.x dropped TracerProvider.register(): global registration is explicit.
  trace.setGlobalTracerProvider(provider);

  const tracer = trace.getTracer("facilis-spike-nitro", "0.0.0");
  const hooks = useNitroHooks();

  hooks.hook("request", (event) => {
    // The ingestion route is framework infrastructure, not an instrumented app surface:
    // tracing it would export the exporter's own traffic.
    if (event.url.pathname === INGESTION_PATH) {
      return;
    }
    const parentContext = propagation.extract(context.active(), {
      traceparent: header(event, "traceparent"),
      tracestate: header(event, "tracestate"),
    });
    const span = tracer.startSpan(
      event.req.method + " (pending route)",
      { kind: SpanKind.SERVER },
      parentContext,
    );
    pending.set(event, { span, parentContext });
    setRequestTelemetry(event, { span, context: trace.setSpan(parentContext, span) });
  });

  hooks.hook("response", (response, event) => {
    const entry = pending.get(event);
    if (entry === undefined) {
      return;
    }
    pending.delete(event);
    const method = event.req.method;
    const route = matchedRouteTemplate(event);
    entry.span.setAttribute("http.request.method", method);
    entry.span.setAttribute("http.response.status_code", response.status);
    if (route !== null) {
      entry.span.updateName(method + " " + route);
      entry.span.setAttribute("http.route", route);
    } else {
      entry.span.updateName(method + " (unrouted)");
    }
    if (response.status >= 500) {
      entry.span.setStatus({ code: SpanStatusCode.ERROR });
    }
    entry.span.end();
  });

  hooks.hook("close", () => {
    void provider.shutdown();
  });
});
