// HUD safe-area geometry for the map-and-lens surface (D-211, issue #187). The floating
// inspector drawer reserves a right column: the camera fit, the breadcrumb and the hint all
// read these numbers from one place, so no control can overlap the drawer (#144) and fit never
// forgets the drawer width (#155). Pure geometry, unit-testable without a DOM.

import type { SurfaceRect } from "./layout.ts";

/** The drawer's width: the same w-80 the inspector has always used. */
export const DRAWER_WIDTH = 320;
/** The gap between the drawer and the surface edge. */
export const DRAWER_GAP = 8;
/** The drawer starts below the breadcrumb row, never on top of it. */
export const DRAWER_TOP = 48;
/** HUD elements keep this gap from each other and from the drawer. */
export const HUD_GAP = 8;

/** What the drawer takes from the free viewport: fit and camera pan both reserve it. */
export const DRAWER_INSET = DRAWER_WIDTH + DRAWER_GAP * 2;

export interface SurfaceInsets {
  readonly right: number;
  readonly bottom: number;
}

/** The camera inset for the current drawer state. */
export function surfaceInsets(drawerOpen: boolean): SurfaceInsets {
  return { right: drawerOpen ? DRAWER_INSET : 0, bottom: 0 };
}

/** The drawer's screen rect, clamped so it still exists on a narrow surface. */
export function drawerRect(width: number, height: number): SurfaceRect {
  const w = Math.max(0, Math.min(DRAWER_WIDTH, width - DRAWER_GAP * 2));
  return {
    x: width - DRAWER_GAP - w,
    y: DRAWER_TOP,
    w,
    h: Math.max(0, height - DRAWER_TOP - DRAWER_GAP),
  };
}

export interface HudLayout {
  readonly breadcrumb: SurfaceRect;
  readonly hint: SurfaceRect;
  /** null when the drawer is closed. */
  readonly drawer: SurfaceRect | null;
}

/**
 * The HUD rectangles for a surface size. When the drawer is open the left controls are clamped
 * to the free column, so a long breadcrumb can never slide under the drawer.
 */
export function hudLayout(width: number, height: number, drawerOpen: boolean): HudLayout {
  const drawer = drawerOpen ? drawerRect(width, height) : null;
  const leftLimit = drawer === null ? width - HUD_GAP * 2 : drawer.x - HUD_GAP * 2;
  return {
    breadcrumb: { x: HUD_GAP, y: HUD_GAP, w: Math.max(0, Math.min(260, leftLimit)), h: 30 },
    hint: {
      x: HUD_GAP,
      y: Math.max(0, height - HUD_GAP - 24),
      w: Math.max(0, Math.min(320, leftLimit)),
      h: 24,
    },
    drawer,
  };
}

export function rectsOverlap(a: SurfaceRect, b: SurfaceRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
