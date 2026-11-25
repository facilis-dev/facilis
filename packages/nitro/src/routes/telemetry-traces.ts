import { defineHandler } from "nitro";

import { jsonResult, toResponse } from "../runtime/http.ts";
import { readTelemetryConfig, type TelemetryConfig } from "../runtime/telemetry/config.ts";
import { SpanDeduplicator } from "../runtime/telemetry/ingest/dedup.ts";
import { forwardToCollector } from "../runtime/telemetry/ingest/forward.ts";
import { ingestTraceRequest, type IngestDeps } from "../runtime/telemetry/ingest/handle.ts";
import { SpanRateLimiter } from "../runtime/telemetry/ingest/rate-limit.ts";

/**
 * POST /__facilis/telemetry/v1/traces — the public infrastructure ingestion route
 * (SPEC §6.10/§8.8, D-203 §3), the named framework-only exception to invariant 1.
 *
 * Mounted by the Nitro module like the SSO/token endpoints, never user-authorable: no
 * session and no dbTables, gates instead of auth (origin allowlist, public tenant key,
 * span/min rate limit, 1 MiB body cap, OTLP schema, attribute scrub, span-id dedup).
 * Write-only: POST only, 404 when telemetry is disabled or the boot is non-production,
 * 405 on any other method when enabled. Responses carry codes and OTLP partial-success
 * counts, never application data; the scrubbed payload goes to the operator's collector.
 */

// One bucket set per process, rebuilt only when the deploy's span/min cap changes; the
// dedup window rides along so a cap change cannot resurrect already-rejected span ids.
let state: { spansPerMinute: number; deps: Omit<IngestDeps, "config"> } | null = null;

function depsFor(config: TelemetryConfig): IngestDeps {
  if (state === null || state.spansPerMinute !== config.spansPerMinute) {
    state = {
      spansPerMinute: config.spansPerMinute,
      deps: {
        limiter: new SpanRateLimiter(config.spansPerMinute),
        dedup: new SpanDeduplicator(),
        forward: forwardToCollector,
      },
    };
  }
  return { config, ...state.deps };
}

export default defineHandler(async (event) => {
  const config = readTelemetryConfig();
  // Disabled means absent (SPEC §8.8): 404, never 401/403, in every non-production boot too.
  if (!config.enabled || config.endpoint === null) {
    return toResponse(jsonResult(404, { code: "not_found" }));
  }
  if ((event.req.method ?? "GET").toUpperCase() !== "POST") {
    return toResponse(jsonResult(405, { code: "method_not_allowed" }, { allow: "POST" }));
  }
  const result = await ingestTraceRequest(event.req, depsFor(config));
  return toResponse(jsonResult(result.status, result.body, result.headers ?? {}));
});
