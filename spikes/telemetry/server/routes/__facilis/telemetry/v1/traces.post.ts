import { defineHandler } from "nitro";
import { SpanDeduplicator } from "../../../../lib/ingest/dedup";
import { forwardToCollector } from "../../../../lib/ingest/forward";
import { ingestTraceRequest, type IngestDeps } from "../../../../lib/ingest/handle";
import { SpanRateLimiter } from "../../../../lib/ingest/rate-limit";
import { INGESTION_PATH, readTelemetryConfig } from "../../../../lib/telemetry/config";

const config = readTelemetryConfig();
const limiter = new SpanRateLimiter(config.spansPerMinute);
const dedup = new SpanDeduplicator();
const deps: IngestDeps = { config, limiter, dedup, forward: forwardToCollector };
const JSON_HEADERS = { "content-type": "application/json" };

/**
 * Framework-mounted, write-only OTLP ingestion route (spec §8.8, D-203 §3). It is not
 * user-authorable and has no read surface: POST only, 404 when telemetry is disabled.
 */
export default defineHandler(async (event) => {
  if (!config.enabled || event.url.pathname !== INGESTION_PATH) {
    return new Response(JSON.stringify({ code: "not_found" }), {
      status: 404,
      headers: JSON_HEADERS,
    });
  }
  const result = await ingestTraceRequest(event.req, deps);
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { ...JSON_HEADERS, ...result.headers },
  });
});
