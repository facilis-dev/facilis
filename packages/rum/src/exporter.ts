/**
 * OTLP/JSON export to the app's own ingestion route (D-203 §3). The browser carries only
 * the public write-only tenant key; the collector credential stays server-side.
 */
import { context } from "@opentelemetry/api";
import { suppressTracing } from "@opentelemetry/core";
import { JsonTraceSerializer } from "@opentelemetry/otlp-transformer";
import type { SpanExporter } from "@opentelemetry/sdk-trace-web";
import type { RumConfig } from "./config.ts";

const EXPORT_TIMEOUT_MS = 3000;

export function createRumExporter(config: RumConfig): SpanExporter {
  return {
    export(spans, callback): void {
      try {
        const body = JsonTraceSerializer.serializeRequest(spans);
        if (body === undefined) {
          callback({ code: 0 });
          return;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);
        const settle = (): void => {
          clearTimeout(timer);
          // Always report success: RUM must never break the app, and the server's span-id
          // dedup rejects replays, so there are no retries (D-209).
          callback({ code: 0 });
        };
        // suppressTracing: the export request must never be traced by the fetch
        // instrumentation (it would feed itself). keepalive lets a page-unload export finish.
        void context.with(suppressTracing(context.active()), () => {
          void fetch(config.endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-facilis-telemetry-key": config.tenantKey,
            },
            // Copy into an ArrayBuffer-backed view: the serializer's Uint8Array is
            // ArrayBufferLike-generic, which the DOM BodyInit type does not accept.
            body: new Uint8Array(body),
            keepalive: true,
            signal: controller.signal,
          }).then(settle, settle);
        });
      } catch {
        // export() must never throw into the SDK's flush path.
        callback({ code: 0 });
      }
    },
    shutdown(): Promise<void> {
      return Promise.resolve();
    },
    forceFlush(): Promise<void> {
      return Promise.resolve();
    },
  };
}
