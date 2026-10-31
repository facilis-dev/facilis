import { describe, expect, it } from "vitest";
import { dueDateFromInput, formatDueDate, isOverdue, localTimeZone } from "./dates.ts";

describe("formatDueDate", () => {
  it("formats the calendar day in the requested zone and locale", () => {
    expect(formatDueDate("2026-10-15T09:30:00.000Z", { locale: "en-US", timeZone: "UTC" })).toBe(
      "Oct 15, 2026",
    );
  });

  it("shows the day the instant falls on in the user's zone", () => {
    // 23:30 UTC is already the next calendar day in Rome (CEST).
    expect(
      formatDueDate("2026-10-15T23:30:00.000Z", { locale: "en-US", timeZone: "Europe/Rome" }),
    ).toBe("Oct 16, 2026");
  });

  it("returns null when there is no due date or it is invalid", () => {
    expect(formatDueDate(null)).toBeNull();
    expect(formatDueDate("not-a-date", { locale: "en-US", timeZone: "UTC" })).toBeNull();
  });
});

describe("dueDateFromInput", () => {
  it("converts a date input to the ISO instant of local midnight", () => {
    expect(dueDateFromInput("2026-10-15", "UTC")).toBe("2026-10-15T00:00:00.000Z");
  });

  it("is DST-aware", () => {
    expect(dueDateFromInput("2026-07-01", "Europe/Rome")).toBe("2026-06-30T22:00:00.000Z");
    expect(dueDateFromInput("2026-12-01", "Europe/Rome")).toBe("2026-11-30T23:00:00.000Z");
  });

  it("throws on an invalid calendar day", () => {
    expect(() => dueDateFromInput("2026-02-30", "UTC")).toThrow(RangeError);
    expect(() => dueDateFromInput("15/10/2026", "UTC")).toThrow(RangeError);
  });
});

describe("isOverdue", () => {
  const today = "2026-10-15";

  it("is true only before today's calendar day", () => {
    expect(isOverdue("2026-10-14T23:00:00.000Z", { today, timeZone: "UTC" })).toBe(true);
    expect(isOverdue("2026-10-15T23:00:00.000Z", { today, timeZone: "UTC" })).toBe(false);
    expect(isOverdue("2026-10-16T01:00:00.000Z", { today, timeZone: "UTC" })).toBe(false);
  });

  it("is false without a valid due date", () => {
    expect(isOverdue(null, { today, timeZone: "UTC" })).toBe(false);
    expect(isOverdue("not-a-date", { today, timeZone: "UTC" })).toBe(false);
  });
});

describe("localTimeZone", () => {
  it("returns the runtime IANA zone", () => {
    expect(localTimeZone().length).toBeGreaterThan(0);
  });
});
