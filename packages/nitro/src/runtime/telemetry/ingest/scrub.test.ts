import { describe, expect, it } from "vitest";

import {
  RESOURCE_ATTRIBUTE_ALLOWLIST,
  SPAN_ATTRIBUTE_ALLOWLIST,
  sanitizeSpanName,
  scrubExportRequest,
} from "./scrub.ts";
import type { OtlpAttribute, OtlpExportRequest } from "./schema.ts";

const TRACE = "0af7651916cd43dd8448eb211c80319c";
const SPAN = "b7ad6b7169203331";

function attr(key: string, value: OtlpAttribute["value"]): OtlpAttribute {
  return { key, value };
}

function payload(
  attributes: OtlpAttribute[],
  resourceAttributes: OtlpAttribute[] = [],
): OtlpExportRequest {
  return {
    resourceSpans: [
      {
        resource: { attributes: resourceAttributes },
        scopeSpans: [
          {
            spans: [
              {
                traceId: TRACE,
                spanId: SPAN,
                name: "GET /orders/123?token=secret#frag",
                startTimeUnixNano: "1",
                endTimeUnixNano: "2",
                attributes,
                status: { code: 2, message: "input value leaked: secret" },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("sanitizeSpanName", () => {
  it("drops query/fragment and collapses concrete ids to templates", () => {
    expect(sanitizeSpanName("GET /orders/123?token=secret#frag")).toBe("GET /orders/:id");
    expect(sanitizeSpanName("GET /users/0af76519-16cd-43dd-8448-eb211c80319c/items")).toBe(
      "GET /users/:id/items",
    );
  });

  it("caps the name length", () => {
    expect(sanitizeSpanName("x".repeat(500)).length).toBe(120);
  });
});

describe("scrubExportRequest", () => {
  it("keeps only the framework vocabulary and strips values/URLs/headers/PII", () => {
    const scrubbed = scrubExportRequest(
      payload([
        attr("http.request.method", { stringValue: "GET" }),
        attr("http.route", { stringValue: "/orders/:id" }),
        attr("http.response.status_code", { intValue: 200 }),
        attr("db.collection.name", { stringValue: "orders" }),
        attr("url.full", { stringValue: "https://app.example/orders/123?token=secret" }),
        attr("http.request.header.authorization", { stringValue: "Bearer secret" }),
        attr("http.request.body", { stringValue: '{"password":"hunter2"}' }),
        attr("enduser.email", { stringValue: "user@example.com" }),
        attr("user.id", { stringValue: "u-1" }),
        attr("db.statement", { stringValue: "SELECT * FROM users WHERE email='x'" }),
      ]),
    );
    const span = scrubbed.payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(span?.attributes?.map((a) => a.key)).toEqual([
      "http.request.method",
      "http.route",
      "http.response.status_code",
      "db.collection.name",
    ]);
    expect(scrubbed.droppedAttributes).toBe(6);
    // The name lost its query and concrete id; the status lost its message.
    expect(span?.name).toBe("GET /orders/:id");
    expect(span?.status).toEqual({ code: 2 });
  });

  it("maps legacy semantic-convention keys onto the vocabulary (spike F6)", () => {
    const scrubbed = scrubExportRequest(
      payload([
        attr("http.method", { stringValue: "POST" }),
        attr("http.status_code", { intValue: 201 }),
        attr("db.system", { stringValue: "postgresql" }),
        attr("db.operation", { stringValue: "SELECT" }),
        attr("db.table", { stringValue: "items" }),
        // Legacy raw-URL keys have no mapping and stay stripped.
        attr("http.url", { stringValue: "https://app.example/items?q=1" }),
        attr("http.host", { stringValue: "app.example" }),
        attr("http.scheme", { stringValue: "https" }),
      ]),
    );
    const span = scrubbed.payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(span?.attributes).toEqual([
      { key: "http.request.method", value: { stringValue: "POST" } },
      { key: "http.response.status_code", value: { intValue: 201 } },
      { key: "db.system.name", value: { stringValue: "postgresql" } },
      { key: "db.operation.name", value: { stringValue: "SELECT" } },
      { key: "db.collection.name", value: { stringValue: "items" } },
    ]);
    expect(scrubbed.droppedAttributes).toBe(3);
  });

  it("drops structured values even on allowlisted keys and caps strings", () => {
    const scrubbed = scrubExportRequest(
      payload([
        attr("http.route", { arrayValue: { values: [{ stringValue: "/a" }] } }),
        attr("http.route", {
          kvlistValue: { values: [{ key: "k", value: { stringValue: "v" } }] },
        }),
        attr("http.route", { stringValue: "x".repeat(500) }),
      ]),
    );
    const span = scrubbed.payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(span?.attributes).toEqual([
      { key: "http.route", value: { stringValue: "x".repeat(128) } },
    ]);
    expect(scrubbed.droppedAttributes).toBe(2);
  });

  it("scrubs resource attributes to the resource allowlist", () => {
    const scrubbed = scrubExportRequest(
      payload(
        [],
        [
          attr("service.name", { stringValue: "acme-shop" }),
          attr("deployment.id", { stringValue: "dep-1" }),
          attr("telemetry.sdk.language", { stringValue: "webjs" }),
          attr("user.id", { stringValue: "u-1" }),
          attr("host.name", { stringValue: "internal-host" }),
        ],
      ),
    );
    const resource = scrubbed.payload.resourceSpans[0]?.resource;
    expect(resource?.attributes?.map((a) => a.key)).toEqual([
      "service.name",
      "deployment.id",
      "telemetry.sdk.language",
    ]);
    expect(scrubbed.droppedAttributes).toBe(2);
  });

  it("preserves ids, times, kind and parent while dropping everything else", () => {
    const input = payload([]);
    const span = input.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    if (span === undefined) throw new Error("fixture span missing");
    span.parentSpanId = "1111111111111111";
    span.kind = 3;
    const scrubbed = scrubExportRequest(input);
    const out = scrubbed.payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(out?.traceId).toBe(TRACE);
    expect(out?.spanId).toBe(SPAN);
    expect(out?.parentSpanId).toBe("1111111111111111");
    expect(out?.kind).toBe(3);
    expect(out?.startTimeUnixNano).toBe("1");
    expect(out?.endTimeUnixNano).toBe("2");
  });

  it("allowlists are the framework vocabulary, reviewable in one place", () => {
    expect(SPAN_ATTRIBUTE_ALLOWLIST.has("url.full")).toBe(false);
    expect(SPAN_ATTRIBUTE_ALLOWLIST.has("http.route")).toBe(true);
    expect(SPAN_ATTRIBUTE_ALLOWLIST.has("facilis.job.name")).toBe(true);
    expect(RESOURCE_ATTRIBUTE_ALLOWLIST.has("service.name")).toBe(true);
    expect(RESOURCE_ATTRIBUTE_ALLOWLIST.has("enduser.email")).toBe(false);
  });
});

describe("frontend RUM vocabulary (D-208)", () => {
  it("keeps the browser.web_vital triple, including a numeric (double) value", () => {
    const scrubbed = scrubExportRequest(
      payload([
        attr("browser.web_vital.name", { stringValue: "LCP" }),
        attr("browser.web_vital.value", { doubleValue: 2500.5 }),
        attr("browser.web_vital.rating", { stringValue: "good" }),
      ]),
    );
    const span = scrubbed.payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(span?.attributes).toEqual([
      { key: "browser.web_vital.name", value: { stringValue: "LCP" } },
      { key: "browser.web_vital.value", value: { doubleValue: 2500.5 } },
      { key: "browser.web_vital.rating", value: { stringValue: "good" } },
    ]);
    expect(scrubbed.droppedAttributes).toBe(0);
  });

  it("keeps an integer vital value too (the serializer may emit intValue)", () => {
    const scrubbed = scrubExportRequest(
      payload([attr("browser.web_vital.value", { intValue: 120 })]),
    );
    const span = scrubbed.payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(span?.attributes).toEqual([
      { key: "browser.web_vital.value", value: { intValue: 120 } },
    ]);
  });

  it("keeps error type + source and drops exception prose and browser PII", () => {
    const scrubbed = scrubExportRequest(
      payload([
        attr("error.type", { stringValue: "TypeError" }),
        attr("facilis.rum.source", { stringValue: "window.onerror" }),
        attr("exception.message", { stringValue: "user alice failed" }),
        attr("exception.stacktrace", { stringValue: "at /home/alice/app.ts:1" }),
        attr("http.user_agent", { stringValue: "Mozilla/5.0 (someone)" }),
        attr("url.full", { stringValue: "https://app.example/?secret=1" }),
      ]),
    );
    const span = scrubbed.payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(span?.attributes).toEqual([
      { key: "error.type", value: { stringValue: "TypeError" } },
      { key: "facilis.rum.source", value: { stringValue: "window.onerror" } },
    ]);
    expect(scrubbed.droppedAttributes).toBe(4);
    expect(JSON.stringify(scrubbed.payload)).not.toContain("alice");
    expect(JSON.stringify(scrubbed.payload)).not.toContain("secret");
  });

  it("leaves the fixed RUM span names intact", () => {
    expect(sanitizeSpanName("browser.web_vital")).toBe("browser.web_vital");
    expect(sanitizeSpanName("browser.error")).toBe("browser.error");
  });

  it("allowlists the RUM names and nothing else browser-side", () => {
    for (const key of [
      "browser.web_vital.name",
      "browser.web_vital.value",
      "browser.web_vital.rating",
      "error.type",
      "facilis.rum.source",
    ]) {
      expect(SPAN_ATTRIBUTE_ALLOWLIST.has(key)).toBe(true);
    }
    expect(SPAN_ATTRIBUTE_ALLOWLIST.has("exception.message")).toBe(false);
    expect(SPAN_ATTRIBUTE_ALLOWLIST.has("http.user_agent")).toBe(false);
  });
});

describe("scrub hardening (issue #141)", () => {
  function spanAttributes(result: ReturnType<typeof scrubExportRequest>): OtlpAttribute[] {
    return result.payload.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.attributes ?? [];
  }

  it("drops non-finite numbers (JSON parses 1e999 as Infinity; it serializes to null)", () => {
    const result = scrubExportRequest(
      payload([
        attr("browser.web_vital.value", { doubleValue: Number.POSITIVE_INFINITY }),
        attr("facilis.job.attempt", { intValue: Number.POSITIVE_INFINITY }),
        attr("http.response.status_code", { intValue: 200 }),
      ]),
    );
    expect(spanAttributes(result).map((a) => a.key)).toEqual(["http.response.status_code"]);
    expect(result.droppedAttributes).toBeGreaterThanOrEqual(2);
  });

  it("scrubs query strings and concrete ids inside http.route values", () => {
    const result = scrubExportRequest(
      payload([attr("http.route", { stringValue: "/orders/123?token=secret#frag" })]),
    );
    expect(spanAttributes(result)[0]?.value).toEqual({ stringValue: "/orders/:id" });
  });

  it("reduces absolute-URL http.route values to the templated pathname", () => {
    const result = scrubExportRequest(
      payload([
        attr("http.route", {
          stringValue: "https://app.example/users/0af76519-16cd-43dd-8448-eb211c80319c?x=1",
        }),
      ]),
    );
    expect(spanAttributes(result)[0]?.value).toEqual({ stringValue: "/users/:id" });
  });

  it("templates email-shaped path segments in names and route values", () => {
    expect(sanitizeSpanName("GET /users/alice@example.com/edit")).toBe("GET /users/:id/edit");
    const result = scrubExportRequest(
      payload([attr("http.route", { stringValue: "/users/alice@example.com" })]),
    );
    expect(spanAttributes(result)[0]?.value).toEqual({ stringValue: "/users/:id" });
  });

  it("reduces absolute-URL span names to the templated pathname (no scheme/host leak)", () => {
    expect(sanitizeSpanName("https://app.example/orders/123?token=secret")).toBe("/orders/:id");
    expect(sanitizeSpanName("http://internal-host:8080/admin")).toBe("/admin");
  });

  it("templates uppercase UUIDs like lowercase ones", () => {
    expect(sanitizeSpanName("GET /u/0AF76519-16CD-43DD-8448-EB211C80319C")).toBe("GET /u/:id");
  });

  it("drops span events and links structurally (exception prose never forwards)", () => {
    // Zod ignores unknown fields, so a parsed payload can still carry events/links at runtime.
    const input = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: TRACE,
                  spanId: SPAN,
                  name: "browser.error",
                  startTimeUnixNano: "1",
                  endTimeUnixNano: "2",
                  attributes: [],
                  events: [
                    {
                      name: "exception",
                      attributes: [
                        attr("exception.message", { stringValue: "alice@example.com failed" }),
                      ],
                    },
                  ],
                  links: [{ traceId: TRACE, spanId: SPAN }],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as OtlpExportRequest;
    const result = scrubExportRequest(input);
    const span = result.payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(span).toBeDefined();
    expect("events" in (span as object)).toBe(false);
    expect("links" in (span as object)).toBe(false);
    expect(JSON.stringify(result.payload)).not.toContain("alice");
  });
});
