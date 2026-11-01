import { describe, expect, it } from "vitest";

import { dateOnlyOf, today } from "./calendar.ts";

const RUNTIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

describe("dateOnlyOf", () => {
  it("reads the calendar day in UTC", () => {
    expect(dateOnlyOf("2026-03-29T23:30:00Z", "UTC")).toBe("2026-03-29");
  });

  it("shifts the day for zones on the other side of the date line", () => {
    // +05:45 crosses midnight while UTC is still 18:15; +14 and -11 are 25 hours apart.
    expect(dateOnlyOf("2026-03-29T18:30:00Z", "Asia/Kathmandu")).toBe("2026-03-30");
    expect(dateOnlyOf("2026-03-29T18:14:59.999Z", "Asia/Kathmandu")).toBe("2026-03-29");
    expect(dateOnlyOf("2026-03-29T10:00:00Z", "Pacific/Kiritimati")).toBe("2026-03-30");
    expect(dateOnlyOf("2026-03-29T10:00:00Z", "Pacific/Pago_Pago")).toBe("2026-03-28");
  });

  it("uses the zone's own offset after each DST transition", () => {
    expect(dateOnlyOf("2026-03-28T23:30:00Z", "Europe/Rome")).toBe("2026-03-29");
    expect(dateOnlyOf("2026-03-29T01:00:00Z", "Europe/Rome")).toBe("2026-03-29");
    expect(dateOnlyOf("2026-10-25T01:00:00Z", "Europe/Rome")).toBe("2026-10-25");
    expect(dateOnlyOf("2026-03-29T03:30:00Z", "America/New_York")).toBe("2026-03-28");
  });

  it("reads a date-only instant as UTC midnight", () => {
    expect(dateOnlyOf("2026-03-29", "America/New_York")).toBe("2026-03-28");
    expect(dateOnlyOf("2026-03-29", "Asia/Tokyo")).toBe("2026-03-29");
  });

  it("falls back to the runtime zone when timeZone is omitted", () => {
    expect(dateOnlyOf("2026-03-29T12:00:00Z")).toBe(
      dateOnlyOf("2026-03-29T12:00:00Z", RUNTIME_ZONE),
    );
  });

  it("rejects instants outside 0001-01-01..9999-12-31", () => {
    expect(() => dateOnlyOf(new Date("0000-06-01T00:00:00Z"), "UTC")).toThrow(RangeError);
    expect(() => dateOnlyOf(new Date(Date.UTC(10000, 0, 1)), "UTC")).toThrow(RangeError);
  });

  it("rejects invalid input", () => {
    expect(() => dateOnlyOf("not-a-date", "UTC")).toThrow(RangeError);
    expect(() => dateOnlyOf(null as unknown as Date, "UTC")).toThrow(TypeError);
    expect(() => dateOnlyOf("2026-03-29T12:00:00Z", 42 as unknown as string)).toThrow(TypeError);
    expect(() => dateOnlyOf("2026-03-29T12:00:00Z", "Mars/Phobos")).toThrow(RangeError);
  });
});

describe("today", () => {
  it("is the calendar day of the given instant in the given zone", () => {
    expect(today("Pacific/Kiritimati", "2026-03-29T10:00:00Z")).toBe("2026-03-30");
    expect(today("UTC", "2026-03-29T23:30:00Z")).toBe("2026-03-29");
    expect(today(undefined, new Date("2026-03-29T23:30:00Z"))).toBe(
      dateOnlyOf("2026-03-29T23:30:00Z", RUNTIME_ZONE),
    );
  });

  it("defaults now to the current instant", () => {
    expect(today("UTC")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
