import { describe, expect, it } from "vitest";

import { toInstant, type DateInput } from "./instant.ts";

describe("toInstant", () => {
  it("accepts a Date and copies it", () => {
    const date = new Date("2026-03-29T12:00:00Z");
    const instant = toInstant(date);
    expect(instant.toISOString()).toBe("2026-03-29T12:00:00.000Z");
    expect(instant).not.toBe(date);
  });

  it("reads a date-only string as UTC midnight", () => {
    expect(toInstant("2026-03-29").toISOString()).toBe("2026-03-29T00:00:00.000Z");
  });

  it("keeps the instant of an offset date-time", () => {
    expect(toInstant("2026-03-29T00:00:00+02:00").toISOString()).toBe("2026-03-28T22:00:00.000Z");
    expect(toInstant("2026-03-29T12:00:00-05:00").toISOString()).toBe("2026-03-29T17:00:00.000Z");
    expect(toInstant("2026-03-29t12:00:00z").toISOString()).toBe("2026-03-29T12:00:00.000Z");
    expect(toInstant("2026-03-29 12:00:00Z").toISOString()).toBe("2026-03-29T12:00:00.000Z");
    expect(toInstant("2026-03-29T12:00Z").toISOString()).toBe("2026-03-29T12:00:00.000Z");
    expect(toInstant("2026-03-29T12:00:00.5Z").toISOString()).toBe("2026-03-29T12:00:00.500Z");
  });

  it("rejects wrong types with TypeError", () => {
    const values = [null, undefined, 1_775_000_000_000, {}, []] as unknown as DateInput[];
    for (const value of values) expect(() => toInstant(value)).toThrow(TypeError);
  });

  it("rejects invalid instants with RangeError", () => {
    const values = [
      "not-a-date",
      "2026-03-29T12:00:00",
      "2026-02-30T00:00:00Z",
      "2026-02-30",
      "2026-03-29T24:00:00Z",
      "2026-03-29T12:60:00Z",
      "2026-03-29T12:00:00+25:00",
      " 2026-03-29T12:00:00Z ",
    ];
    for (const value of values) expect(() => toInstant(value)).toThrow(RangeError);
    expect(() => toInstant(new Date(Number.NaN))).toThrow(RangeError);
  });
});
