import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatDateOnly,
  formatDateTime,
  formatTime,
  type FormatOptions,
} from "./format.ts";

const RUNTIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

describe("formatDate", () => {
  it("renders a medium date in the requested locale and zone", () => {
    expect(formatDate("2026-03-29T12:00:00Z", { locale: "en-US", timeZone: "UTC" })).toBe(
      "Mar 29, 2026",
    );
    expect(formatDate("2026-03-29T12:00:00Z", { locale: "en-GB", timeZone: "UTC" })).toBe(
      "29 Mar 2026",
    );
    expect(formatDate("2026-03-29T12:00:00Z", { locale: "it-IT", timeZone: "UTC" })).toBe(
      "29 mar 2026",
    );
  });

  it("rolls the day over with the zone", () => {
    expect(formatDate("2026-03-28T23:30:00Z", { locale: "en-US", timeZone: "Europe/Rome" })).toBe(
      "Mar 29, 2026",
    );
    expect(
      formatDate("2026-03-29T03:30:00Z", { locale: "en-US", timeZone: "America/New_York" }),
    ).toBe("Mar 28, 2026");
    expect(
      formatDate("2026-03-29T18:30:00Z", { locale: "en-US", timeZone: "Asia/Kathmandu" }),
    ).toBe("Mar 30, 2026");
  });

  it("defaults the zone to the runtime zone", () => {
    expect(formatDate("2026-03-29T12:00:00Z", { locale: "en-US" })).toBe(
      formatDate("2026-03-29T12:00:00Z", { locale: "en-US", timeZone: RUNTIME_ZONE }),
    );
  });
});

describe("formatDateTime", () => {
  it("renders the date and the local time", () => {
    expect(formatDateTime("2026-03-29T12:34:00Z", { locale: "en-US", timeZone: "UTC" })).toBe(
      "Mar 29, 2026, 12:34 PM",
    );
    // Europe/Rome is on CEST after the spring transition and on CET after the autumn one.
    expect(
      formatDateTime("2026-03-29T12:34:00Z", { locale: "en-US", timeZone: "Europe/Rome" }),
    ).toBe("Mar 29, 2026, 2:34 PM");
    expect(
      formatDateTime("2026-10-25T12:34:00Z", { locale: "en-US", timeZone: "Europe/Rome" }),
    ).toBe("Oct 25, 2026, 1:34 PM");
    expect(
      formatDateTime("2026-03-29T12:34:00Z", { locale: "en-US", timeZone: "America/New_York" }),
    ).toBe("Mar 29, 2026, 8:34 AM");
    expect(
      formatDateTime("2026-03-29T12:34:00Z", { locale: "en-US", timeZone: "Asia/Kathmandu" }),
    ).toBe("Mar 29, 2026, 6:19 PM");
  });
});

describe("formatTime", () => {
  it("renders the local time only", () => {
    expect(formatTime("2026-03-29T12:34:00Z", { locale: "en-US", timeZone: "UTC" })).toBe(
      "12:34 PM",
    );
    expect(formatTime("2026-03-29T12:34:00Z", { locale: "en-US", timeZone: "Europe/Rome" })).toBe(
      "2:34 PM",
    );
    expect(formatTime("2026-10-25T12:34:00Z", { locale: "en-US", timeZone: "Europe/Rome" })).toBe(
      "1:34 PM",
    );
    expect(
      formatTime("2026-03-29T12:34:00Z", { locale: "en-US", timeZone: "Asia/Kathmandu" }),
    ).toBe("6:19 PM");
  });
});

describe("formatDateOnly", () => {
  it("renders the calendar day without shifting it", () => {
    expect(formatDateOnly("2026-03-29", { locale: "en-US" })).toBe("Mar 29, 2026");
    expect(formatDateOnly("2026-03-29", { locale: "it-IT" })).toBe("29 mar 2026");
    expect(formatDateOnly("2024-02-29", { locale: "en-US" })).toBe("Feb 29, 2024");
    expect(formatDateOnly("2026-01-01", { locale: "en-US" })).toBe("Jan 1, 2026");
    expect(formatDateOnly("2026-12-31", { locale: "en-US" })).toBe("Dec 31, 2026");
  });

  it("matches the UTC rendering of the same calendar day", () => {
    expect(formatDateOnly("2026-03-29", { locale: "en-US" })).toBe(
      formatDate("2026-03-29T00:00:00Z", { locale: "en-US", timeZone: "UTC" }),
    );
  });

  it("defaults the locale to the runtime locale", () => {
    expect(formatDateOnly("2026-03-29")).toMatch(/2026/);
  });
});

describe("option and input validation", () => {
  it("throws TypeError for wrong types and RangeError for unknown locales or zones", () => {
    expect(() => formatDate(null as unknown as string)).toThrow(TypeError);
    expect(() => formatDate(new Date(Number.NaN))).toThrow(RangeError);
    expect(() => formatDate("2026-03-29", { locale: 42 as unknown as string })).toThrow(TypeError);
    expect(() => formatDate("2026-03-29", { timeZone: 42 as unknown as string })).toThrow(
      TypeError,
    );
    expect(() => formatDate("2026-03-29", null as unknown as FormatOptions)).toThrow(TypeError);
    expect(() => formatDate("2026-03-29", { locale: "en_US" })).toThrow(RangeError);
    expect(() => formatDate("2026-03-29", { timeZone: "Mars/Phobos" })).toThrow(RangeError);
    expect(() => formatDateOnly("2026-02-30")).toThrow(RangeError);
    expect(() => formatDateOnly(20260329 as unknown as string)).toThrow(TypeError);
  });

  it("caches formatters per locale and zone", () => {
    const first = formatDate("2026-03-29T12:00:00Z", { locale: "en-US", timeZone: "UTC" });
    expect(formatDate("2026-03-29T12:00:00Z", { locale: "en-GB", timeZone: "UTC" })).toBe(
      "29 Mar 2026",
    );
    expect(formatDate("2026-03-29T12:00:00Z", { locale: "en-US", timeZone: "UTC" })).toBe(first);
  });
});
