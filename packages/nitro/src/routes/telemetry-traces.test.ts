import type { H3Event } from "nitro";
import {
  installRuntimeConfig,
  SecretString,
  type FacilisRuntimeConfig,
} from "@facilis.dev/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the collector round trip is mocked: every gate in the handler is the subject.
vi.mock("../runtime/telemetry/ingest/forward.ts", () => ({
  forwardToCollector: vi.fn(),
}));

import { forwardToCollector } from "../runtime/telemetry/ingest/forward.ts";
import { TENANT_KEY_HEADER } from "../runtime/telemetry/ingest/handle.ts";
import type { OtlpExportRequest } from "../runtime/telemetry/ingest/schema.ts";
import handler from "./telemetry-traces.ts";

const ROUTE = "/__facilis/telemetry/v1/traces";
const ENDPOINT = "https://otel.acme.example:4318";
const KEY = "pub_write_only_1";
const TRACE = "0af7651916cd43dd8448eb211c80319c";
const ORIGINAL_ENV = { ...process.env };

// Unique origins and span ids per test: the process-wide bucket/dedup state must not leak
// one test's rate charge or replay rejection into another.
let seq = 0;
function uniqueOrigin(): string {
  seq += 1;
  return "https://app-" + seq + ".acme.example";
}
function uniqueSpanId(): string {
  seq += 1;
  return seq.toString(16).padStart(16, "0");
}

function enable(origin: string, extra: FacilisRuntimeConfig = {}): void {
  process.env["NODE_ENV"] = "production";
  installRuntimeConfig({
    telemetryEnabled: true,
    telemetryEndpoint: ENDPOINT,
    telemetryOrigins: [origin],
    telemetryTenantKey: new SecretString(KEY),
    ...extra,
  });
}

function batch(spanCount = 1): OtlpExportRequest {
  return {
    resourceSpans: [
      {
        scopeSpans: [
          {
            spans: Array.from({ length: spanCount }, () => ({
              traceId: TRACE,
              spanId: uniqueSpanId(),
              name: "GET /api/items",
              startTimeUnixNano: "1",
              endTimeUnixNano: "2",
              attributes: [
                { key: "http.request.method", value: { stringValue: "GET" } },
                { key: "url.full", value: { stringValue: "https://app.example/items?secret=1" } },
              ],
            })),
          },
        ],
      },
    ],
  };
}

function event(
  origin: string,
  init: { method?: string; body?: string; headers?: Record<string, string>; url?: string } = {},
): H3Event {
  const headers: Record<string, string> = {
    origin,
    [TENANT_KEY_HEADER]: KEY,
    "content-type": "application/json",
    ...init.headers,
  };
  const request = new Request(init.url ?? origin + ROUTE, {
    method: init.method ?? "POST",
    headers,
    ...(init.body === undefined ? {} : { body: init.body }),
  });
  return { req: request } as unknown as H3Event;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  installRuntimeConfig({});
  vi.mocked(forwardToCollector).mockReset();
  vi.mocked(forwardToCollector).mockResolvedValue({ ok: true, status: 200 });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("telemetry ingestion route — disabled means absent", () => {
  it("answers 404 on POST and GET when the switch is off", async () => {
    process.env["NODE_ENV"] = "production";
    delete process.env["FACILIS_TELEMETRY_ENABLED"];
    for (const method of ["POST", "GET"]) {
      const response = await handler(
        event("https://app.acme.example", { method, body: method === "POST" ? "{}" : undefined }),
      );
      expect(response.status).toBe(404);
      expect(await json(response)).toEqual({ code: "not_found" });
    }
    expect(forwardToCollector).not.toHaveBeenCalled();
  });

  it("answers 404 in every non-production environment even with the switch on (D-200)", async () => {
    for (const nodeEnv of ["development", "test"]) {
      const origin = uniqueOrigin();
      enable(origin);
      process.env["NODE_ENV"] = nodeEnv;
      const response = await handler(event(origin, { body: JSON.stringify(batch()) }));
      expect(response.status).toBe(404);
    }
    expect(forwardToCollector).not.toHaveBeenCalled();
  });

  it("answers 404 with the switch on but no usable collector endpoint", async () => {
    const origin = uniqueOrigin();
    enable(origin, { telemetryEndpoint: "not a url" });
    const response = await handler(event(origin, { body: JSON.stringify(batch()) }));
    expect(response.status).toBe(404);
  });
});

describe("telemetry ingestion route — write-only", () => {
  it("answers 405 with allow: POST on every non-POST method when enabled", async () => {
    const origin = uniqueOrigin();
    enable(origin);
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
      const response = await handler(event(origin, { method }));
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      if (method !== "HEAD") expect(await json(response)).toEqual({ code: "method_not_allowed" });
    }
    expect(forwardToCollector).not.toHaveBeenCalled();
  });
});

describe("telemetry ingestion route — gates", () => {
  it("rejects a mismatched, null or missing origin with 403", async () => {
    const origin = uniqueOrigin();
    enable(origin);
    for (const headers of [
      { origin: "https://evil.example" },
      { origin: "null" },
      { origin: origin + ":443" },
    ]) {
      const response = await handler(event(origin, { body: JSON.stringify(batch()), headers }));
      expect(response.status).toBe(403);
      expect(await json(response)).toEqual({ code: "origin_rejected" });
    }
    expect(forwardToCollector).not.toHaveBeenCalled();
  });

  it("rejects a wrong or missing tenant key with 403", async () => {
    const origin = uniqueOrigin();
    enable(origin);
    for (const value of ["wrong-key", ""]) {
      const response = await handler(
        event(origin, { body: JSON.stringify(batch()), headers: { [TENANT_KEY_HEADER]: value } }),
      );
      expect(response.status).toBe(403);
      expect(await json(response)).toEqual({ code: "tenant_key_rejected" });
    }
  });

  it("rate-limits per origin with 429 + retry-after before parsing the body", async () => {
    const origin = uniqueOrigin();
    enable(origin, { telemetrySpansPerMin: 1 });
    const first = await handler(event(origin, { body: JSON.stringify(batch()) }));
    expect(first.status).toBe(200);
    const second = await handler(event(origin, { body: "{not even json" }));
    expect(second.status).toBe(429);
    expect(Number(second.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(await json(second)).toEqual({ code: "rate_limited" });
    // A different origin has its own bucket.
    const other = uniqueOrigin();
    enable(other, { telemetrySpansPerMin: 1 });
    expect((await handler(event(other, { body: JSON.stringify(batch()) }))).status).toBe(200);
  });

  it("caps the body at 1 MiB with 413 (declared length and streamed)", async () => {
    const origin = uniqueOrigin();
    enable(origin);
    const declared = await handler(event(origin, { body: "x".repeat(1024 * 1024 + 1) }));
    expect(declared.status).toBe(413);
    expect(await json(declared)).toEqual({ code: "payload_too_large" });

    const chunkedOrigin = uniqueOrigin();
    enable(chunkedOrigin);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
        controller.close();
      },
    });
    const request = new Request(chunkedOrigin + ROUTE, {
      method: "POST",
      headers: { origin: chunkedOrigin, [TENANT_KEY_HEADER]: KEY },
      body: stream,
      duplex: "half",
    } as RequestInit);
    const chunked = await handler({ req: request } as unknown as H3Event);
    expect(chunked.status).toBe(413);
  });

  it("answers 400 for invalid JSON, invalid OTLP and an oversized batch", async () => {
    const origin = uniqueOrigin();
    enable(origin);
    const badJson = await handler(event(origin, { body: "{not json" }));
    expect(badJson.status).toBe(400);
    expect(await json(badJson)).toEqual({ code: "invalid_json" });

    const badOtlp = await handler(event(origin, { body: JSON.stringify({ resourceSpans: [] }) }));
    expect(badOtlp.status).toBe(400);
    expect((await json(badOtlp))["code"]).toBe("invalid_otlp");

    const tooMany = await handler(event(origin, { body: JSON.stringify(batch(257)) }));
    expect(tooMany.status).toBe(400);
    expect(await json(tooMany)).toEqual({ code: "batch_too_large", spans: 257, max: 256 });
    expect(forwardToCollector).not.toHaveBeenCalled();
  });
});

describe("telemetry ingestion route — scrub, dedup, forward", () => {
  it("forwards only scrubbed spans and answers with OTLP partial-success counts", async () => {
    const origin = uniqueOrigin();
    enable(origin);
    const response = await handler(event(origin, { body: JSON.stringify(batch()) }));
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      partialSuccess: { rejectedSpans: 0, errorMessage: "scrubbed 1 attributes" },
    });
    expect(forwardToCollector).toHaveBeenCalledTimes(1);
    const [endpoint, payload] = vi.mocked(forwardToCollector).mock.calls[0] as [
      string,
      OtlpExportRequest,
    ];
    expect(endpoint).toBe(ENDPOINT);
    const span = payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(span?.attributes).toEqual([
      { key: "http.request.method", value: { stringValue: "GET" } },
    ]);
    expect(JSON.stringify(payload)).not.toContain("secret");
  });

  it("blunts a replayed batch via span-id dedup", async () => {
    const origin = uniqueOrigin();
    enable(origin);
    const body = JSON.stringify(batch());
    expect((await handler(event(origin, { body }))).status).toBe(200);
    const replay = await handler(event(origin, { body }));
    expect(replay.status).toBe(200);
    expect(await json(replay)).toEqual({
      partialSuccess: { rejectedSpans: 1, errorMessage: "all spans already seen" },
    });
    expect(forwardToCollector).toHaveBeenCalledTimes(1);
  });

  it("answers 502 when the collector is unreachable", async () => {
    const origin = uniqueOrigin();
    enable(origin);
    vi.mocked(forwardToCollector).mockResolvedValue({ ok: false, status: 0 });
    const response = await handler(event(origin, { body: JSON.stringify(batch()) }));
    expect(response.status).toBe(502);
    expect(await json(response)).toEqual({ code: "collector_unavailable" });
  });

  it("with an empty allowlist admits only the app's own origin", async () => {
    seq += 1;
    const own = "https://own-" + seq + ".acme.example";
    enable(own, { telemetryOrigins: [] });
    expect((await handler(event(own, { body: JSON.stringify(batch()) }))).status).toBe(200);
    const foreign = await handler(
      event(own, { body: JSON.stringify(batch()), headers: { origin: "https://evil.example" } }),
    );
    expect(foreign.status).toBe(403);
  });

  it("admits a browser vitals/error batch and scrubs it to the RUM vocabulary (D-209)", async () => {
    const origin = uniqueOrigin();
    enable(origin);
    const rumBatch: OtlpExportRequest = {
      resourceSpans: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "acme-shop" } }] },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: TRACE,
                  spanId: uniqueSpanId(),
                  name: "browser.web_vital",
                  startTimeUnixNano: "1",
                  endTimeUnixNano: "2",
                  attributes: [
                    { key: "browser.web_vital.name", value: { stringValue: "LCP" } },
                    { key: "browser.web_vital.value", value: { doubleValue: 2500.5 } },
                    { key: "browser.web_vital.rating", value: { stringValue: "good" } },
                    { key: "url.full", value: { stringValue: "https://app.example/?secret=1" } },
                  ],
                },
                {
                  traceId: TRACE,
                  spanId: uniqueSpanId(),
                  name: "browser.error",
                  startTimeUnixNano: "1",
                  endTimeUnixNano: "2",
                  attributes: [
                    { key: "error.type", value: { stringValue: "TypeError" } },
                    { key: "facilis.rum.source", value: { stringValue: "window.onerror" } },
                    { key: "exception.message", value: { stringValue: "secret failure detail" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const response = await handler(event(origin, { body: JSON.stringify(rumBatch) }));
    expect(response.status).toBe(200);
    expect(forwardToCollector).toHaveBeenCalledTimes(1);
    const [, payload] = vi.mocked(forwardToCollector).mock.calls[0] as [string, OtlpExportRequest];
    const spans = payload.resourceSpans[0]?.scopeSpans[0]?.spans ?? [];
    expect(spans[0]?.name).toBe("browser.web_vital");
    expect(spans[0]?.attributes).toEqual([
      { key: "browser.web_vital.name", value: { stringValue: "LCP" } },
      { key: "browser.web_vital.value", value: { doubleValue: 2500.5 } },
      { key: "browser.web_vital.rating", value: { stringValue: "good" } },
    ]);
    expect(spans[1]?.name).toBe("browser.error");
    expect(spans[1]?.attributes).toEqual([
      { key: "error.type", value: { stringValue: "TypeError" } },
      { key: "facilis.rum.source", value: { stringValue: "window.onerror" } },
    ]);
    expect(JSON.stringify(payload)).not.toContain("secret");
  });
});
