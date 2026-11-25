import { afterEach, describe, expect, it } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";

import { createHttpSpanHooks, type TelemetryEvent } from "./http-span.ts";
import {
  attributesOf,
  createSpanRecorder,
  spanAt,
  type SpanRecorder,
} from "../telemetry-test-harness.ts";

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const CALLER_SPAN_ID = "b7ad6b7169203331";
const TRACEPARENT = "00-" + TRACE_ID + "-" + CALLER_SPAN_ID + "-01";

const recorders: SpanRecorder[] = [];

function recorder(): SpanRecorder {
  const created = createSpanRecorder();
  recorders.push(created);
  return created;
}

afterEach(async () => {
  await Promise.all(recorders.splice(0).map((entry) => entry.shutdown()));
});

interface EventOptions {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly route?: string | null;
}

function makeEvent(options: EventOptions = {}): TelemetryEvent {
  const route = options.route === undefined ? "/api/orders/:id" : options.route;
  return {
    req: { method: options.method ?? "GET", headers: new Headers(options.headers ?? {}) },
    context: route === null ? {} : { matchedRoute: { route } },
  };
}

describe("createHttpSpanHooks", () => {
  it("continues the caller's trace and exports only framework attributes", () => {
    const spans = recorder();
    const hooks = createHttpSpanHooks(spans.tracer);
    const event = makeEvent({ headers: { traceparent: TRACEPARENT } });

    hooks.request(event);
    hooks.response(new Response(null, { status: 200 }), event);

    const span = spanAt(spans, 0);
    expect(span.name).toBe("GET /api/orders/:id");
    expect(span.spanContext().traceId).toBe(TRACE_ID);
    expect(span.parentSpanContext?.spanId).toBe(CALLER_SPAN_ID);
    expect(attributesOf(span)).toEqual({
      "http.request.method": "GET",
      "http.response.status_code": 200,
      "http.route": "/api/orders/:id",
    });
  });

  it("names an unrouted request without inventing a route", () => {
    const spans = recorder();
    const hooks = createHttpSpanHooks(spans.tracer);
    const event = makeEvent({ method: "POST", route: null });

    hooks.request(event);
    hooks.response(new Response(null, { status: 404 }), event);

    const span = spanAt(spans, 0);
    expect(span.name).toBe("POST (unrouted)");
    expect(attributesOf(span)).toEqual({
      "http.request.method": "POST",
      "http.response.status_code": 404,
    });
    expect(span.parentSpanContext).toBeUndefined();
  });

  it("marks a server error status as an error without recording the response", () => {
    const spans = recorder();
    const hooks = createHttpSpanHooks(spans.tracer);
    const event = makeEvent();

    hooks.request(event);
    hooks.response(new Response("boom: token=secret", { status: 500 }), event);

    const span = spanAt(spans, 0);
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(JSON.stringify(attributesOf(span))).not.toContain("secret");
  });

  it("installs the request trace on the event context for the wrapper's DB spans", () => {
    const spans = recorder();
    const hooks = createHttpSpanHooks(spans.tracer);
    const event = makeEvent({ headers: { traceparent: TRACEPARENT } });

    hooks.request(event);

    const context = event.context as Record<string, unknown>;
    expect(context["trace"]).toBeDefined();
    hooks.response(new Response(null, { status: 200 }), event);
  });

  it("ends nothing twice when a response arrives without a matching request", () => {
    const spans = recorder();
    const hooks = createHttpSpanHooks(spans.tracer);
    hooks.response(new Response(null, { status: 200 }), makeEvent());
    expect(spans.spans()).toEqual([]);
  });
});
