// The shared card footprints (issue #60): one source for the canvas edge fallback and the AI
// scene, LOD-invariant by construction.
import { describe, expect, it } from "vitest";
import { GRAPH_NODE_SIZES } from "./graph-node-size";

describe("GRAPH_NODE_SIZES", () => {
  it("covers every kind with the card class width", () => {
    expect(Object.keys(GRAPH_NODE_SIZES).sort()).toEqual([
      "page",
      "route",
      "table",
      "view",
      "workflow",
    ]);
    // w-56 / w-60 / w-64 in CSS pixels.
    expect(GRAPH_NODE_SIZES.page.width).toBe(224);
    expect(GRAPH_NODE_SIZES.table.width).toBe(240);
    expect(GRAPH_NODE_SIZES.view.width).toBe(240);
    expect(GRAPH_NODE_SIZES.route.width).toBe(256);
    expect(GRAPH_NODE_SIZES.workflow.width).toBe(256);
  });

  it("gives every kind a footprint larger than the chip hit floor", () => {
    for (const size of Object.values(GRAPH_NODE_SIZES)) {
      expect(size.width).toBeGreaterThanOrEqual(24);
      expect(size.height).toBeGreaterThanOrEqual(24);
      expect(Number.isInteger(size.width)).toBe(true);
      expect(Number.isInteger(size.height)).toBe(true);
    }
  });
});
