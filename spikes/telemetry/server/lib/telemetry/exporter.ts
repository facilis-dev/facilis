import { context as otelContext } from "@opentelemetry/api";
import { ExportResultCode, suppressTracing } from "@opentelemetry/core";
import { JsonTraceSerializer } from "@opentelemetry/otlp-transformer";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";

const EXPORT_TIMEOUT_MS = 3000;

/**
 * OTLP/HTTP JSON exporter.
 *
 * The spike needs the wire format the ingestion route validates (OTLP/JSON), so it serializes
 * with the SDK's own JSON transformer instead of pulling the protobuf transport. Export runs
 * under `suppressTracing` so the telemetry request is never traced (no export feedback loop).
 */
export function createOtlpJsonExporter(url: string): SpanExporter {
  return {
    export(spans: ReadableSpan[], resultCallback) {
      const body = JsonTraceSerializer.serializeRequest(spans);
      if (body === undefined) {
        resultCallback({ code: ExportResultCode.FAILED, error: new Error("otlp serialize failed") });
        return;
      }
      void otelContext.with(suppressTracing(otelContext.active()), () =>
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
        })
          .then((response) =>
            resultCallback(
              response.ok
                ? { code: ExportResultCode.SUCCESS }
                : {
                    code: ExportResultCode.FAILED,
                    error: new Error("collector answered " + response.status),
                  },
            ),
          )
          .catch((error: unknown) =>
            resultCallback({
              code: ExportResultCode.FAILED,
              error: error instanceof Error ? error : new Error(String(error)),
            }),
          ),
      );
    },
    shutdown: () => Promise.resolve(),
    forceFlush: () => Promise.resolve(),
  };
}
