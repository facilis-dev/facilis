import { describe, expect, it } from "vitest";
import { isoDate, weekBuckets, weekStartOf } from "./week-buckets.ts";

describe("weekStartOf", () => {
  it("returns the Monday of the week", () => {
    // 2026-11-14 is a Saturday; its week starts on Monday 2026-11-09.
    expect(isoDate(weekStartOf(new Date("2026-11-14T10:00:00Z")))).toBe("2026-11-09");
    expect(isoDate(weekStartOf(new Date("2026-11-09T00:00:00Z")))).toBe("2026-11-09");
    // Sunday belongs to the week that started six days earlier.
    expect(isoDate(weekStartOf(new Date("2026-11-15T23:00:00Z")))).toBe("2026-11-09");
  });
});

describe("weekBuckets", () => {
  const now = new Date("2026-11-14T12:00:00Z");

  it("returns the requested number of buckets, oldest first", () => {
    const buckets = weekBuckets([], 3, now);
    expect(buckets.map((bucket) => bucket.weekStart)).toEqual([
      "2026-10-26",
      "2026-11-02",
      "2026-11-09",
    ]);
  });

  it("counts a date in its week and keeps the empty weeks", () => {
    const buckets = weekBuckets(
      [new Date("2026-11-10T08:00:00Z"), new Date("2026-11-11T08:00:00Z")],
      3,
      now,
    );
    expect(buckets.map((bucket) => bucket.count)).toEqual([0, 0, 2]);
  });

  it("drops dates outside the window", () => {
    const buckets = weekBuckets([new Date("2026-01-01T00:00:00Z")], 2, now);
    expect(buckets.every((bucket) => bucket.count === 0)).toBe(true);
  });
});
