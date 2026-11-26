// Pure pointer gesture math for the graph surface (D-219, issue #191). The canvas always uses
// touch-action:none and one unified PointerEvent pipeline, so a finger and a mouse share this
// module: one pointer pans, two pointers pinch about their midpoint, and a tap is a pointer that
// never crossed the slop. Keeping the math here makes touch behaviour testable without a DOM and
// keeps the React hook a thin event adapter.

import { zoomCamera, type SurfaceCamera } from "./camera.ts";

export interface PointerPoint {
  readonly x: number;
  readonly y: number;
}

/** Movement under this many pixels is still a tap/click, not a pan or a node drag. */
export const TAP_SLOP_PX = 5;

/** Two pointers, the sample a pinch compares against the next move. */
export interface PinchSample {
  readonly a: PointerPoint;
  readonly b: PointerPoint;
}

export function pointerDistance(a: PointerPoint, b: PointerPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointerMidpoint(a: PointerPoint, b: PointerPoint): PointerPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** True once the pointer left the tap slop: the gesture is a pan/drag, never a tap. */
export function exceededTapSlop(
  start: PointerPoint,
  current: PointerPoint,
  slop: number = TAP_SLOP_PX,
): boolean {
  return Math.abs(current.x - start.x) + Math.abs(current.y - start.y) > slop;
}

/** One-pointer pan: translate the gesture's starting camera by the pointer delta. */
export function panCamera(
  startCamera: SurfaceCamera,
  start: PointerPoint,
  current: PointerPoint,
): SurfaceCamera {
  return {
    ...startCamera,
    tx: startCamera.tx + (current.x - start.x),
    ty: startCamera.ty + (current.y - start.y),
  };
}

/**
 * Two-pointer pinch: scale by the distance ratio and keep the world point under the current
 * midpoint fixed. The first move after the second finger lands has no previous sample and only
 * records it (a pinch never jumps on touch-down).
 */
export function pinchCamera(
  camera: SurfaceCamera,
  previous: PinchSample | null,
  next: PinchSample,
): SurfaceCamera {
  if (previous === null) return camera;
  const previousDistance = pointerDistance(previous.a, previous.b);
  const nextDistance = pointerDistance(next.a, next.b);
  if (previousDistance <= 0 || nextDistance <= 0) return camera;
  const midpoint = pointerMidpoint(next.a, next.b);
  return zoomCamera(camera, midpoint.x, midpoint.y, nextDistance / previousDistance);
}

/** A pointer cancel is not a drop: the dragged node returns to its origin, unsaved. */
export function cancelNodeDragPosition(origin: { readonly x: number; readonly y: number }): {
  readonly x: number;
  readonly y: number;
} {
  return { x: origin.x, y: origin.y };
}
