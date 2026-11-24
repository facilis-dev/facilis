/**
 * The OTLP/HTTP export pipeline (D-203 §1, §5).
 *
 * Facilis hosts nothing: spans and metrics leave the process only through the operator's own
 * collector. The SDK batches both signals — a `BatchSpanProcessor` for spans and a periodic
 * reader for metrics — so an exporter round trip never sits on the request path, retries are
 * the OTLP exporter's own (bounded attempts, `Retry-After` aware), and `shutdown` flushes
 * whatever is still queued before the process exits.
 */
import type { Meter, Tracer } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  TracerProvider,
} from "@opentelemetry/sdk-trace";

import { DEPLOYMENT_ID, SERVICE_NAME } from "./vocabulary.ts";

/** One scope name for both signals, so a collector groups the framework's telemetry together. */
const SCOPE_NAME = "facilis";

const SPANS_PATH = "/v1/traces";
const METRICS_PATH = "/v1/metrics";

export interface TelemetryExportConfig {
  /** Collector base URL: the signal path is appended here. */
  readonly endpoint: string;
  readonly sampling: number;
  readonly serviceName: string;
  readonly deploymentId: string | null;
}

/** Batch knobs; production uses the SDK defaults, tests shrink them. */
export interface TelemetryExportTuning {
  readonly scheduledDelayMillis?: number;
  readonly maxQueueSize?: number;
  readonly maxExportBatchSize?: number;
  readonly exportTimeoutMillis?: number;
}

export interface TelemetryPipeline {
  readonly tracer: Tracer;
  readonly meter: Meter;
  /** Flushes both signals and stops the SDK; never throws, so a shutdown hook stays safe. */
  readonly shutdown: () => Promise<void>;
}

export function createTelemetryPipeline(
  config: TelemetryExportConfig,
  tuning: TelemetryExportTuning = {},
): TelemetryPipeline {
  // The resource is deliberately explicit: an operator's service name and the deployment the
  // process belongs to, never a hostname, a path or a user (D-203 §2).
  const resource = resourceFromAttributes({
    [SERVICE_NAME]: config.serviceName,
    ...(config.deploymentId === null ? {} : { [DEPLOYMENT_ID]: config.deploymentId }),
  });

  const traceProvider = new TracerProvider({
    resource,
    // Head sampling only decides whether a new trace is recorded; a request that continues the
    // browser's trace keeps the browser's decision, which is what makes a page view and its
    // API call one complete trace or none at all.
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.sampling) }),
    spanProcessors: [
      new BatchSpanProcessor({
        exporter: new OTLPTraceExporter({ url: config.endpoint + SPANS_PATH }),
        scheduledDelayMillis: tuning.scheduledDelayMillis,
        maxQueueSize: tuning.maxQueueSize,
        maxExportBatchSize: tuning.maxExportBatchSize,
        exportTimeoutMillis: tuning.exportTimeoutMillis,
      }),
    ],
  });

  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: config.endpoint + METRICS_PATH }),
      }),
    ],
  });

  return {
    tracer: traceProvider.getTracer(SCOPE_NAME),
    meter: meterProvider.getMeter(SCOPE_NAME),
    // Both providers are stopped even when one fails: a deploy must not keep a half-open
    // exporter because the other signal's collector was unreachable.
    shutdown: async () => {
      await Promise.allSettled([traceProvider.shutdown(), meterProvider.shutdown()]);
    },
  };
}
