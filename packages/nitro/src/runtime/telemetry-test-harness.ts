/**
 * A real SDK recorder for the telemetry suites (D-203): the instrumentation is asserted
 * against spans an actual `TracerProvider` exported, not against a hand-rolled fake, so the
 * context wiring (parent trace, parent span) is the SDK's own.
 */
import { metrics, type Sampler, type Tracer } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type ReadableSpan,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace";

import type { TelemetryRuntime } from "./telemetry/runtime.ts";

export interface SpanRecorder {
  readonly provider: TracerProvider;
  readonly tracer: Tracer;
  readonly spans: () => ReadableSpan[];
  readonly shutdown: () => Promise<void>;
}

export interface SpanRecorderOptions {
  /** Head sampler; absent keeps the SDK default (parent-based, always-on root). */
  readonly sampler?: Sampler;
  /** Processors that run before the in-memory exporter, e.g. RUM's value-free scrub. */
  readonly beforeExport?: readonly SpanProcessor[];
}

export function createSpanRecorder(options: SpanRecorderOptions = {}): SpanRecorder {
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({
    ...(options.sampler === undefined ? {} : { sampler: options.sampler }),
    spanProcessors: [...(options.beforeExport ?? []), new SimpleSpanProcessor({ exporter })],
  });
  return {
    provider,
    tracer: provider.getTracer("facilis-test"),
    spans: () => exporter.getFinishedSpans(),
    shutdown: () => provider.shutdown(),
  };
}

/**
 * The runtime shape instrumentation consumes, backed by the recorder's real SDK tracer. The
 * meter is the API's no-op one: metrics are exercised by the export suite, not here.
 */
export function runtimeOf(recorder: SpanRecorder): TelemetryRuntime {
  return { tracer: recorder.tracer, meter: metrics.getMeter("facilis-test") };
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
