// The surface camera (D-211, issue #184): a pure translate+scale transform. Fit reserves
// drawer space and clamps to a readable scale floor; zoom keeps the cursor's world point fixed.
// Split from layout.ts so both stay under the 300-line source limit.

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
  return {
    scale,
    tx: vw / 2 - (bounds.x + bounds.w / 2) * scale,
    ty: vh / 2 - (bounds.y + bounds.h / 2) * scale,
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
