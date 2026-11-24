import { describe, expect, it } from "vitest";

import { countSpans, exportRequestSchema } from "./schema.ts";

const TRACE = "0af7651916cd43dd8448eb211c80319c";
const SPAN = "b7ad6b7169203331";

function span(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    traceId: TRACE,
    spanId: SPAN,
    name: "GET /api/items",
    startTimeUnixNano: "1700000000000000000",
    endTimeUnixNano: "1700000000001000000",
    ...overrides,
  };
}

function payload(spans: Record<string, unknown>[] = [span()]): Record<string, unknown> {
  return { resourceSpans: [{ scopeSpans: [{ spans }] }] };
}

describe("exportRequestSchema", () => {
  it("accepts a minimal OTLP/JSON batch", () => {
    const parsed = exportRequestSchema.safeParse(payload());
    expect(parsed.success).toBe(true);
  });

  it("accepts uint64 as decimal string, JSON number and n-suffixed string (spike F7)", () => {
    for (const nano of ["1700000000000000000", 1700000000000000000, "1700000000000000000n"]) {
      const parsed = exportRequestSchema.safeParse(
        payload([span({ startTimeUnixNano: nano, endTimeUnixNano: nano })]),
      );
      expect(parsed.success).toBe(true);
    }
  });

  it("accepts the full AnyValue shape and ignores unknown span fields", () => {
    const parsed = exportRequestSchema.safeParse(
      payload([
        span({
          attributes: [
            { key: "a", value: { stringValue: "x" } },
            { key: "b", value: { boolValue: true } },
            { key: "c", value: { intValue: 200 } },
            { key: "d", value: { doubleValue: 1.5 } },
            { key: "e", value: { bytesValue: "eHl6" } },
            { key: "f", value: { arrayValue: { values: [{ intValue: "1" }] } } },
            {
              key: "g",
              value: { kvlistValue: { values: [{ key: "k", value: { stringValue: "v" } }] } },
            },
          ],
          events: [],
          links: [],
          flags: 1,
          droppedAttributesCount: 0,
        }),
      ]),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const first = parsed.data.resourceSpans[0]?.scopeSpans[0]?.spans[0];
      expect(first).toBeDefined();
      expect(Object.keys(first ?? {})).not.toContain("events");
    }
  });

  it("rejects malformed ids, names, timestamps and empty batches", () => {
    const bad = [
      payload([span({ traceId: "xyz" })]),
      payload([span({ spanId: "b7ad6b716920333" })]),
      payload([span({ name: "" })]),
      payload([span({ startTimeUnixNano: "not-a-number" })]),
      payload([span({ endTimeUnixNano: -1 })]),
      { resourceSpans: [] },
      {},
    ];
    for (const candidate of bad) {
      expect(exportRequestSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("rejects a non-hex parentSpanId and oversized attribute lists", () => {
    expect(
      exportRequestSchema.safeParse(payload([span({ parentSpanId: "nope" })])).success,
    ).toBe(false);
    const attributes = Array.from({ length: 129 }, (_, i) => ({
      key: "k" + i,
      value: { intValue: 1 },
    }));
    expect(exportRequestSchema.safeParse(payload([span({ attributes })])).success).toBe(false);
  });
});

describe("exportRequestSchema empty batches", () => {
  it("accepts structurally empty span lists (a no-op batch, not malformed OTLP)", () => {
    expect(exportRequestSchema.safeParse(payload([])).success).toBe(true);
    expect(exportRequestSchema.safeParse({ resourceSpans: [{ scopeSpans: [] }] }).success).toBe(true);
  });
});

describe("countSpans", () => {
  it("sums spans across resource and scope groups", () => {
    const batch = exportRequestSchema.parse({
      resourceSpans: [
        { scopeSpans: [{ spans: [span(), span()] }] },
        { scopeSpans: [{ spans: [span()] }, { spans: [span(), span()] }] },
      ],
    });
    expect(countSpans(batch)).toBe(5);
    expect(countSpans({ resourceSpans: [] })).toBe(0);
  });
});
