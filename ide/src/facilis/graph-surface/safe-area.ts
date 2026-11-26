// HUD and drawer safe-area geometry for the map-and-lens surface (D-211, issues #144/#155/#187/
// #191). The inspector reserves a right column on wide viewports and a bottom sheet on narrow
// ones: fit, centre, the breadcrumb and the hint all read these numbers from one place, so no
// control can overlap the drawer and fit never forgets its footprint. Pure geometry, unit-testable
// without a DOM. The sheet breakpoint matches the rich card's sheet breakpoint (#188).

import type { SurfaceRect } from "./layout.ts";

/** The side drawer's width: the same w-80 the inspector has always used. */
export const DRAWER_WIDTH = 320;
/** The gap between the drawer and the surface edge. */
export const DRAWER_GAP = 8;
/** The side drawer starts below the breadcrumb row, never on top of it. */
export const DRAWER_TOP = 48;
/** HUD elements keep this gap from each other and from the drawer. */
export const HUD_GAP = 8;
/** Breadcrumb row: top gap + one text-xs line with its border. */
export const HUD_BREADCRUMB_HEIGHT = 30;
/** The lens switcher row starts under the breadcrumb (Tailwind `top-12`). */
export const HUD_LENS_BAR_TOP = 48;
/** The collapsed lens switcher: p-1 + one line of Q&A chips. */
export const HUD_LENS_BAR_HEIGHT = 32;
/**
 * The top HUD footprint fit/centre must clear: the breadcrumb AND the lens switcher row, plus a
 * gap before the first card. A domain card under the switcher is the #144 overlap class.
 */
export const HUD_TOP_INSET = HUD_LENS_BAR_TOP + HUD_LENS_BAR_HEIGHT + HUD_GAP;
/** Below this viewport width the inspector is a bottom sheet, not a side column. */
export const DRAWER_SHEET_BREAKPOINT = 640;
/** The sheet fills at most this fraction of the surface height (it scrolls inside). */
export const SHEET_HEIGHT_RATIO = 0.6;
/** The sheet never grows taller than this, leaving the map readable above it. */
export const SHEET_MAX_HEIGHT = 360;
/** The hint sits above the sheet with this gap. */
export const HINT_HEIGHT = 24;

/** What the drawer takes from the free viewport: fit and camera pan both reserve it. */
export const DRAWER_INSET = DRAWER_WIDTH + DRAWER_GAP * 2;

export type DrawerMode = "side" | "sheet";

export interface SurfaceInsets {
  /** HUD row(s) pinned to the top of the surface: fit and centre stay below it. */
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The drawer's placement for the viewport width. */
export function drawerMode(width: number): DrawerMode {
  return width < DRAWER_SHEET_BREAKPOINT ? "sheet" : "side";
}

/** The sheet's height, capped so the map above it never disappears. */
export function sheetHeight(height: number): number {
  return Math.max(0, Math.min(SHEET_MAX_HEIGHT, Math.round(height * SHEET_HEIGHT_RATIO)));
}

/** The drawer's side-column rect, clamped so it still exists on a narrow surface. */
export function drawerRect(width: number, height: number): SurfaceRect {
  const w = Math.max(0, Math.min(DRAWER_WIDTH, width - DRAWER_GAP * 2));
  return {
    x: width - DRAWER_GAP - w,
    y: DRAWER_TOP,
    w,
    h: Math.max(0, height - DRAWER_TOP - DRAWER_GAP),
  };
}

/** The bottom-sheet rect: full width minus the edge gaps, pinned to the bottom. */
export function sheetRect(width: number, height: number): SurfaceRect {
  const h = sheetHeight(height);
  return {
    x: DRAWER_GAP,
    y: Math.max(DRAWER_GAP, height - DRAWER_GAP - h),
    w: Math.max(0, width - DRAWER_GAP * 2),
    h,
  };
}

export interface DrawerGeometry {
  readonly mode: DrawerMode;
  /** null when the drawer is closed. */
  readonly rect: SurfaceRect | null;
  readonly insets: SurfaceInsets;
}

/**
 * The camera inset for the current HUD/drawer state: the top HUD is always reserved, and the
 * drawer adds a right column or a bottom sheet. Every camera path (fit, centre, restore) reads
 * this one function, so no control can cover content.
 */
export function drawerInsets(sheet: boolean, height: number, drawerOpen: boolean): SurfaceInsets {
  const top = HUD_TOP_INSET;
  if (!drawerOpen) return { top, right: 0, bottom: 0 };
  return sheet
    ? { top, right: 0, bottom: sheetHeight(height) + DRAWER_GAP }
    : { top, right: DRAWER_INSET, bottom: 0 };
}

/** The free content box after every inset: fit/centre compute over THIS, never the full surface. */
export function contentBox(width: number, height: number, insets: SurfaceInsets): SurfaceRect {
  return {
    x: 0,
    y: insets.top,
    w: Math.max(0, width - insets.right),
    h: Math.max(0, height - insets.top - insets.bottom),
  };
}

/** The full drawer geometry, including the reserved camera inset. */
export function drawerGeometry(width: number, height: number, drawerOpen: boolean): DrawerGeometry {
  const mode = drawerMode(width);
  if (!drawerOpen)
    return { mode, rect: null, insets: drawerInsets(mode === "sheet", height, false) };
  return {
    mode,
    rect: mode === "sheet" ? sheetRect(width, height) : drawerRect(width, height),
    insets: drawerInsets(mode === "sheet", height, true),
  };
}

export interface HudLayout {
  readonly breadcrumb: SurfaceRect;
  /** The collapsed lens switcher row under the breadcrumb. */
  readonly lensBar: SurfaceRect;
  readonly hint: SurfaceRect;
  /** null when the drawer is closed. */
  readonly drawer: SurfaceRect | null;
}

/**
 * The HUD rectangles for a surface size. When the side drawer is open the left controls are
 * clamped to the free column; when the bottom sheet is open the hint moves above it. Either way a
 * control can never slide under the drawer (#144) or over the sheet (#191).
 */
export function hudLayout(width: number, height: number, drawerOpen: boolean): HudLayout {
  const geometry = drawerGeometry(width, height, drawerOpen);
  const drawer = geometry.rect;
  const leftLimit =
    drawer !== null && geometry.mode === "side" ? drawer.x - HUD_GAP * 2 : width - HUD_GAP * 2;
  const hintY =
    drawer !== null && geometry.mode === "sheet"
      ? Math.max(0, drawer.y - HUD_GAP - HINT_HEIGHT)
      : Math.max(0, height - HUD_GAP - HINT_HEIGHT);
  return {
    breadcrumb: {
      x: HUD_GAP,
      y: HUD_GAP,
      w: Math.max(0, Math.min(260, leftLimit)),
      h: HUD_BREADCRUMB_HEIGHT,
    },
    lensBar: {
      x: HUD_GAP,
      y: HUD_LENS_BAR_TOP,
      w: Math.max(0, Math.min(448, leftLimit)),
      h: HUD_LENS_BAR_HEIGHT,
    },
    hint: { x: HUD_GAP, y: hintY, w: Math.max(0, Math.min(320, leftLimit)), h: HINT_HEIGHT },
    drawer,
  };
}

export function rectsOverlap(a: SurfaceRect, b: SurfaceRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
