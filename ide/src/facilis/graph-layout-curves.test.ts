import { describe, expect, it } from "vitest";
import {
  emptyGraphLayout,
  pruneGraphCurves,
  withEdgeCurve,
  type GraphLayoutFile,
} from "./graph-layout";

const layout = (overrides: Partial<GraphLayoutFile> = {}): GraphLayoutFile => ({
  ...emptyGraphLayout(),
  ...overrides,
});

describe("withEdgeCurve", () => {
  it("adds and moves a curve without mutating the previous layout", () => {
    const before = layout();
    const added = withEdgeCurve(before, "fk:1", { x: 10, y: -4 });
    expect(added.edgeCurves).toEqual({ "fk:1": { x: 10, y: -4 } });
    expect(before.edgeCurves).toEqual({});
    expect(added).not.toBe(before);
    const moved = withEdgeCurve(added, "fk:1", { x: 20, y: 8 });
    expect(moved.edgeCurves).toEqual({ "fk:1": { x: 20, y: 8 } });
  });

  it("returns the same layout instance when the curve is unchanged", () => {
    const value = withEdgeCurve(layout(), "fk:1", { x: 10, y: -4 });
    expect(withEdgeCurve(value, "fk:1", { x: 10, y: -4 })).toBe(value);
  });

  it("clears a curve when the offset is null, non-finite or near zero", () => {
    const value = layout({
      edgeCurves: { "fk:1": { x: 10, y: -4 }, "fk:2": { x: 1, y: 1 } },
    });
    expect(withEdgeCurve(value, "fk:1", null).edgeCurves).toEqual({ "fk:2": { x: 1, y: 1 } });
    expect(
      withEdgeCurve(value, "fk:1", { x: Number.NaN, y: 1 }).edgeCurves["fk:1"],
    ).toBeUndefined();
    expect(withEdgeCurve(value, "fk:1", { x: 0.2, y: -0.4 }).edgeCurves["fk:1"]).toBeUndefined();
  });

  it("keeps an offset exactly at the reset distance", () => {
    const value = withEdgeCurve(layout(), "fk:1", { x: 0.5, y: 0 });
    expect(value.edgeCurves["fk:1"]).toEqual({ x: 0.5, y: 0 });
  });

  it("returns the same layout when there is nothing to clear", () => {
    const value = layout();
    expect(withEdgeCurve(value, "fk:1", null)).toBe(value);
    expect(withEdgeCurve(value, "fk:1", { x: 0, y: 0 })).toBe(value);
  });
});

describe("pruneGraphCurves", () => {
  it("drops curves for edges the graph no longer contains", () => {
    const value = layout({ edgeCurves: { "fk:1": { x: 1, y: 2 }, "fk:gone": { x: 3, y: 4 } } });
    const pruned = pruneGraphCurves(value, new Set(["fk:1"]));
    expect(pruned.edgeCurves).toEqual({ "fk:1": { x: 1, y: 2 } });
    // The input layout is untouched so a stale commit cannot clobber the saved file.
    expect(value.edgeCurves).toEqual({ "fk:1": { x: 1, y: 2 }, "fk:gone": { x: 3, y: 4 } });
  });

  it("returns the same layout instance when nothing is stale", () => {
    const value = layout({ edgeCurves: { "fk:1": { x: 1, y: 2 } } });
    // The panel runs this after every view change (pan/zoom included), so a fresh object
    // here would trigger an infinite render loop.
    expect(pruneGraphCurves(value, new Set(["fk:1", "fk:2"]))).toBe(value);
    const empty = layout();
    expect(pruneGraphCurves(empty, new Set())).toBe(empty);
  });
});
