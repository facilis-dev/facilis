import { afterEach, describe, expect, it } from "vitest";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { currentQueryTrace } from "@facilis.dev/db";

import { withJobSpan, withWorkflowSpan } from "./custom-spans.ts";
import { installTelemetryRuntime } from "./runtime.ts";
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
  installTelemetryRuntime(null);
  await Promise.all(recorders.splice(0).map((entry) => entry.shutdown()));
});

describe("withJobSpan", () => {
  it("spans the attempt and makes the job's DB queries children of it", async () => {
    const spans = recorder();
    installTelemetryRuntime({ tracer: spans.tracer });

    const result = await withJobSpan("sync-documents", 2, async () => {
      currentQueryTrace()?.startQuerySpan({ operation: "select", relation: "documents" }).end();
      return "done";
    });

    expect(result).toBe("done");
    const dbSpan = spanAt(spans, 0);
    const jobSpan = spanAt(spans, 1);
    expect(jobSpan.name).toBe("job sync-documents");
    expect(jobSpan.kind).toBe(SpanKind.INTERNAL);
    expect(attributesOf(jobSpan)).toEqual({
      "facilis.job.name": "sync-documents",
      "facilis.job.attempt": 2,
    });
    expect(dbSpan.spanContext().traceId).toBe(jobSpan.spanContext().traceId);
    expect(dbSpan.parentSpanContext?.spanId).toBe(jobSpan.spanContext().spanId);
  });

  it("marks a failed attempt without recording the error and rethrows", async () => {
    const spans = recorder();
    installTelemetryRuntime({ tracer: spans.tracer });
    const failure = new Error("input token=secret");

    await expect(
      withJobSpan("sync-documents", 1, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    const span = spanAt(spans, 0);
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(JSON.stringify(attributesOf(span))).not.toContain("secret");
    expect(span.events).toEqual([]);
  });

  it("does nothing at all when telemetry is disabled", async () => {
    const spans = recorder();
    installTelemetryRuntime(null);

    const seen = await withJobSpan("sync-documents", 1, async () => currentQueryTrace());

    expect(seen).toBeUndefined();
    expect(spans.spans()).toEqual([]);
  });
});

describe("withWorkflowSpan", () => {
  it("names the transition after the workflow and its current step", async () => {
    const spans = recorder();
    installTelemetryRuntime({ tracer: spans.tracer });

    await withWorkflowSpan("publish-article", 3, "job", async () => undefined);

    const span = spanAt(spans, 0);
    expect(span.name).toBe("workflow publish-article");
    expect(attributesOf(span)).toEqual({
      "facilis.workflow.name": "publish-article",
      "facilis.workflow.step": 3,
      "facilis.workflow.step.kind": "job",
    });
  });
});
