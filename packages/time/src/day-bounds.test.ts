import { describe, expect, it } from "vitest";

import { dateOnlyOf } from "./calendar.ts";
import { endOfDay, startOfDay } from "./day-bounds.ts";

const HOUR_MS = 3_600_000;

describe("startOfDay", () => {
  it("returns local midnight as a UTC instant", () => {
    expect(startOfDay("2026-03-29", "UTC").toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(startOfDay("2026-03-29", "Europe/Rome").toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(startOfDay("2026-10-25", "Europe/Rome").toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(startOfDay("2026-03-08", "America/New_York").toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    );
    expect(startOfDay("2026-11-01", "America/New_York").toISOString()).toBe(
      "2026-11-01T04:00:00.000Z",
    );
    expect(startOfDay("2026-03-29", "Asia/Kathmandu").toISOString()).toBe(
      "2026-03-28T18:15:00.000Z",
    );
    expect(startOfDay("2026-03-29", "Pacific/Kiritimati").toISOString()).toBe(
      "2026-03-28T10:00:00.000Z",
    );
    expect(startOfDay("2026-03-29", "Pacific/Pago_Pago").toISOString()).toBe(
      "2026-03-29T11:00:00.000Z",
    );
  });

  it("starts at the DST transition when local midnight is skipped", () => {
    // America/Santiago springs forward at 00:00 on 2026-09-06, so local 00:00 does not exist.
    const start = startOfDay("2026-09-06", "America/Santiago");
    expect(dateOnlyOf(start, "America/Santiago")).toBe("2026-09-06");
    expect(dateOnlyOf(new Date(start.getTime() - 1), "America/Santiago")).toBe("2026-09-05");
  });

  it("starts at the first occurrence when local midnight is repeated", () => {
    // America/Havana falls back at 01:00 on 2026-11-01, so local 00:00 happens twice.
    const start = startOfDay("2026-11-01", "America/Havana");
    expect(dateOnlyOf(start, "America/Havana")).toBe("2026-11-01");
    expect(dateOnlyOf(new Date(start.getTime() - 1), "America/Havana")).toBe("2026-10-31");
  });
});

describe("endOfDay", () => {
  it("returns the last millisecond of the local day", () => {
    expect(endOfDay("2026-03-29", "UTC").toISOString()).toBe("2026-03-29T23:59:59.999Z");
    expect(endOfDay("2026-03-29", "Europe/Rome").toISOString()).toBe("2026-03-29T21:59:59.999Z");
    expect(endOfDay("2026-10-25", "Europe/Rome").toISOString()).toBe("2026-10-25T22:59:59.999Z");
    expect(endOfDay("2026-03-08", "America/New_York").toISOString()).toBe(
      "2026-03-09T03:59:59.999Z",
    );
    expect(endOfDay("2026-11-01", "America/New_York").toISOString()).toBe(
      "2026-11-02T04:59:59.999Z",
    );
    expect(endOfDay("2026-03-29", "Asia/Kathmandu").toISOString()).toBe("2026-03-29T18:14:59.999Z");
    expect(endOfDay("2026-03-29", "Pacific/Kiritimati").toISOString()).toBe(
      "2026-03-29T09:59:59.999Z",
    );
    // Year roll-over: the next local day starts in the next year.
    expect(endOfDay("2026-12-31", "Europe/Rome").toISOString()).toBe("2026-12-31T22:59:59.999Z");
    expect(endOfDay("9999-12-31", "UTC").toISOString()).toBe("9999-12-31T23:59:59.999Z");
  });

  it("reports 23- and 25-hour days across the DST transitions", () => {
    const spring =
      endOfDay("2026-03-29", "Europe/Rome").getTime() -
      startOfDay("2026-03-29", "Europe/Rome").getTime() +
      1;
    const autumn =
      endOfDay("2026-10-25", "Europe/Rome").getTime() -
      startOfDay("2026-10-25", "Europe/Rome").getTime() +
      1;
    expect(spring).toBe(23 * HOUR_MS);
    expect(autumn).toBe(25 * HOUR_MS);
  });
});

describe("day boundaries", () => {
  const CASES = [
    { day: "2026-01-15", zone: "UTC" },
    { day: "2026-03-29", zone: "Europe/Rome" },
    { day: "2026-10-25", zone: "Europe/Rome" },
    { day: "2026-03-08", zone: "America/New_York" },
    { day: "2026-11-01", zone: "America/New_York" },
    { day: "2026-03-29", zone: "Asia/Kathmandu" },
    { day: "2026-03-29", zone: "Pacific/Kiritimati" },
    { day: "2026-03-29", zone: "Pacific/Pago_Pago" },
  ];

  it("brackets exactly one local calendar day", () => {
    for (const { day, zone } of CASES) {
      const start = startOfDay(day, zone);
      const end = endOfDay(day, zone);
      expect(start).toBeInstanceOf(Date);
      expect(dateOnlyOf(start, zone)).toBe(day);
      expect(dateOnlyOf(end, zone)).toBe(day);
      expect(dateOnlyOf(new Date(start.getTime() - 1), zone)).not.toBe(day);
      expect(dateOnlyOf(new Date(end.getTime() + 1), zone)).not.toBe(day);
      expect(end.getTime()).toBeGreaterThanOrEqual(start.getTime());
    }
  });
});

describe("day-boundary validation", () => {
  it("throws TypeError for a missing or non-string zone", () => {
    expect(() => startOfDay("2026-03-29", undefined as unknown as string)).toThrow(TypeError);
    expect(() => endOfDay("2026-03-29", 42 as unknown as string)).toThrow(TypeError);
  });

  it("throws RangeError for bad dates and zones", () => {
    expect(() => startOfDay("2026-02-30", "UTC")).toThrow(RangeError);
    expect(() => endOfDay("2026-13-01", "UTC")).toThrow(RangeError);
    expect(() => startOfDay("2026-03-29", "Mars/Phobos")).toThrow(RangeError);
    expect(() => startOfDay(20260329 as unknown as string, "UTC")).toThrow(TypeError);
  });
});
