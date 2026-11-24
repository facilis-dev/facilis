/**
 * A real SDK recorder for the telemetry suites (D-203): the instrumentation is asserted
 * against spans an actual `TracerProvider` exported, not against a hand-rolled fake, so the
 * context wiring (parent trace, parent span) is the SDK's own.
 */
import type { Tracer } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace";

export interface SpanRecorder {
  readonly tracer: Tracer;
  readonly spans: () => ReadableSpan[];
  readonly shutdown: () => Promise<void>;
}

export function createSpanRecorder(): SpanRecorder {
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
  });
  return {
    tracer: provider.getTracer("facilis-test"),
    spans: () => exporter.getFinishedSpans(),
    shutdown: () => provider.shutdown(),
  };
}

/** The exported span at `index`; fails naming the index when the recorder has no such span. */
export function spanAt(recorder: SpanRecorder, index: number): ReadableSpan {
  const span = recorder.spans()[index];
  if (span === undefined) throw new Error(`no span exported at index ${index}`);
  return span;
}

/** The attributes of one exported span, for exact-set assertions. */
export function attributesOf(span: ReadableSpan): Record<string, unknown> {
  return { ...span.attributes };
}

export type { ReadableSpan };
