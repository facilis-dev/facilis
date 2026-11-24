import { describe, expect, it, vi } from "vitest";

import type { TelemetryConfig } from "../config.ts";
import { SpanDeduplicator } from "./dedup.ts";
import { ingestTraceRequest, TENANT_KEY_HEADER, type IngestDeps, type IngestRequest } from "./handle.ts";
import { SpanRateLimiter } from "./rate-limit.ts";
import type { OtlpExportRequest } from "./schema.ts";

const ORIGIN = "https://app.acme.example";
const ENDPOINT = "https://otel.acme.example:4318";
const KEY = "pub_write_only_1";
const TRACE = "0af7651916cd43dd8448eb211c80319c";

let spanSeq = 0;
function nextSpanId(): string {
  spanSeq += 1;
  return spanSeq.toString(16).padStart(16, "0");
}

function config(overrides: Partial<TelemetryConfig> = {}): TelemetryConfig {
  return {
    enabled: true,
    endpoint: ENDPOINT,
    sampling: 1,
    serviceName: "facilis-app",
    deploymentId: null,
    allowedOrigins: [ORIGIN],
    tenantKey: KEY,
    spansPerMinute: 1000,
    ...overrides,
  };
}

function batch(spanCount = 1, attributes: { key: string; value: { stringValue: string } }[] = []): OtlpExportRequest {
  return {
    resourceSpans: [
      {
        scopeSpans: [
          {
            spans: Array.from({ length: spanCount }, () => ({
              traceId: TRACE,
              spanId: nextSpanId(),
              name: "GET /api/items",
              startTimeUnixNano: "1",
              endTimeUnixNano: "2",
              attributes,
            })),
          },
        ],
      },
    ],
  };
}

function request(
  body: unknown,
  headers: Record<string, string> = {},
): IngestRequest {
  const all = new Headers({
    origin: ORIGIN,
    [TENANT_KEY_HEADER]: KEY,
    "content-type": "application/json",
    ...headers,
  });
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    url: ORIGIN + "/__facilis/telemetry/v1/traces",
    headers: all,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
  };
}

function deps(overrides: Partial<IngestDeps> = {}): IngestDeps {
  return {
    config: config(),
    limiter: new SpanRateLimiter(1000),
    dedup: new SpanDeduplicator(),
    forward: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    ...overrides,
  };
}

describe("ingestTraceRequest gate chain", () => {
  it("answers 404 when disabled, before any other gate", async () => {
    const result = await ingestTraceRequest(
      request(batch(), { origin: "https://evil.example" }),
      deps({ config: config({ enabled: false }) }),
    );
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ code: "not_found" });
  });

  it("answers 404 with no collector target", async () => {
    const result = await ingestTraceRequest(request(batch()), deps({ config: config({ endpoint: null }) }));
    expect(result.status).toBe(404);
  });

  it("rejects a foreign, null or missing origin with 403", async () => {
    for (const origin of ["https://evil.example", "null", ""]) {
      const result = await ingestTraceRequest(request(batch(), { origin }), deps());
      expect(result.status).toBe(403);
      expect(result.body).toEqual({ code: "origin_rejected" });
    }
    const missing = request(batch());
    const noOrigin = new Headers(missing.headers as Headers);
    noOrigin.delete("origin");
    const result = await ingestTraceRequest({ ...missing, headers: noOrigin }, deps());
    expect(result.status).toBe(403);
  });

  it("rejects a missing or wrong tenant key with 403", async () => {
    const wrong = await ingestTraceRequest(request(batch(), { [TENANT_KEY_HEADER]: "other" }), deps());
    expect(wrong.status).toBe(403);
    expect(wrong.body).toEqual({ code: "tenant_key_rejected" });
    const unset = await ingestTraceRequest(request(batch()), deps({ config: config({ tenantKey: null }) }));
    expect(unset.status).toBe(403);
  });

  it("rate-limits BEFORE the body is read and answers 429 with retry-after", async () => {
    let bodyRead = false;
    const inner = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const unreadable: IngestRequest = {
      url: ORIGIN + "/x",
      headers: new Headers({ origin: ORIGIN, [TENANT_KEY_HEADER]: KEY }),
      body: {
        getReader: () => {
          bodyRead = true;
          return inner.getReader();
        },
      } as unknown as ReadableStream<Uint8Array>,
    };
    const limiter = new SpanRateLimiter(1);
    expect((await ingestTraceRequest(request(batch()), deps({ limiter }))).status).toBe(200);
    const result = await ingestTraceRequest(unreadable, deps({ limiter }));
    expect(result.status).toBe(429);
    expect(result.body).toEqual({ code: "rate_limited" });
    expect(Number(result.headers?.["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(bodyRead).toBe(false);
  });

  it("caps the body at 1 MiB with 413", async () => {
    const result = await ingestTraceRequest(request("x".repeat(1024 * 1024 + 1)), deps());
    expect(result.status).toBe(413);
    expect(result.body).toEqual({ code: "payload_too_large" });
  });

  it("answers 400 invalid_json for a non-JSON body", async () => {
    const result = await ingestTraceRequest(request("{not json"), deps());
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ code: "invalid_json" });
  });

  it("answers 400 invalid_otlp with structural issues only", async () => {
    const result = await ingestTraceRequest(request({ resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: "bad" }] }] }] }), deps());
    expect(result.status).toBe(400);
    const body = result.body as { code: string; issues: { path: string; code: string }[] };
    expect(body.code).toBe("invalid_otlp");
    expect(body.issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain("bad");
  });

  it("answers 400 batch_too_large above the span cap", async () => {
    const result = await ingestTraceRequest(request(batch(257)), deps());
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ code: "batch_too_large", spans: 257, max: 256 });
  });

  it("charges the batch size post-parse so one huge batch cannot bypass the cap", async () => {
    const limiter = new SpanRateLimiter(5);
    const result = await ingestTraceRequest(request(batch(6)), deps({ limiter }));
    // 1 pre-parse token + 5 post-parse would exceed the 5-span bucket.
    expect(result.status).toBe(429);
  });

  it("scrubs before forwarding and reports the dropped count", async () => {
    const forward = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const result = await ingestTraceRequest(
      request(batch(1, [
        { key: "http.request.method", value: { stringValue: "GET" } },
        { key: "url.full", value: { stringValue: "https://app.example/x?secret=1" } },
      ])),
      deps({ forward }),
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      partialSuccess: { rejectedSpans: 0, errorMessage: "scrubbed 1 attributes" },
    });
    const [endpoint, payload] = forward.mock.calls[0] as [string, OtlpExportRequest];
    expect(endpoint).toBe(ENDPOINT);
    const span = payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(span?.attributes).toEqual([{ key: "http.request.method", value: { stringValue: "GET" } }]);
  });

  it("dedups replayed spans and answers 200 without forwarding an empty batch", async () => {
    const dedup = new SpanDeduplicator();
    const forward = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const fixed = batch(1);
    const first = await ingestTraceRequest(request(fixed), deps({ dedup, forward }));
    expect(first.status).toBe(200);
    const replay = await ingestTraceRequest(request(fixed), deps({ dedup, forward }));
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({
      partialSuccess: { rejectedSpans: 1, errorMessage: "all spans already seen" },
    });
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("answers 502 collector_unavailable when the forward fails", async () => {
    const forward = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const result = await ingestTraceRequest(request(batch()), deps({ forward }));
    expect(result.status).toBe(502);
    expect(result.body).toEqual({ code: "collector_unavailable" });
  });

  it("falls back to the request's own origin when the allowlist is empty", async () => {
    const own = deps({ config: config({ allowedOrigins: [] }) });
    expect((await ingestTraceRequest(request(batch()), own)).status).toBe(200);
    const foreign = await ingestTraceRequest(request(batch(), { origin: "https://evil.example" }), own);
    expect(foreign.status).toBe(403);
  });
});
