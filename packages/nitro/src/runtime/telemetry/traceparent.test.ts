import { describe, expect, it } from "vitest";
import { ROOT_CONTEXT, trace } from "@opentelemetry/api";

import { parentContextFromHeaders, parseTraceparent } from "./traceparent.ts";

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID = "b7ad6b7169203331";
const VALID = "00-" + TRACE_ID + "-" + SPAN_ID + "-01";

describe("parseTraceparent", () => {
  it("parses the W3C header into a remote span context", () => {
    expect(parseTraceparent(VALID)).toEqual({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: 1,
      isRemote: true,
    });
  });

  it("accepts a later version with trailing fields and ignores them", () => {
    expect(parseTraceparent("01-" + TRACE_ID + "-" + SPAN_ID + "-00-extra")?.traceFlags).toBe(0);
  });

  it("rejects malformed, reserved and all-zero identifiers", () => {
    const invalid = [
      undefined,
      null,
      "",
      "00-" + TRACE_ID + "-" + SPAN_ID,
      "ff-" + TRACE_ID + "-" + SPAN_ID + "-01",
      "00-" + TRACE_ID + "-" + SPAN_ID + "-01-extra",
      "00-" + "0".repeat(32) + "-" + SPAN_ID + "-01",
      "00-" + TRACE_ID + "-" + "0".repeat(16) + "-01",
      "00-" + TRACE_ID.toUpperCase() + "-" + SPAN_ID + "-01",
      "00-" + TRACE_ID + "-" + SPAN_ID + "-0g",
    ];
    for (const value of invalid) expect(parseTraceparent(value)).toBeNull();
  });
});

describe("parentContextFromHeaders", () => {
  it("starts the span as a child of the caller's trace", () => {
    const parent = parentContextFromHeaders(new Headers({ traceparent: VALID }));
    expect(trace.getSpanContext(parent)).toEqual({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: 1,
      isRemote: true,
    });
  });

  it("falls back to the active context when the header is missing or invalid", () => {
    expect(parentContextFromHeaders(new Headers())).toEqual(ROOT_CONTEXT);
    expect(parentContextFromHeaders(new Headers({ traceparent: "nope" }))).toEqual(ROOT_CONTEXT);
  });
});
