import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  addMonthsClamped,
  buildMonthGrid,
  dayKey,
  daysInMonth,
  isDayWithin,
  isSameDay,
  mondayOf,
  startOfDay,
} from "./date-grid.ts";

describe("date grid", () => {
  it("knows month lengths and leap years", () => {
    expect(daysInMonth(2024, 1)).toBe(29);
    expect(daysInMonth(2023, 1)).toBe(28);
    expect(daysInMonth(2026, 0)).toBe(31);
    expect(daysInMonth(2026, 3)).toBe(30);
  });

  it("treats Monday as the first day of the week", () => {
    // 2024-01-01 was a Monday.
    const monday = new Date(2024, 0, 1);
    for (let offset = 0; offset < 7; offset += 1) {
      const day = addDays(monday, offset);
      expect(mondayOf(day).getTime()).toBe(monday.getTime());
    }
    expect(mondayOf(new Date(2024, 0, 7)).getDay()).toBe(1);
  });

  it("builds a Monday-first 6x7 grid that fills the adjacent months", () => {
    const grid = buildMonthGrid(2024, 1); // February 2024, leap year

    expect(grid).toHaveLength(42);
    expect(grid[0]?.getDay()).toBe(1);
    expect(dayKey(grid[0] as Date)).toBe("2024-01-29");
    expect(grid.map(dayKey)).toContain("2024-02-29");
    expect(grid[41]?.getDay()).toBe(0);
    expect(dayKey(grid[41] as Date)).toBe("2024-03-10");
  });

  it("keeps the day when shifting months and clamps it to the target length", () => {
    expect(dayKey(addMonthsClamped(new Date(2024, 0, 31), 1))).toBe("2024-02-29");
    expect(dayKey(addMonthsClamped(new Date(2023, 0, 31), 1))).toBe("2023-02-28");
    expect(dayKey(addDays(new Date(2024, 1, 29), 1))).toBe("2024-03-01");
    expect(dayKey(addMonths(new Date(2024, 0, 15), 2))).toBe("2024-03-01");
  });

  it("compares calendar days, not instants", () => {
    const day = new Date(2024, 4, 15, 23, 59);
    const sameDayLater = new Date(2024, 4, 15, 0, 1);

    expect(isSameDay(day, sameDayLater)).toBe(true);
    expect(isSameDay(day, new Date(2024, 4, 16))).toBe(false);
    expect(startOfDay(day).getHours()).toBe(0);
    expect(dayKey(new Date(2024, 8, 5))).toBe("2024-09-05");
  });

  it("applies inclusive min/max bounds by day", () => {
    const min = new Date(2024, 4, 10, 18, 0);
    const max = new Date(2024, 4, 20, 6, 0);

    expect(isDayWithin(new Date(2024, 4, 10, 0, 0), min, max)).toBe(true);
    expect(isDayWithin(new Date(2024, 4, 20, 23, 59), min, max)).toBe(true);
    expect(isDayWithin(new Date(2024, 4, 9, 23, 59), min, max)).toBe(false);
    expect(isDayWithin(new Date(2024, 4, 21, 0, 0), min, max)).toBe(false);
    expect(isDayWithin(new Date(2024, 4, 15))).toBe(true);
  });
});
