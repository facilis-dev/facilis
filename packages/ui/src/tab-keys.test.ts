import { describe, expect, it } from "vitest";
import { nextTabIndex } from "./tab-keys.ts";

describe("nextTabIndex", () => {
  it("wraps ArrowRight and ArrowLeft", () => {
    expect(nextTabIndex("ArrowRight", 0, 2)).toBe(1);
    expect(nextTabIndex("ArrowRight", 1, 2)).toBe(0);
    expect(nextTabIndex("ArrowLeft", 0, 2)).toBe(1);
    expect(nextTabIndex("ArrowLeft", 1, 2)).toBe(0);
  });

  it("jumps to the first and last tab with Home and End", () => {
    expect(nextTabIndex("Home", 1, 3)).toBe(0);
    expect(nextTabIndex("End", 1, 3)).toBe(2);
  });

  it("returns null for keys outside the pattern and for empty lists", () => {
    expect(nextTabIndex("Enter", 0, 2)).toBeNull();
    expect(nextTabIndex("ArrowRight", 0, 0)).toBeNull();
  });

  it("normalises an out-of-range current index", () => {
    expect(nextTabIndex("ArrowRight", 5, 2)).toBe(1);
    expect(nextTabIndex("ArrowLeft", -1, 2)).toBe(1);
  });
});
