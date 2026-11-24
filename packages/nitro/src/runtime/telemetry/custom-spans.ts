/**
 * Custom job and workflow spans (D-203 §1).
 *
 * Jobs and workflow steps run on their own (a timer, a tick), outside any request, so they
 * start a root span. Their own context is then entered as the query trace, which makes the DB
 * spans a job issues children of the job rather than unrelated roots.
 */
import { SpanKind, SpanStatusCode, context, trace, type Attributes } from "@opentelemetry/api";
import { runWithQueryTrace } from "@facilis.dev/db";

import { createQueryTrace } from "./query-trace.ts";
import { activeTelemetry } from "./runtime.ts";
import { jobAttributes, workflowAttributes } from "./vocabulary.ts";

/** Span names stay low-cardinality; the identifying details live in the attributes. */
export function withJobSpan<T>(name: string, attempt: number, run: () => Promise<T>): Promise<T> {
  return withInternalSpan("job " + name, jobAttributes(name, attempt), run);
}

export function withWorkflowSpan<T>(
  name: string,
  step: number,
  kind: string,
  run: () => Promise<T>,
): Promise<T> {
  return withInternalSpan("workflow " + name, workflowAttributes(name, step, kind), run);
}

async function withInternalSpan<T>(
  name: string,
  attributes: Attributes,
  run: () => Promise<T>,
): Promise<T> {
  const runtime = activeTelemetry();
  // Disabled is absent: no span, no context switch.
  if (runtime === null) return run();
  const span = runtime.tracer.startSpan(name, { kind: SpanKind.INTERNAL, attributes });
  try {
    return await runWithQueryTrace(
      createQueryTrace(runtime.tracer, trace.setSpan(context.active(), span)),
      run,
    );
  } catch (error) {
    // The error value is never recorded: job errors can repeat inputs and outputs.
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
}
