/**
 * Fetch/XHR/document-load instrumentation (D-203 §2). traceparent propagates to the app's
 * own origin only — never third parties — and the export endpoint itself is ignored so the
 * RUM export is not instrumented (the exporter also runs under suppressTracing).
 */
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import type { DocumentLoadInstrumentationConfig } from "@opentelemetry/instrumentation-document-load";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import type { FetchInstrumentationConfig } from "@opentelemetry/instrumentation-fetch";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import type { XMLHttpRequestInstrumentationConfig } from "@opentelemetry/instrumentation-xml-http-request";
import type { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import type { RumConfig } from "./config.ts";

export interface RumInstrumentationConfigs {
  readonly fetch: FetchInstrumentationConfig;
  readonly xhr: XMLHttpRequestInstrumentationConfig;
  readonly documentLoad: DocumentLoadInstrumentationConfig;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Pure factory: tests assert the origin restriction and export ignore without a browser. */
export function buildInstrumentations(
  config: RumConfig,
  origin: string,
): RumInstrumentationConfigs {
  // Anchored, escaped and boundary-checked: "https://app.example" must not match
  // "https://app.example.evil.com" — a lookalike origin is a third party (D-203 §2).
  const ownOrigin = new RegExp("^" + escapeRegExp(origin) + "(?=/|$)");
  // Both the path and its absolute form: fetch resolves URLs before matching ignoreUrls.
  const ignoreUrls = [
    new RegExp(escapeRegExp(config.endpoint)),
    new RegExp("^" + escapeRegExp(origin + config.endpoint)),
  ];
  return {
    fetch: { propagateTraceHeaderCorsUrls: [ownOrigin], ignoreUrls },
    xhr: { propagateTraceHeaderCorsUrls: [ownOrigin], ignoreUrls },
    documentLoad: {},
  };
}

export function registerRumInstrumentations(
  config: RumConfig,
  origin: string,
  tracerProvider: WebTracerProvider,
): void {
  const configs = buildInstrumentations(config, origin);
  registerInstrumentations({
    tracerProvider,
    instrumentations: [
      new FetchInstrumentation(configs.fetch),
      new XMLHttpRequestInstrumentation(configs.xhr),
      new DocumentLoadInstrumentation(configs.documentLoad),
    ],
  });
}
