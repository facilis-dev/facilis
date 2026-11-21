// Threshold boundaries and the zoom-sweep level budget of the semantic zoom (issue #60,
// criteria 3 and 7). Pure: the same function the quantised store selector calls.
import { describe, expect, it } from "vitest";
import {
  GRAPH_LOD_CHIP_HEIGHT_PX,
  GRAPH_LOD_CHIP_HIT_PX,
  GRAPH_LOD_COMPACT_ZOOM,
  GRAPH_LOD_FULL_MIN_TEXT_PX,
  GRAPH_LOD_FULL_ZOOM,
  GRAPH_LOD_MIN_TEXT_PX,
  GRAPH_LOD_ZOOM_VAR,
  lodForZoom,
  lodScreenPx,
  type GraphLodLevel,
} from "./graph-lod";

describe("lodForZoom boundaries", () => {
  it("places 0.44 in chip and 0.45 in compact", () => {
    expect(lodForZoom(0.44)).toBe("chip");
    expect(lodForZoom(0.45)).toBe("compact");
  });

  it("places 0.89 and 0.90 in compact, and only above 0.9 in full", () => {
    expect(lodForZoom(0.89)).toBe("compact");
    expect(lodForZoom(0.9)).toBe("compact");
    expect(lodForZoom(0.900001)).toBe("full");
    expect(lodForZoom(0.91)).toBe("full");
  });

  it("matches the issue table at the extremes of the clamp", () => {
    expect(lodForZoom(0.05)).toBe("chip");
    expect(lodForZoom(2)).toBe("full");
  });

  it("is total: a corrupt zoom degrades to the chip, never throws", () => {
    expect(lodForZoom(Number.NaN)).toBe("chip");
    expect(lodForZoom(Number.POSITIVE_INFINITY)).toBe("chip");
    expect(lodForZoom(0)).toBe("chip");
    expect(lodForZoom(-1)).toBe("chip");
  });
});

describe("the 0.2 -> 1.5 zoom sweep", () => {
  it("crosses exactly two level boundaries", () => {
    const levels: GraphLodLevel[] = [];
    for (let zoom = 0.2; zoom <= 1.5000001; zoom += 0.005) {
      levels.push(lodForZoom(zoom));
    }
    let changes = 0;
    const transitions: { from: GraphLodLevel; to: GraphLodLevel; zoom: number }[] = [];
    for (let index = 1; index < levels.length; index++) {
      const from = levels[index - 1];
      const to = levels[index];
      if (from !== to) {
        changes++;
        transitions.push({ from, to, zoom: 0.2 + index * 0.005 });
      }
    }
    expect(changes).toBe(2);
    expect(transitions[0]).toMatchObject({ from: "chip", to: "compact" });
    expect(transitions[1]).toMatchObject({ from: "compact", to: "full" });
    expect(transitions[0]?.zoom).toBeGreaterThanOrEqual(GRAPH_LOD_COMPACT_ZOOM);
    expect(transitions[1]?.zoom).toBeGreaterThan(GRAPH_LOD_FULL_ZOOM);
  });
});

describe("the LOD contract constants", () => {
  it("keeps the chip box within 24-32 px and the hit area at least 24 px", () => {
    expect(GRAPH_LOD_CHIP_HEIGHT_PX).toBeGreaterThanOrEqual(24);
    expect(GRAPH_LOD_CHIP_HEIGHT_PX).toBeLessThanOrEqual(32);
    expect(GRAPH_LOD_CHIP_HIT_PX).toBeGreaterThanOrEqual(24);
  });

  it("keeps the text floors the epic demands", () => {
    expect(GRAPH_LOD_MIN_TEXT_PX).toBe(7);
    expect(GRAPH_LOD_FULL_MIN_TEXT_PX).toBeGreaterThanOrEqual(10);
    // The full card's smallest flow text stays above the floor at the full threshold.
    expect(GRAPH_LOD_FULL_MIN_TEXT_PX * GRAPH_LOD_FULL_ZOOM).toBeGreaterThanOrEqual(
      GRAPH_LOD_MIN_TEXT_PX,
    );
  });

  it("counter-scales through the zoom variable with a static fallback", () => {
    expect(lodScreenPx(11)).toBe(`calc(11px/var(${GRAPH_LOD_ZOOM_VAR},1))`);
  });
});
