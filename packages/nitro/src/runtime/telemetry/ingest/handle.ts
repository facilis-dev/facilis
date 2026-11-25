/**
 * The ingestion pipeline in contract order (spec §8.8): disabled → origin → tenant key →
 * rate limit (before the body is read) → body cap → OTLP schema → batch cap → scrub →
 * dedup → forward. Nothing here reads application data; every rejection is a code, never
 * prose, and the only success body is the OTLP partial-success count.
 */
import type { HeaderReader } from "../../http-guard.ts";
import { MAX_INGEST_BODY_BYTES, MAX_SPANS_PER_BATCH, type TelemetryConfig } from "../config.ts";
import { readBodyCapped } from "./body.ts";
import type { SpanDeduplicator } from "./dedup.ts";
import type { forwardToCollector } from "./forward.ts";
import { isAllowedOrigin, requestOrigin } from "./origin.ts";
import { clientIp, type SpanRateLimiter } from "./rate-limit.ts";
import { countSpans, exportRequestSchema } from "./schema.ts";
import { scrubExportRequest } from "./scrub.ts";

/** The public write-only key the browser presents; the collector credential never travels. */
export const TENANT_KEY_HEADER = "x-facilis-telemetry-key";

/** Structural request: a web Request and Nitro's event.req both satisfy it. */
export interface IngestRequest {
  readonly url: string;
  readonly headers: HeaderReader;
  readonly body: ReadableStream<Uint8Array> | null;
}

export interface IngestDeps {
  readonly config: TelemetryConfig;
  readonly limiter: SpanRateLimiter;
  readonly dedup: SpanDeduplicator;
  readonly forward: typeof forwardToCollector;
}

export interface IngestResponse {
  readonly status: number;
  readonly body: unknown;
  /** Extra headers only (retry-after); the route adapter sets the JSON content type. */
  readonly headers?: Readonly<Record<string, string>>;
}

function rejected(status: number, code: string): IngestResponse {
  return { status, body: { code } };
}

function rateLimited(retryAfterSeconds: number): IngestResponse {
  return {
    status: 429,
    body: { code: "rate_limited" },
    headers: { "retry-after": String(retryAfterSeconds) },
  };
}

export async function ingestTraceRequest(
  request: IngestRequest,
  deps: IngestDeps,
): Promise<IngestResponse> {
  const { config } = deps;
  const endpoint = config.endpoint;
  // Disabled means absent (spec §8.8): 404, never 401/403, and no forwarding target either.
  if (!config.enabled || endpoint === null) {
    return rejected(404, "not_found");
  }

  // An empty allowlist leaves the route reachable from the app's own origin only
  // (docs/MANAGED-DEPLOYMENT.md §3); a configured list is exact and admits nothing else.
  const ownOrigin =
    config.allowedOrigins.length === 0 ? requestOrigin(request.url, request.headers) : null;
  const allowedOrigins =
    config.allowedOrigins.length > 0
      ? config.allowedOrigins
      : ownOrigin === null
        ? []
        : [ownOrigin];
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(allowedOrigins, origin)) {
    return rejected(403, "origin_rejected");
  }

  // The browser holds only the public write-only tenant key; with none configured there is
  // no legitimate writer, so every POST is rejected (fail-closed, D-146).
  const presentedKey = request.headers.get(TENANT_KEY_HEADER);
  if (config.tenantKey === null || presentedKey !== config.tenantKey) {
    return rejected(403, "tenant_key_rejected");
  }

  // Per origin/IP/tenant: one deployment carries one public tenant key, so the validated
  // key completes the composite. The probe runs BEFORE the body is read (spec §8.8).
  const key = origin + "|" + clientIp(request.headers) + "|" + config.tenantKey;
  const preParse = deps.limiter.take(key, 1);
  if (!preParse.allowed) {
    return rateLimited(preParse.retryAfterSeconds);
  }

  const capped = await readBodyCapped(request, MAX_INGEST_BODY_BYTES);
  if (!capped.ok) {
    return rejected(413, "payload_too_large");
  }

  let json: unknown;
  try {
    json = JSON.parse(capped.text);
  } catch {
    return rejected(400, "invalid_json");
  }
  const parsed = exportRequestSchema.safeParse(json);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        code: "invalid_otlp",
        // Structural schema paths and codes only — never the rejected values themselves.
        issues: parsed.error.issues.slice(0, 4).map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
        })),
      },
    };
  }

  const spanCount = countSpans(parsed.data);
  if (spanCount > MAX_SPANS_PER_BATCH) {
    return {
      status: 400,
      body: { code: "batch_too_large", spans: spanCount, max: MAX_SPANS_PER_BATCH },
    };
  }
  if (spanCount > 1) {
    const postParse = deps.limiter.take(key, spanCount - 1);
    if (!postParse.allowed) {
      return rateLimited(postParse.retryAfterSeconds);
    }
  }

  const scrubbed = scrubExportRequest(parsed.data);
  let rejectedSpans = 0;
  const resourceSpans = scrubbed.payload.resourceSpans
    .map((resourceSpan) => ({
      ...resourceSpan,
      scopeSpans: resourceSpan.scopeSpans.map((scopeSpan) => ({
        spans: scopeSpan.spans.filter((span) => {
          const accepted = deps.dedup.accept(span.traceId, span.spanId);
          if (!accepted) {
            rejectedSpans += 1;
          }
          return accepted;
        }),
      })),
    }))
    .filter((resourceSpan) =>
      resourceSpan.scopeSpans.some((scopeSpan) => scopeSpan.spans.length > 0),
    );

  if (resourceSpans.length === 0) {
    return {
      status: 200,
      body: { partialSuccess: { rejectedSpans, errorMessage: "all spans already seen" } },
    };
  }

  const forwarded = await deps.forward(endpoint, { resourceSpans });
  if (!forwarded.ok) {
    return rejected(502, "collector_unavailable");
  }
  return {
    status: 200,
    body: {
      partialSuccess: {
        rejectedSpans,
        errorMessage: "scrubbed " + scrubbed.droppedAttributes + " attributes",
      },
    },
  };
}
