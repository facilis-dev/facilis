import { describe, expect, it } from "vitest";
import { filterOptions, moveIndex } from "./combobox-filter.ts";

const OPTIONS = [
  { value: "northwind", label: "Northwind Studio" },
  { value: "atlas", label: "Atlas Labs" },
  { value: "meridian", label: "Meridian Co." },
] as const;

describe("combobox filter", () => {
  it("matches the label case-insensitively", () => {
    expect(filterOptions(OPTIONS, "ATLAS").map((option) => option.value)).toEqual(["atlas"]);
  });

  it("matches the value as a fallback", () => {
    expect(filterOptions(OPTIONS, "merid").map((option) => option.value)).toEqual(["meridian"]);
  });

  it("trims the query and keeps source order", () => {
    expect(filterOptions(OPTIONS, "  ").map((option) => option.value)).toEqual([
      "northwind",
      "atlas",
      "meridian",
    ]);
    expect(filterOptions(OPTIONS, " a ").map((option) => option.value)).toEqual([
      "atlas",
      "meridian",
    ]);
  });

  it("returns no matches for an unknown query", () => {
    expect(filterOptions(OPTIONS, "zzz")).toEqual([]);
  });
});

describe("moveIndex", () => {
  it("wraps in both directions and starts from -1", () => {
    expect(moveIndex(-1, 1, 3)).toBe(0);
    expect(moveIndex(-1, -1, 3)).toBe(2);
    expect(moveIndex(2, 1, 3)).toBe(0);
    expect(moveIndex(0, -1, 3)).toBe(2);
    expect(moveIndex(0, 1, 0)).toBe(-1);
  });
});
