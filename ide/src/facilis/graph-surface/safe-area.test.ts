// HUD and drawer safe-area regression tests for issues #144 (HUD overlaps), #155 (fit collapses)
// and #191 (mobile bottom sheet). These are the bugs that killed the previous canvas epic: fit
// opened below readability, reserved up to 40% per side and overlapped the controls; the mobile
// sheet must reserve its height without hiding the selected node. The drawer's geometry, the fit
// inset and the drawer-toggle pan share safe-area.ts/camera.ts, so the invariants below are the
// ones the surface actually runs.

import { describe, expect, it } from "vitest";
import {
  SURFACE_MIN_FIT_SCALE,
  centerCameraOn,
  fitCamera,
  panCameraForInsets,
  worldPoint,
} from "./camera.ts";
import {
  DRAWER_INSET,
  SHEET_MAX_HEIGHT,
  drawerGeometry,
  drawerInsets,
  drawerMode,
  hudLayout,
  rectsOverlap,
  sheetHeight,
} from "./safe-area.ts";

const WIDTH = 1200;
const HEIGHT = 700;
const BOUNDS = { x: -400, y: -250, w: 800, h: 500 };
const MOBILE = { width: 390, height: 844 };

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

  it("an over-sized map aligns to left/top instead of hiding both edges", () => {
    const camera = fitCamera(BOUNDS, MOBILE.width, MOBILE.height);
    expect(camera.scale).toBe(SURFACE_MIN_FIT_SCALE);
    const rect = screenRect(camera, BOUNDS);
    expect(rect.left).toBeGreaterThan(0);
    expect(rect.top).toBeGreaterThan(0);
    expect(rect.left).toBeLessThan(MOBILE.width);
    expect(rect.top).toBeLessThan(MOBILE.height);
  });

  it("drawer-open fitted content stays inside the visible (non-drawer) area", () => {
    const camera = fitCamera(BOUNDS, WIDTH, HEIGHT, { insetRight: DRAWER_INSET, maxScale: 1.1 });
    const visibleWidth = WIDTH - drawerInsets(false, HEIGHT, true).right;
    const rect = screenRect(camera, BOUNDS);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(visibleWidth + 0.001);
    expect(rect.bottom).toBeLessThanOrEqual(HEIGHT + 0.001);
  });

  it("opening the drawer pans without changing the zoom", () => {
    const camera = { tx: 10, ty: 20, scale: 1.3 };
    const panned = panCameraForInsets(
      camera,
      { right: 0, bottom: 0 },
      { right: DRAWER_INSET, bottom: 0 },
    );
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
    expect(drawerInsets(false, HEIGHT, false).right).toBe(0);
  });
});

describe("#191: mobile bottom sheet", () => {
  it("switches to a sheet below the shared narrow breakpoint", () => {
    expect(drawerMode(390)).toBe("sheet");
    expect(drawerMode(640)).toBe("side");
  });

  it("caps the sheet height so the map above it stays usable", () => {
    expect(sheetHeight(844)).toBe(SHEET_MAX_HEIGHT);
    expect(sheetHeight(400)).toBe(240);
  });

  it("pins the sheet to the bottom, full width minus the edge gaps", () => {
    const geometry = drawerGeometry(MOBILE.width, MOBILE.height, true);
    expect(geometry.mode).toBe("sheet");
    expect(geometry.rect).toEqual({
      x: 8,
      y: MOBILE.height - 8 - SHEET_MAX_HEIGHT,
      w: MOBILE.width - 16,
      h: SHEET_MAX_HEIGHT,
    });
    expect(geometry.insets).toEqual({ right: 0, bottom: SHEET_MAX_HEIGHT + 8 });
  });

  it("reserves the sheet height in fit so the map opens above it", () => {
    const insets = drawerInsets(true, MOBILE.height, true);
    const camera = fitCamera(BOUNDS, MOBILE.width, MOBILE.height, {
      insetRight: insets.right,
      insetBottom: insets.bottom,
    });
    const rect = screenRect(camera, BOUNDS);
    expect(camera.scale).toBeGreaterThanOrEqual(SURFACE_MIN_FIT_SCALE);
    // The floor-anchored map starts at the padding, not under the sheet.
    expect(rect.top).toBeGreaterThan(0);
    expect(rect.left).toBeGreaterThan(0);
  });

  it("centres the selected node ABOVE the sheet, not behind it", () => {
    const node = { x: 0, y: 0, w: 100, h: 50 };
    const bottomInset = drawerInsets(true, MOBILE.height, true).bottom;
    const camera = centerCameraOn(node, MOBILE.width, MOBILE.height, 0.85, {
      insetBottom: bottomInset,
    });
    const centerY = (node.y + node.h / 2) * camera.scale + camera.ty;
    expect(centerY).toBeCloseTo((MOBILE.height - bottomInset) / 2, 5);
    expect(centerY + (node.h / 2) * camera.scale).toBeLessThanOrEqual(
      MOBILE.height - bottomInset + 0.001,
    );
  });

  it("keeps the HUD hint above the sheet and disjoint from it at 390x844", () => {
    const hud = hudLayout(MOBILE.width, MOBILE.height, true);
    if (hud.drawer === null) throw new Error("drawer rect missing");
    expect(rectsOverlap(hud.drawer, hud.breadcrumb)).toBe(false);
    expect(rectsOverlap(hud.drawer, hud.hint)).toBe(false);
    expect(rectsOverlap(hud.breadcrumb, hud.hint)).toBe(false);
    expect(hud.hint.y + hud.hint.h).toBeLessThanOrEqual(hud.drawer.y);
  });
});
