// The minimap projection contract (issue #68 criterion 3): bounds, scale/offset, the viewport
// rectangle from {x,y,zoom}+container, and pointer delta → pan. Pure math, no DOM.

import { describe, expect, it } from "vitest";
import {
  MINIMAP_SIZE,
  MINIMAP_WORLD_PADDING,
  centerOnWorldPoint,
  minimapBounds,
  minimapNodeRect,
  minimapPanDelta,
  minimapProjection,
  minimapToWorld,
  minimapViewportRect,
  projectMinimapRect,
  type MinimapNode,
} from "./graph-minimap";

const nodes: MinimapNode[] = [
  { id: "a", kind: "page", x: 0, y: 0, width: 200, height: 100 },
  { id: "b", kind: "table", x: 400, y: 300, width: 200, height: 80 },
];

describe("minimapNodeRect", () => {
  it("prefers the measured size over the kind fallback", () => {
    const node = { id: "table:t", kind: "table" as const, position: { x: 10, y: 20 } };
    const rect = minimapNodeRect(node, { width: 240, height: 32 }, { width: 240, height: 80 });
    expect(rect).toEqual({ id: "table:t", kind: "table", x: 10, y: 20, width: 240, height: 32 });
  });

  it("falls back per dimension when no measurement exists", () => {
    const node = { id: "page:p", kind: "page" as const, position: { x: 0, y: 0 } };
    const rect = minimapNodeRect(node, undefined, { width: 224, height: 157 });
    expect(rect.width).toBe(224);
    expect(rect.height).toBe(157);
    const partial = minimapNodeRect(node, { width: 200 }, { width: 224, height: 157 });
    expect(partial.width).toBe(200);
    expect(partial.height).toBe(157);
  });
});

describe("minimapBounds + minimapProjection", () => {
  it("unions the node rects with a world margin", () => {
    const bounds = minimapBounds(nodes);
    expect(bounds).toEqual({
      x: -MINIMAP_WORLD_PADDING,
      y: -MINIMAP_WORLD_PADDING,
      width: 600 + MINIMAP_WORLD_PADDING * 2,
      height: 380 + MINIMAP_WORLD_PADDING * 2,
    });
  });

  it("returns null for an empty graph", () => {
    expect(minimapBounds([])).toBeNull();
  });

  it("fits the bounds into the surface preserving aspect ratio", () => {
    const bounds = minimapBounds(nodes);
    if (bounds === null) throw new Error("bounds");
    const projection = minimapProjection(bounds);
    const projected = projectMinimapRect(bounds, projection);
    expect(projected.width).toBeLessThanOrEqual(MINIMAP_SIZE.width + 1e-9);
    expect(projected.height).toBeLessThanOrEqual(MINIMAP_SIZE.height + 1e-9);
    // The content is centred: equal slack on both axes of the limiting dimension.
    expect(projected.x).toBeCloseTo((MINIMAP_SIZE.width - projected.width) / 2, 6);
    expect(projected.y).toBeCloseTo((MINIMAP_SIZE.height - projected.height) / 2, 6);
  });

  it("round-trips a world point through the projection", () => {
    const bounds = minimapBounds(nodes);
    if (bounds === null) throw new Error("bounds");
    const projection = minimapProjection(bounds);
    const world = { x: 123, y: -45 };
    const mapped = {
      x: world.x * projection.scale + projection.offsetX,
      y: world.y * projection.scale + projection.offsetY,
    };
    const back = minimapToWorld(mapped, projection);
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.y).toBeCloseTo(world.y, 6);
  });
});

describe("minimapViewportRect", () => {
  it("reflects the real viewport: screen = world*zoom + origin", () => {
    const bounds = minimapBounds(nodes);
    if (bounds === null) throw new Error("bounds");
    const projection = minimapProjection(bounds);
    const container = { width: 800, height: 600 };
    const viewport = { x: -100, y: -50, zoom: 0.5 };
    const rect = minimapViewportRect(viewport, container, projection);
    // Visible world: (200, 100) sized 1600x1200 at zoom 0.5.
    const expected = projectMinimapRect({ x: 200, y: 100, width: 1600, height: 1200 }, projection);
    expect(rect).toEqual(expected);
  });

  it("grows when the zoom drops and shrinks when it rises", () => {
    const bounds = minimapBounds(nodes);
    if (bounds === null) throw new Error("bounds");
    const projection = minimapProjection(bounds);
    const container = { width: 800, height: 600 };
    const wide = minimapViewportRect({ x: 0, y: 0, zoom: 0.5 }, container, projection);
    const tight = minimapViewportRect({ x: 0, y: 0, zoom: 1.5 }, container, projection);
    expect(wide.width).toBeGreaterThan(tight.width);
    expect(wide.height).toBeGreaterThan(tight.height);
  });
});

describe("minimapPanDelta + centerOnWorldPoint", () => {
  it("moves the viewport opposite the drag, scaled by zoom and inverse scale", () => {
    const projection = { scale: 0.2, offsetX: 10, offsetY: 5 };
    const delta = minimapPanDelta({ x: 8, y: -4 }, projection, 0.5);
    // 8 minimap px = 40 world px; at zoom 0.5 the origin moves -20.
    expect(delta.x).toBeCloseTo(-20, 6);
    expect(delta.y).toBeCloseTo(10, 6);
  });

  it("centres the clicked world point without touching the zoom", () => {
    const container = { width: 800, height: 600 };
    const viewport = centerOnWorldPoint({ x: 300, y: 200 }, 0.75, container);
    expect(viewport.zoom).toBe(0.75);
    // The world point lands at the container centre: 300*0.75 + x = 400.
    expect(300 * viewport.zoom + viewport.x).toBeCloseTo(container.width / 2, 6);
    expect(200 * viewport.zoom + viewport.y).toBeCloseTo(container.height / 2, 6);
  });

  it("a drag followed by its inverse leaves the viewport unchanged", () => {
    const bounds = minimapBounds(nodes);
    if (bounds === null) throw new Error("bounds");
    const projection = minimapProjection(bounds);
    const start = { x: -120, y: 40, zoom: 0.8 };
    const delta = minimapPanDelta({ x: 13, y: 7 }, projection, start.zoom);
    const back = minimapPanDelta({ x: -13, y: -7 }, projection, start.zoom);
    expect(start.x + delta.x + back.x).toBeCloseTo(start.x, 6);
    expect(start.y + delta.y + back.y).toBeCloseTo(start.y, 6);
  });
});
