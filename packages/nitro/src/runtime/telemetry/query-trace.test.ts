import { afterEach, describe, expect, it } from "vitest";
import { SpanStatusCode, context, trace } from "@opentelemetry/api";

import { createQueryTrace } from "./query-trace.ts";
import {
  attributesOf,
  createSpanRecorder,
  spanAt,
  type SpanRecorder,
} from "../telemetry-test-harness.ts";

const recorders: SpanRecorder[] = [];

function recorder(): SpanRecorder {
  const created = createSpanRecorder();
  recorders.push(created);
  return created;
}

afterEach(async () => {
  await Promise.all(recorders.splice(0).map((entry) => entry.shutdown()));
});

describe("createQueryTrace", () => {
  it("makes the DB span a child of the request span", () => {
    const spans = recorder();
    const request = spans.tracer.startSpan("GET /api/orders/:id");
    const queryTrace = createQueryTrace(spans.tracer, trace.setSpan(context.active(), request));

    queryTrace.startQuerySpan({ operation: "select", relation: "orders" }).end();
    request.end();

    const dbSpan = spanAt(spans, 0);
    const httpSpan = spanAt(spans, 1);
    expect(dbSpan.name).toBe("SELECT orders");
    expect(dbSpan.spanContext().traceId).toBe(httpSpan.spanContext().traceId);
    expect(dbSpan.parentSpanContext?.spanId).toBe(httpSpan.spanContext().spanId);
    expect(attributesOf(dbSpan)).toEqual({
      "db.system.name": "postgresql",
      "db.operation.name": "select",
      "db.collection.name": "orders",
    });
  });

  it("names a relation-less statement by its verb only", () => {
    const spans = recorder();
    const queryTrace = createQueryTrace(spans.tracer, context.active());

    queryTrace.startQuerySpan({ operation: "begin", relation: null }).end();

    const span = spanAt(spans, 0);
    expect(span.name).toBe("BEGIN");
    expect(attributesOf(span)).toEqual({
      "db.system.name": "postgresql",
      "db.operation.name": "begin",
    });
  });

  it("marks a failed statement without exporting the error text", () => {
    const spans = recorder();
    const queryTrace = createQueryTrace(spans.tracer, context.active());

    queryTrace
      .startQuerySpan({ operation: "insert", relation: "orders" })
      .end(new Error("duplicate key: token=secret"));

    const span = spanAt(spans, 0);
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(JSON.stringify(attributesOf(span))).not.toContain("secret");
    expect(span.events).toEqual([]);
  });
});
