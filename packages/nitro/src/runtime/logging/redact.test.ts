import { describe, expect, it } from "vitest";

import {
  CIRCULAR,
  MAX_DEPTH_PLACEHOLDER,
  MAX_REDACT_ARRAY,
  MAX_REDACT_STRING,
  REDACTED,
  UNSERIALIZABLE,
  capString,
  isSensitiveKey,
  redactRecord,
  redactUnknown,
} from "./redact.ts";

describe("isSensitiveKey", () => {
  it.each([
    "token",
    "access_token",
    "secret",
    "clientSecret",
    "password",
    "cookie",
    "authorization",
    "authorizationHeader",
    "set-cookie",
    "api_key",
    "api-key",
    "apiKey",
    "credential",
    "SamlResponse",
    "SAMLRequest",
    "assertion",
    "email",
    "sessionId",
  ])("treats %s as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(["userId", "requestId", "status", "operation", "tables"])("leaves %s alone", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe("capString", () => {
  it("leaves a short string untouched", () => {
    expect(capString("hello")).toBe("hello");
  });

  it("truncates to the cap", () => {
    expect(capString("x".repeat(MAX_REDACT_STRING + 10))).toHaveLength(MAX_REDACT_STRING);
  });
});

describe("redactUnknown", () => {
  it("redacts sensitive keys case-insensitively and keeps the rest", () => {
    const redacted = redactUnknown({
      token: "abc",
      API_KEY: "key",
      nested: { password: "pw", ok: 1 },
      list: [{ secret: "s", item: "visible" }],
    });

    expect(redacted).toEqual({
      token: REDACTED,
      API_KEY: REDACTED,
      nested: { password: REDACTED, ok: 1 },
      list: [{ secret: REDACTED, item: "visible" }],
    });
  });

  it("caps depth", () => {
    const tooDeep = { a: { b: { c: { d: { e: { f: { g: "hidden" } } } } } } };
    const atCap = { a: { b: { c: { d: { e: "kept" } } } } };

    expect(redactUnknown(tooDeep)).toEqual({
      a: { b: { c: { d: { e: { f: MAX_DEPTH_PLACEHOLDER } } } } },
    });
    expect(redactUnknown(atCap)).toEqual({ a: { b: { c: { d: { e: "kept" } } } } });
  });

  it("caps arrays and strings", () => {
    const redacted = redactUnknown({
      list: Array.from({ length: MAX_REDACT_ARRAY + 10 }, (_value, index) => index),
      long: "y".repeat(MAX_REDACT_STRING + 5),
    }) as { list: number[]; long: string };

    expect(redacted.list).toHaveLength(MAX_REDACT_ARRAY);
    expect(redacted.long).toHaveLength(MAX_REDACT_STRING);
  });

  it("marks cycles instead of recursing", () => {
    const value: Record<string, unknown> = { name: "cycle" };
    value["self"] = value;

    expect(redactUnknown(value)).toEqual({ name: "cycle", self: CIRCULAR });
  });

  it("stringifies dates, bigints, maps and sets", () => {
    const date = new Date("2026-11-08T12:00:00.000Z");
    const redacted = redactUnknown({
      at: date,
      big: 10n,
      map: new Map<string, unknown>([
        ["token", "secret"],
        ["ok", true],
      ]),
      set: new Set([1, 2]),
    });

    expect(redacted).toEqual({
      at: "2026-11-08T12:00:00.000Z",
      big: "10",
      map: { token: REDACTED, ok: true },
      set: [1, 2],
    });
  });

  it("never serializes arbitrary objects", () => {
    class Widget {
      readonly label = "widget";
    }

    expect(redactUnknown({ widget: new Widget() })).toEqual({ widget: UNSERIALIZABLE });
  });

  it("drops undefined properties", () => {
    expect(redactUnknown({ kept: 1, dropped: undefined })).toEqual({ kept: 1 });
  });
});

describe("redactRecord", () => {
  it("returns undefined for an absent record", () => {
    expect(redactRecord(undefined)).toBeUndefined();
  });

  it("returns undefined for a non-object value", () => {
    expect(redactRecord([1, 2] as unknown as Record<string, unknown>)).toBeUndefined();
  });

  it("redacts a plain record", () => {
    expect(redactRecord({ email: "a@b.c", other: 1 })).toEqual({
      email: REDACTED,
      other: 1,
    });
  });
});
