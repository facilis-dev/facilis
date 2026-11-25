import { context } from "@opentelemetry/api";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { suppressTracing } from "@opentelemetry/core";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { JsonTraceSerializer } from "@opentelemetry/otlp-transformer";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, WebTracerProvider } from "@opentelemetry/sdk-trace-web";

const INGESTION_PATH = "/__facilis/telemetry/v1/traces";
const EXPORT_TIMEOUT_MS = 3000;

declare global {
  interface Window {
    __SPIKE?: { done: boolean; status: number; items: number; error?: string };
  }
}

/**
 * OTLP/HTTP JSON browser exporter. The OTLP/JSON wire format is what the ingestion route
 * validates, and the export runs under `suppressTracing` so it is never traced itself.
 */
function createExporter(url: string) {
  return {
    export(spans: Parameters<typeof JsonTraceSerializer.serializeRequest>[0], callback: (result: { code: number; error?: Error }) => void) {
      const body = JsonTraceSerializer.serializeRequest(spans);
      if (body === undefined) {
        callback({ code: 1, error: new Error("otlp serialize failed") });
        return;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);
      void context.with(suppressTracing(context.active()), () =>
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: controller.signal,
        })
          .then((response) => {
            clearTimeout(timer);
            callback(
              response.ok
                ? { code: 0 }
                : { code: 1, error: new Error("ingestion answered " + response.status) },
            );
          })
          .catch((error: unknown) => {
            clearTimeout(timer);
            callback({ code: 1, error: error instanceof Error ? error : new Error(String(error)) });
          }),
      );
    },
    shutdown: () => Promise.resolve(),
    forceFlush: () => Promise.resolve(),
  };
}

const provider = new WebTracerProvider({
  resource: resourceFromAttributes({
    "service.name": "facilis-spike-web",
    "deployment.environment.name": "production",
  }),
  spanProcessors: [
    new BatchSpanProcessor(createExporter(INGESTION_PATH), { scheduledDelayMillis: 200 }),
  ],
});
provider.register({ contextManager: new ZoneContextManager() });

// Trace headers propagate only to the app's own API origin (D-203 §2), never third parties.
const apiOrigin = new RegExp("^" + location.origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
registerInstrumentations({
  instrumentations: [
    new FetchInstrumentation({
      propagateTraceHeaderCorsUrls: [apiOrigin],
      ignoreUrls: [new RegExp(INGESTION_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))],
    }),
  ],
});

const status = document.querySelector("#status");
const list = document.querySelector("#items");

async function run(): Promise<void> {
  const response = await fetch("/api/items");
  const body = (await response.json()) as { items: { id: number; label: string }[] };
  if (status) {
    status.textContent =
      "GET /api/items → " + response.status + " · " + body.items.length + " rows";
  }
  if (list) {
    list.innerHTML = body.items
      .map((item) => "<li>" + item.id + " — " + item.label + "</li>")
      .join("");
  }
  window.__SPIKE = { done: true, status: response.status, items: body.items.length };
}

run().catch((error: unknown) => {
  window.__SPIKE = {
    done: true,
    status: 0,
    items: 0,
    error: error instanceof Error ? error.message : String(error),
  };
});
