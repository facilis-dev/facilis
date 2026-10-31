import { describe, expect, it } from "vitest";

import {
  addDays,
  isValidDateOnly,
  parseDateOnly,
  serializeDateOnly,
  utcDateFromParts,
} from "./date-only.ts";

const VALID = ["2026-03-29", "2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31", "2026-12-31"];
const INVALID = [
  "2026-02-29",
  "1900-02-29",
  "2026-02-30",
  "2026-04-31",
  "2026-13-01",
  "2026-00-01",
  "2026-01-00",
  "0000-01-01",
  "10000-01-01",
  "2026-3-29",
  "29-03-2026",
  "2026-03-29T00:00:00Z",
  "",
  " 2026-03-29",
  "2026-03-29 ",
];

describe("isValidDateOnly", () => {
  it("accepts real YYYY-MM-DD calendar dates", () => {
    for (const value of VALID) expect(isValidDateOnly(value)).toBe(true);
  });

  it("rejects malformed or impossible calendar dates", () => {
    for (const value of INVALID) expect(isValidDateOnly(value)).toBe(false);
  });

  it("rejects non-strings without throwing", () => {
    const values: unknown[] = [20260329, null, undefined, new Date("2026-03-29T00:00:00Z"), {}];
    for (const value of values) expect(isValidDateOnly(value)).toBe(false);
  });
});

describe("parseDateOnly", () => {
  it("returns the calendar fields", () => {
    expect(parseDateOnly("2026-03-29")).toEqual({ year: 2026, month: 3, day: 29 });
  });

  it("throws TypeError for a non-string and RangeError for a bad date", () => {
    expect(() => parseDateOnly(20260329)).toThrow(TypeError);
    expect(() => parseDateOnly("2026-02-30")).toThrow(RangeError);
    expect(() => parseDateOnly("0000-01-01")).toThrow(RangeError);
  });
});

describe("serializeDateOnly", () => {
  it("pads every field to its fixed width", () => {
    expect(serializeDateOnly({ year: 1, month: 2, day: 3 })).toBe("0001-02-03");
    expect(serializeDateOnly({ year: 9999, month: 12, day: 31 })).toBe("9999-12-31");
  });
});

describe("utcDateFromParts", () => {
  it("keeps single-digit and extreme years", () => {
    expect(utcDateFromParts({ year: 1, month: 1, day: 1 }).toISOString()).toBe(
      "0001-01-01T00:00:00.000Z",
    );
    expect(
      utcDateFromParts({
        year: 9999,
        month: 12,
        day: 31,
        hour: 23,
        minute: 59,
        second: 59,
        millisecond: 999,
      }).toISOString(),
    ).toBe("9999-12-31T23:59:59.999Z");
  });
});

describe("addDays", () => {
  it("rolls over months, years and leap days", () => {
    expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
    expect(addDays({ year: 2026, month: 1, day: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
      day: 31,
    });
    expect(addDays({ year: 2024, month: 2, day: 28 }, 1)).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
  });
});
