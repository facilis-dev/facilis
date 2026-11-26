// Touch gesture regression tests for issue #191. The canvas sets touch-action:none and feeds
// every pointer through the same math, so these are the behaviours the device check exercises:
// one finger pans, two fingers pinch about their midpoint, a tap stays under the slop, a node
// drag snaps to its column, and a cancelled pointer restores the node instead of committing.

import { describe, expect, it } from "vitest";
import { worldPoint } from "./camera.ts";
import { cancelNodeDragPosition, exceededTapSlop, panCamera, pinchCamera } from "./gestures.ts";
import { dragPosition, endNodeDrag, startNodeDrag } from "./drag.ts";
import type { DetailScene } from "./scene.ts";

const SCENE: DetailScene = {
  mode: "detail",
  domain: "core",
  layout: {
    positions: new Map([["n1", { x: 0, y: 0, w: 216, h: 56 }]]),
    headers: [],
    ports: [],
    edges: [],
    bounds: { x: 0, y: 0, w: 216, h: 56 },
  },
  columns: [0, 366, 732],
  nodeById: new Map(),
  neighbors: new Map(),
};

describe("one-finger pan", () => {
  it("translates the starting camera by the pointer delta", () => {
    const camera = panCamera({ tx: 100, ty: 50, scale: 1.5 }, { x: 10, y: 10 }, { x: 40, y: 25 });
    expect(camera).toEqual({ tx: 130, ty: 65, scale: 1.5 });
  });
});

describe("two-finger pinch", () => {
  it("records the first sample without jumping the camera", () => {
    const camera = { tx: 0, ty: 0, scale: 1 };
    expect(pinchCamera(camera, null, { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } })).toEqual(camera);
  });

  it("scales by the distance ratio and anchors the world point at the midpoint", () => {
    const camera = { tx: 20, ty: 10, scale: 1 };
    const previous = { a: { x: 100, y: 100 }, b: { x: 200, y: 100 } };
    const next = { a: { x: 50, y: 100 }, b: { x: 250, y: 100 } };
    const before = worldPoint(camera, 150, 100);
    const zoomed = pinchCamera(camera, previous, next);
    const after = worldPoint(zoomed, 150, 100);
    expect(zoomed.scale).toBeCloseTo(2, 5);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });
});

describe("tap vs drag threshold", () => {
  it("keeps small movement a tap and turns larger movement into a pan", () => {
    expect(exceededTapSlop({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
    expect(exceededTapSlop({ x: 0, y: 0 }, { x: 6, y: 0 })).toBe(true);
  });
});

describe("node drag on touch", () => {
  it("grabs a touched node and snaps the release to the nearest column", () => {
    const drag = startNodeDrag(SCENE, 20, 20);
    expect(drag).not.toBeNull();
    if (drag === null) throw new Error("expected a node drag");
    // Touch-like coordinates: a 360px horizontal drag with a small vertical offset.
    const live = dragPosition(drag, 380, 60);
    expect(live).toEqual({ x: 360, y: 40 });
    const drop = endNodeDrag(drag, SCENE, 380, 60);
    expect(drop).toEqual({ x: 366, y: 40 });
  });

  it("restores the origin when a pointer is cancelled instead of committing a drop", () => {
    const drag = startNodeDrag(SCENE, 20, 20);
    if (drag === null) throw new Error("expected a node drag");
    expect(cancelNodeDragPosition(drag.origin)).toEqual({ x: 0, y: 0 });
  });
});
