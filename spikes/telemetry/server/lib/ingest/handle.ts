import type { TelemetryConfig } from "../telemetry/config";
import { readBodyCapped } from "./body";
import type { SpanDeduplicator } from "./dedup";
import type { forwardToCollector } from "./forward";
import { isAllowedOrigin } from "./origin";
import type { SpanRateLimiter } from "./rate-limit";
import { countSpans, exportRequestSchema } from "./schema";
import { scrubExportRequest } from "./scrub";

export interface IngestDeps {
  readonly config: TelemetryConfig;
  readonly limiter: SpanRateLimiter;
  readonly dedup: SpanDeduplicator;
  readonly forward: typeof forwardToCollector;
}

export interface IngestResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

const JSON_HEADERS = { "content-type": "application/json" };

/**
 * The ingestion pipeline in contract order (spec §8.8): origin → rate limit (before the body
 * is read) → body cap → OTLP schema → batch cap → scrub → dedup → forward. Nothing here reads
 * application data; every rejection is a code, never prose.
 */
export async function ingestTraceRequest(
  request: Request,
  deps: IngestDeps,
): Promise<IngestResponse> {
  const { config } = deps;
  const collectorUrl = config.collectorUrl;
  if (!config.enabled || collectorUrl === null) {
    return { status: 404, body: { code: "not_found" }, headers: JSON_HEADERS };
  }

  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(config.allowedOrigins, origin)) {
    return { status: 403, body: { code: "origin_rejected" }, headers: JSON_HEADERS };
  }

  const key = origin ?? "unknown";
  const preParse = deps.limiter.take(key, 1);
  if (!preParse.allowed) {
    return {
      status: 429,
      body: { code: "rate_limited" },
      headers: { ...JSON_HEADERS, "retry-after": String(preParse.retryAfterSeconds) },
    };
  }

  const capped = await readBodyCapped(request, config.maxBodyBytes);
  if (!capped.ok) {
    return { status: 413, body: { code: "payload_too_large" }, headers: JSON_HEADERS };
  }

  let json: unknown;
  try {
    json = JSON.parse(capped.text);
  } catch {
    return { status: 400, body: { code: "invalid_json" }, headers: JSON_HEADERS };
  }
  const parsed = exportRequestSchema.safeParse(json);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        code: "invalid_otlp",
        issues: parsed.error.issues.slice(0, 4).map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
        })),
      },
      headers: JSON_HEADERS,
    };
  }

  const spanCount = countSpans(parsed.data);
  if (spanCount > config.maxSpansPerBatch) {
    return {
      status: 400,
      body: { code: "batch_too_large", spans: spanCount, max: config.maxSpansPerBatch },
      headers: JSON_HEADERS,
    };
  }
  if (spanCount > 1) {
    const postParse = deps.limiter.take(key, spanCount - 1);
    if (!postParse.allowed) {
      return {
        status: 429,
        body: { code: "rate_limited" },
        headers: { ...JSON_HEADERS, "retry-after": String(postParse.retryAfterSeconds) },
      };
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
    .filter((resourceSpan) => resourceSpan.scopeSpans.some((scopeSpan) => scopeSpan.spans.length > 0));

  if (resourceSpans.length === 0) {
    return {
      status: 200,
      body: { partialSuccess: { rejectedSpans, errorMessage: "all spans already seen" } },
      headers: JSON_HEADERS,
    };
  }

  const forwarded = await deps.forward(collectorUrl, { resourceSpans });
  if (!forwarded.ok) {
    return { status: 502, body: { code: "collector_unavailable" }, headers: JSON_HEADERS };
  }
  return {
    status: 200,
    body: {
      partialSuccess: {
        rejectedSpans,
        errorMessage: "scrubbed " + scrubbed.droppedAttributes + " attributes",
      },
    },
    headers: JSON_HEADERS,
  };
}
