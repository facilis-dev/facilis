// HUD safe-area regression tests for issues #144 (HUD overlaps) and #155 (fit collapses).
// These are the two bugs that killed the previous canvas epic: fit opened below readability and
// reserved up to 40% per side while the controls overlapped each other. The drawer's geometry,
// the fit inset and the drawer-toggle pan share safe-area.ts/camera.ts, so the invariants below
// are the ones the surface actually runs.

import { describe, expect, it } from "vitest";
import { SURFACE_MIN_FIT_SCALE, fitCamera, panCameraForInset, worldPoint } from "./camera.ts";
import { hudLayout, rectsOverlap, surfaceInsets, DRAWER_INSET } from "./safe-area.ts";

const WIDTH = 1200;
const HEIGHT = 700;
const BOUNDS = { x: -400, y: -250, w: 800, h: 500 };

function screenRect(camera: { tx: number; ty: number; scale: number }, bounds: typeof BOUNDS) {
  return {
    left: bounds.x * camera.scale + camera.tx,
    top: bounds.y * camera.scale + camera.ty,
    right: (bounds.x + bounds.w) * camera.scale + camera.tx,
    bottom: (bounds.y + bounds.h) * camera.scale + camera.ty,
  };
}

describe("#155: fit never collapses below the readable floor", () => {
  it("drawer-open fit keeps the readable scale floor", () => {
    const camera = fitCamera(BOUNDS, WIDTH, HEIGHT, { insetRight: DRAWER_INSET, maxScale: 1.1 });
    expect(camera.scale).toBeGreaterThanOrEqual(SURFACE_MIN_FIT_SCALE);
  });

  it("a huge map opens pannable at the floor instead of shrinking into micro-text", () => {
    const camera = fitCamera({ x: 0, y: 0, w: 20000, h: 20000 }, 800, 600, {
      insetRight: DRAWER_INSET,
    });
    expect(camera.scale).toBe(SURFACE_MIN_FIT_SCALE);
  });

  it("drawer-open fitted content stays inside the visible (non-drawer) area", () => {
    const camera = fitCamera(BOUNDS, WIDTH, HEIGHT, { insetRight: DRAWER_INSET, maxScale: 1.1 });
    const visibleWidth = WIDTH - surfaceInsets(true).right;
    const rect = screenRect(camera, BOUNDS);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(visibleWidth + 0.001);
    expect(rect.bottom).toBeLessThanOrEqual(HEIGHT + 0.001);
  });

  it("opening the drawer pans without changing the zoom", () => {
    const camera = { tx: 10, ty: 20, scale: 1.3 };
    const panned = panCameraForInset(camera, 0, DRAWER_INSET);
    expect(panned.scale).toBe(camera.scale);
    // The world point at the free-area centre is the same before and after.
    const before = worldPoint(camera, WIDTH / 2, HEIGHT / 2);
    const after = worldPoint(panned, (WIDTH - DRAWER_INSET) / 2, HEIGHT / 2);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });
});

describe("#144: HUD controls and drawer never overlap", () => {
  it("the drawer, breadcrumb and hint are disjoint when the drawer is open", () => {
    const hud = hudLayout(WIDTH, HEIGHT, true);
    expect(hud.drawer).not.toBeNull();
    const drawer = hud.drawer;
    if (drawer === null) throw new Error("drawer rect missing");
    expect(rectsOverlap(drawer, hud.breadcrumb)).toBe(false);
    expect(rectsOverlap(drawer, hud.hint)).toBe(false);
    expect(rectsOverlap(hud.breadcrumb, hud.hint)).toBe(false);
  });

  it("a narrow surface clamps the HUD instead of sliding it under the drawer", () => {
    const hud = hudLayout(420, 500, true);
    const drawer = hud.drawer;
    if (drawer === null) throw new Error("drawer rect missing");
    expect(rectsOverlap(drawer, hud.breadcrumb)).toBe(false);
    expect(rectsOverlap(drawer, hud.hint)).toBe(false);
    expect(hud.breadcrumb.w).toBeLessThanOrEqual(260);
    expect(hud.hint.w).toBeLessThanOrEqual(320);
  });

  it("closed drawer leaves the full width to the HUD", () => {
    const hud = hudLayout(WIDTH, HEIGHT, false);
    expect(hud.drawer).toBeNull();
    expect(hud.breadcrumb.w).toBe(260);
    expect(hud.hint.w).toBe(320);
    expect(surfaceInsets(false).right).toBe(0);
  });
});
