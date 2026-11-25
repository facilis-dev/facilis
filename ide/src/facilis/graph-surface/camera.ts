// The surface camera (D-211, issue #184): a pure translate+scale transform. Fit reserves
// drawer space and clamps to a readable scale floor; zoom keeps the cursor's world point fixed.
// Split from layout.ts so both stay under the 300-line source limit.

import type { GraphViewport } from "../graph-layout-file.ts";
import type { SurfaceRect } from "./layout.ts";

/** The camera is a pure translate+scale transform from world space to screen space. */
export interface SurfaceCamera {
  readonly tx: number;
  readonly ty: number;
  readonly scale: number;
}

export const SURFACE_MIN_ZOOM = 0.2;
export const SURFACE_MAX_ZOOM = 3;
/** Fit never shrinks below this scale: readable cards first, panning for the rest. */
export const SURFACE_MIN_FIT_SCALE = 0.85;

export interface FitOptions {
  readonly insetRight?: number;
  readonly insetBottom?: number;
  readonly maxScale?: number;
  readonly minScale?: number;
  readonly pad?: number;
}

/**
 * Fit the camera to bounds inside the free viewport (insets reserve drawer space so content
 * never hides under it). The scale is clamped to a readable floor: a large map opens pannable
 * instead of shrinking into micro-text.
 */
export function fitCamera(
  bounds: SurfaceRect,
  width: number,
  height: number,
  options: FitOptions = {},
): SurfaceCamera {
  const insetRight = options.insetRight ?? 0;
  const insetBottom = options.insetBottom ?? 0;
  const maxScale = options.maxScale ?? 1.1;
  const minScale = options.minScale ?? SURFACE_MIN_FIT_SCALE;
  const pad = options.pad ?? 48;
  const vw = Math.max(1, width - insetRight);
  const vh = Math.max(1, height - insetBottom);
  if (bounds.w <= 0 || bounds.h <= 0) return { tx: vw / 2, ty: vh / 2, scale: 1 };
  const raw = Math.min(maxScale, (vw - pad * 2) / bounds.w, (vh - pad * 2) / bounds.h);
  const scale = Math.max(minScale, Math.min(maxScale, raw));
  if (raw < minScale) {
    // The map is larger than the readable floor can show: anchor its top-left at the padding so
    // the first columns are readable immediately and the rest is a pan away (#191), instead of
    // centring an over-sized map and hiding both edges behind the viewport.
    return { scale, tx: pad - bounds.x * scale, ty: pad - bounds.y * scale };
  }
  return {
    scale,
    tx: vw / 2 - (bounds.x + bounds.w / 2) * scale,
    ty: vh / 2 - (bounds.y + bounds.h / 2) * scale,
  };
}

/**
 * Centre a world rect in the free viewport at a fixed scale: the search jump uses this so it
 * never changes the zoom while bringing a node into view.
 */
export function centerCameraOn(
  rect: SurfaceRect,
  width: number,
  height: number,
  scale: number,
  options: FitOptions = {},
): SurfaceCamera {
  const vw = Math.max(1, width - (options.insetRight ?? 0));
  const vh = Math.max(1, height - (options.insetBottom ?? 0));
  return {
    scale,
    tx: vw / 2 - (rect.x + rect.w / 2) * scale,
    ty: vh / 2 - (rect.y + rect.h / 2) * scale,
  };
}

/**
 * Pan-only response to the drawer changing its reserved area: opening shifts the map by half the
 * inset delta on each axis, closing shifts it back, and the scale is untouched (no zoom jump).
 * Shared by the side column and the bottom sheet (#187/#191).
 */
export function panCameraForInsets(
  camera: SurfaceCamera,
  previous: { readonly right: number; readonly bottom: number },
  next: { readonly right: number; readonly bottom: number },
): SurfaceCamera {
  if (previous.right === next.right && previous.bottom === next.bottom) return camera;
  return {
    ...camera,
    tx: camera.tx + (previous.right - next.right) / 2,
    ty: camera.ty + (previous.bottom - next.bottom) / 2,
  };
}

/** Zoom around a screen point, keeping the world point under the cursor fixed. */
export function zoomCamera(
  camera: SurfaceCamera,
  screenX: number,
  screenY: number,
  factor: number,
): SurfaceCamera {
  const scale = Math.max(SURFACE_MIN_ZOOM, Math.min(SURFACE_MAX_ZOOM, camera.scale * factor));
  const k = scale / camera.scale;
  return {
    scale,
    tx: screenX - (screenX - camera.tx) * k,
    ty: screenY - (screenY - camera.ty) * k,
  };
}

export function worldPoint(
  camera: SurfaceCamera,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return { x: (screenX - camera.tx) / camera.scale, y: (screenY - camera.ty) / camera.scale };
}

/** The persisted viewport (D-127) is the camera's translate+scale under its legacy names. */
export function cameraFromViewport(viewport: GraphViewport): SurfaceCamera {
  return { tx: viewport.x, ty: viewport.y, scale: viewport.zoom };
}

export function viewportFromCamera(camera: SurfaceCamera): GraphViewport {
  return { x: camera.tx, y: camera.ty, zoom: camera.scale };
}

export interface RestoreCameraInput {
  /** The camera this mode last had in the current session (overview <-> detail round trips). */
  readonly session?: SurfaceCamera;
  /** The saved viewport from viewport.json; only the overview restores it on open. */
  readonly saved?: GraphViewport;
  readonly bounds: SurfaceRect;
  readonly width: number;
  readonly height: number;
  readonly insetRight?: number;
  readonly insetBottom?: number;
}

/**
 * Restore, never silently re-fit (D-127): a session camera wins, then a valid saved viewport,
 * and only a first-ever open fits. This is what kills the open-time snap-back of #145.
 */
export function restoreCamera(input: RestoreCameraInput): SurfaceCamera {
  if (input.session !== undefined) return input.session;
  const saved = input.saved;
  if (saved !== undefined && Number.isFinite(saved.zoom) && saved.zoom > 0) {
    return cameraFromViewport(saved);
  }
  return fitCamera(input.bounds, input.width, input.height, {
    insetRight: input.insetRight,
    insetBottom: input.insetBottom,
    maxScale: 1.1,
  });
}
