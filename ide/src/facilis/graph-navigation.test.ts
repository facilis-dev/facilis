// The navigation targets (issue #68): preset bands citing #60's LOD thresholds, zoom-to-node
// centring and clamping, the reduced-motion duration, and the breadcrumb trail data.

import { describe, expect, it } from "vitest";
import {
  GRAPH_MAX_ZOOM,
  GRAPH_MIN_ZOOM,
  GRAPH_NODE_FOCUS_ZOOM,
  GRAPH_SHORTCUTS,
  GRAPH_ZOOM_PRESET_COMPACT,
  GRAPH_ZOOM_PRESET_FULL,
  buildGraphBreadcrumbs,
  clampGraphZoom,
  panViewport,
  presetZoomViewport,
  viewportWorldCenter,
  zoomAnimationDuration,
  zoomToNodeViewport,
} from "./graph-navigation";

const container = { width: 1000, height: 800 };

describe("zoom presets", () => {
  it("keeps preset 1 in the compact band and preset 2 in the full band (#60 thresholds)", () => {
    // Semantic LOD (sibling #60): chip < 0.45 <= compact <= 0.9 < full.
    expect(GRAPH_ZOOM_PRESET_COMPACT).toBeGreaterThanOrEqual(0.45);
    expect(GRAPH_ZOOM_PRESET_COMPACT).toBeLessThanOrEqual(0.9);
    expect(GRAPH_ZOOM_PRESET_FULL).toBeGreaterThan(0.9);
    expect(GRAPH_NODE_FOCUS_ZOOM).toBeGreaterThan(0.9);
  });

  it("clamps to the canvas zoom band 0.05..2", () => {
    expect(clampGraphZoom(0.001)).toBe(GRAPH_MIN_ZOOM);
    expect(clampGraphZoom(99)).toBe(GRAPH_MAX_ZOOM);
    expect(clampGraphZoom(1)).toBe(1);
  });

  it("a preset keeps the world centre and only changes the zoom", () => {
    const current = { x: -200, y: 100, zoom: 0.5 };
    const center = viewportWorldCenter(current, container);
    const next = presetZoomViewport(current, container, GRAPH_ZOOM_PRESET_FULL);
    expect(next.zoom).toBe(GRAPH_ZOOM_PRESET_FULL);
    const after = viewportWorldCenter(next, container);
    expect(after.x).toBeCloseTo(center.x, 6);
    expect(after.y).toBeCloseTo(center.y, 6);
  });

  it("the 0 key resets to 100% around the same centre", () => {
    const current = { x: 30, y: -70, zoom: 1.8 };
    const next = presetZoomViewport(current, container, 1);
    expect(next.zoom).toBe(1);
    const before = viewportWorldCenter(current, container);
    const after = viewportWorldCenter(next, container);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});

describe("zoomToNodeViewport", () => {
  it("centres the node bounds at the detail zoom", () => {
    const bounds = { x: 300, y: 200, width: 240, height: 80 };
    const viewport = zoomToNodeViewport(bounds, container);
    expect(viewport.zoom).toBe(GRAPH_NODE_FOCUS_ZOOM);
    const centreX = bounds.x + bounds.width / 2;
    const centreY = bounds.y + bounds.height / 2;
    expect(centreX * viewport.zoom + viewport.x).toBeCloseTo(container.width / 2, 6);
    expect(centreY * viewport.zoom + viewport.y).toBeCloseTo(container.height / 2, 6);
  });

  it("clamps a hostile zoom request into the canvas band", () => {
    const bounds = { x: 0, y: 0, width: 10, height: 10 };
    expect(zoomToNodeViewport(bounds, container, 50).zoom).toBe(GRAPH_MAX_ZOOM);
    expect(zoomToNodeViewport(bounds, container, 0.0001).zoom).toBe(GRAPH_MIN_ZOOM);
  });
});

describe("motion + pan", () => {
  it("honours prefers-reduced-motion with an instant viewport", () => {
    expect(zoomAnimationDuration(true)).toBe(0);
    expect(zoomAnimationDuration(false)).toBeGreaterThan(0);
  });

  it("pans by a screen delta without touching the zoom", () => {
    const current = { x: 10, y: 20, zoom: 0.7 };
    const next = panViewport(current, { x: -40, y: 15 });
    expect(next).toEqual({ x: -30, y: 35, zoom: 0.7 });
  });
});

describe("breadcrumbs", () => {
  it("renders project → node in this base, as data", () => {
    const trail = buildGraphBreadcrumbs({ id: "table:todos", label: "todos" });
    expect(trail).toEqual([
      { kind: "project", id: null, label: null },
      { kind: "node", id: "table:todos", label: "todos" },
    ]);
  });

  it("is only the project root with no selection", () => {
    expect(buildGraphBreadcrumbs(null)).toEqual([{ kind: "project", id: null, label: null }]);
  });
});

describe("shortcut sheet data", () => {
  it("names every shortcut the issue requires", () => {
    const ids = GRAPH_SHORTCUTS.map((shortcut) => shortcut.id);
    for (const required of [
      "palette",
      "fit",
      "reset-zoom",
      "preset-compact",
      "preset-full",
      "toggle-mode",
      "enter",
      "escape",
      "help",
    ]) {
      expect(ids).toContain(required);
    }
    for (const shortcut of GRAPH_SHORTCUTS) {
      expect(shortcut.labelKey.startsWith("projectGraph.")).toBe(true);
      expect(shortcut.keys.length).toBeGreaterThan(0);
    }
  });
});
