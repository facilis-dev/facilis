import { describe, expect, it } from "vitest";

import {
  assertOptionalTimeZone,
  assertTimeZone,
  isSameWallTime,
  wallPartsAt,
  zoneOffsetMs,
  type WallTime,
} from "./zone.ts";

const HOUR_MS = 3_600_000;

describe("zoneOffsetMs", () => {
  it("reports UTC as zero", () => {
    expect(zoneOffsetMs(Date.parse("2026-03-29T12:00:00Z"), "UTC")).toBe(0);
  });

  it("follows Europe/Rome across both DST transitions", () => {
    // Spring forward on 2026-03-29 at 02:00 local -> 03:00 (01:00 UTC); fall back on 2026-10-25
    // at 03:00 local -> 02:00 (01:00 UTC).
    expect(zoneOffsetMs(Date.parse("2026-03-29T00:30:00Z"), "Europe/Rome")).toBe(1 * HOUR_MS);
    expect(zoneOffsetMs(Date.parse("2026-03-29T01:30:00Z"), "Europe/Rome")).toBe(2 * HOUR_MS);
    expect(zoneOffsetMs(Date.parse("2026-10-25T00:30:00Z"), "Europe/Rome")).toBe(2 * HOUR_MS);
    expect(zoneOffsetMs(Date.parse("2026-10-25T01:30:00Z"), "Europe/Rome")).toBe(1 * HOUR_MS);
  });

  it("follows America/New_York and the +05:45 offset of Asia/Kathmandu", () => {
    expect(zoneOffsetMs(Date.parse("2026-01-15T12:00:00Z"), "America/New_York")).toBe(-5 * HOUR_MS);
    expect(zoneOffsetMs(Date.parse("2026-07-15T12:00:00Z"), "America/New_York")).toBe(-4 * HOUR_MS);
    expect(zoneOffsetMs(Date.parse("2026-01-15T12:00:00Z"), "Asia/Kathmandu")).toBe(345 * 60_000);
  });

  it("throws RangeError for an unknown zone", () => {
    expect(() => zoneOffsetMs(0, "Mars/Phobos")).toThrow(RangeError);
  });
});

describe("wallPartsAt", () => {
  it("returns the wall-clock fields of the requested zone", () => {
    const parts = wallPartsAt(Date.parse("2026-03-29T12:34:56.789Z"), "Asia/Kathmandu");
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(3);
    expect(parts.day).toBe(29);
    expect(parts.hour).toBe(18);
    expect(parts.minute).toBe(19);
    expect(parts.second).toBe(56);
    expect(parts.era).toBe("AD");
  });

  it("uses the runtime zone when timeZone is omitted", () => {
    expect(wallPartsAt(Date.parse("2026-03-29T12:00:00Z"), undefined).year).toBe(2026);
  });
});

describe("isSameWallTime", () => {
  it("compares the wall clock and ignores the era token", () => {
    const left = wallPartsAt(Date.parse("2026-03-29T00:00:00Z"), "UTC");
    const same: WallTime = left;
    expect(isSameWallTime(left, same)).toBe(true);
    expect(isSameWallTime(left, { ...same, minute: 1 })).toBe(false);
  });
});

describe("time zone guards", () => {
  it("throw TypeError for a non-string zone and allow the omitted default", () => {
    expect(() => assertTimeZone(undefined)).toThrow(TypeError);
    expect(() => assertOptionalTimeZone(null)).toThrow(TypeError);
    expect(() => assertOptionalTimeZone(undefined)).not.toThrow();
  });
});
