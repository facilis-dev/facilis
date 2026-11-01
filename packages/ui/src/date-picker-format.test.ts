import { describe, expect, it } from "vitest";
import {
  formatDateValue,
  formatDayLabel,
  formatMonthTitle,
  getWeekdayLabels,
  pad2,
} from "./date-picker-format.ts";

describe("date picker formatting", () => {
  it("shows an em dash for no value", () => {
    expect(formatDateValue(null, "date", "en-US")).toBe("—");
  });

  it("formats a date and a datetime in the given locale", () => {
    const value = new Date(2024, 1, 29, 9, 30);
    expect(formatDateValue(value, "date", "en-US")).toBe("Feb 29, 2024");
    expect(formatDateValue(value, "datetime", "en-US")).toContain("2024");
    expect(formatDateValue(value, "datetime", "en-US")).toContain("9:30");
  });

  it("formats the month title and full day label", () => {
    expect(formatMonthTitle(2024, 1, "en-US")).toBe("February 2024");
    expect(formatDayLabel(new Date(2024, 1, 29), "en-US")).toBe("Thursday, February 29, 2024");
  });

  it("produces Monday-first weekday labels", () => {
    expect(getWeekdayLabels("en-US")).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });

  it("pads numbers to two digits", () => {
    expect(pad2(0)).toBe("00");
    expect(pad2(9)).toBe("09");
    expect(pad2(23)).toBe("23");
  });
});
