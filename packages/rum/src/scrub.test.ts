import { describe, expect, it } from "vitest";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-web";
import {
  ScrubProcessor,
  scrubSpanAttributes,
  scrubSpanName,
  scrubUrl,
  templateSegments,
} from "./scrub.ts";

describe("templateSegments", () => {
  it("collapses numeric and UUID segments to :id", () => {
    expect(templateSegments("/orders/123")).toBe("/orders/:id");
    expect(templateSegments("/orders/123/items/456")).toBe("/orders/:id/items/:id");
    expect(templateSegments("/u/0af76519-16cd-43dd-8448-eb211c80319c")).toBe("/u/:id");
    expect(templateSegments("/u/0af76519-16cd-43dd-8448-eb211c80319c/edit")).toBe("/u/:id/edit");
  });

  it("leaves non-id segments alone", () => {
    expect(templateSegments("/todos/:id")).toBe("/todos/:id");
    expect(templateSegments("/api/items")).toBe("/api/items");
    // A numeric segment must be whole: "v2" is not an id.
    expect(templateSegments("/v2/items")).toBe("/v2/items");
  });
});

describe("scrubUrl", () => {
  it("keeps only the templated pathname of an absolute URL", () => {
    expect(scrubUrl("https://app.example/orders/123?token=secret#frag")).toBe("/orders/:id");
    expect(scrubUrl("https://user:pass@app.example/orders/123")).toBe("/orders/:id");
  });

  it("scrubs relative targets the same way", () => {
    expect(scrubUrl("/api/items?q=1")).toBe("/api/items");
    expect(scrubUrl("/orders/42#section")).toBe("/orders/:id");
  });

  it("drops query and fragment even without a parseable URL", () => {
    expect(scrubUrl("not a url?secret=1#x")).not.toContain("secret");
    expect(scrubUrl("not a url?secret=1#x")).not.toContain("#");
  });

  it("caps the result like the server's attribute strings", () => {
    expect(scrubUrl("/" + "a".repeat(500)).length).toBeLessThanOrEqual(128);
  });
});

describe("scrubSpanAttributes", () => {
  it("keeps the framework vocabulary, the RUM triple and error metadata", () => {
    const kept = scrubSpanAttributes({
      "http.request.method": "GET",
      "http.route": "/orders/:id",
      "http.response.status_code": 200,
      "db.system.name": "postgresql",
      "db.operation.name": "SELECT",
      "db.collection.name": "items",
      "facilis.job.name": "sync",
      "facilis.job.attempt": 1,
      "facilis.workflow.name": "onboard",
      "facilis.workflow.step": 2,
      "facilis.workflow.step.kind": "job",
      "browser.web_vital.name": "LCP",
      "browser.web_vital.value": 2500.5,
      "browser.web_vital.rating": "good",
      "error.type": "TypeError",
      "facilis.rum.source": "window.onerror",
    });
    expect(Object.keys(kept)).toHaveLength(16);
    expect(kept["browser.web_vital.value"]).toBe(2500.5);
  });

  it("keeps the legacy keys the 0.217 instrumentations emit, URLs scrubbed", () => {
    const kept = scrubSpanAttributes({
      "http.method": "POST",
      "http.status_code": 201,
      "http.url": "https://app.example/orders/9?secret=1",
      "http.target": "/orders/9?secret=1",
      "http.scheme": "https",
      "http.host": "app.example",
      "net.peer.name": "app.example",
      "net.peer.port": 443,
    });
    expect(kept["http.method"]).toBe("POST");
    expect(kept["http.url"]).toBe("/orders/:id");
    expect(kept["http.target"]).toBe("/orders/:id");
    expect(JSON.stringify(kept)).not.toContain("secret");
  });

  it("drops headers, user agent, bodies and exception prose (PII)", () => {
    const kept = scrubSpanAttributes({
      "http.request.header.authorization": "Bearer secret",
      "http.user_agent": "Mozilla/5.0 (someone)",
      "http.request.body": '{"password":"hunter2"}',
      "exception.message": "user alice failed",
      "exception.stacktrace": "at /home/alice/app.ts:1",
      "url.full": "https://app.example/?secret=1",
      "enduser.id": "alice",
    });
    expect(kept).toEqual({});
  });

  it("drops structured and non-finite values even on allowlisted keys, caps strings", () => {
    const kept = scrubSpanAttributes({
      "http.route": ["/a", "/b"],
      "error.type": "x".repeat(500),
      "browser.web_vital.value": Number.NaN,
    });
    expect(kept["http.route"]).toBeUndefined();
    expect(kept["error.type"]).toBe("x".repeat(128));
    expect(kept["browser.web_vital.value"]).toBeUndefined();
  });
});

describe("scrubSpanName", () => {
  it("strips query/fragment, templates ids and caps at 120", () => {
    expect(scrubSpanName("GET /orders/123?token=secret#frag")).toBe("GET /orders/:id");
    expect(scrubSpanName("x".repeat(300))).toHaveLength(120);
  });

  it("leaves the fixed RUM span names intact", () => {
    expect(scrubSpanName("browser.web_vital")).toBe("browser.web_vital");
    expect(scrubSpanName("browser.error")).toBe("browser.error");
  });
});

describe("ScrubProcessor", () => {
  it("rewrites the live span's name and attributes in onEnd", () => {
    const span = {
      name: "GET /orders/123?secret=1",
      attributes: {
        "http.url": "https://app.example/orders/123?secret=1",
        "http.user_agent": "someone",
        "browser.web_vital.name": "INP",
      },
    } as unknown as ReadableSpan;
    new ScrubProcessor().onEnd(span);
    const mutable = span as unknown as { name: string; attributes: Record<string, unknown> };
    expect(mutable.name).toBe("GET /orders/:id");
    expect(mutable.attributes).toEqual({
      "http.url": "/orders/:id",
      "browser.web_vital.name": "INP",
    });
  });

  it("shutdown and forceFlush resolve", async () => {
    const processor = new ScrubProcessor();
    await expect(processor.shutdown()).resolves.toBeUndefined();
    await expect(processor.forceFlush()).resolves.toBeUndefined();
  });
});

describe("scrub hardening (issue #141)", () => {
  it("templates uppercase UUIDs and email-shaped segments", () => {
    expect(templateSegments("/u/0AF76519-16CD-43DD-8448-EB211C80319C")).toBe("/u/:id");
    expect(templateSegments("/users/alice@example.com/edit")).toBe("/users/:id/edit");
    expect(scrubUrl("https://app.example/users/alice@example.com?x=1")).toBe("/users/:id");
  });

  it("reduces absolute-URL span names to the templated pathname (no scheme/host leak)", () => {
    expect(scrubSpanName("https://app.example/orders/123?token=secret")).toBe("/orders/:id");
    expect(scrubSpanName("http://internal-host:8080/admin")).toBe("/admin");
    // Fixed RUM names and route templates are not URLs and stay untouched.
    expect(scrubSpanName("browser.web_vital")).toBe("browser.web_vital");
    expect(scrubSpanName("GET /orders/:id")).toBe("GET /orders/:id");
  });
});
