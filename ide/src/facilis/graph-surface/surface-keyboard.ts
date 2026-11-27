// Keyboard camera intent for the graph surface (issue #213): the canvas is the only pointer
// pan/zoom path, so it answers arrows (pan), +/− (zoom) and 0 (fit) while focused. Pure so the
// key map and the camera response are unit-tested without a DOM; the hook is a thin adapter.

import { zoomCamera, type SurfaceCamera } from "./camera.ts";
import { panCamera } from "./gestures.ts";

export type SurfaceKeyboardAction =
  "pan-left" | "pan-right" | "pan-up" | "pan-down" | "zoom-in" | "zoom-out" | "fit";

/** The actions that only move the camera; fit needs the scene bounds and stays in the hook. */
export type SurfaceKeyboardPanZoom = Exclude<SurfaceKeyboardAction, "fit">;

/** One arrow press moves the map by this many screen pixels. */
export const SURFACE_KEYBOARD_PAN_PX = 48;
export const SURFACE_KEYBOARD_ZOOM_STEP = 1.2;

export interface SurfaceKeyboardKeyLike {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export function surfaceKeyboardAction(event: SurfaceKeyboardKeyLike): SurfaceKeyboardAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  switch (event.key) {
    case "ArrowLeft":
      return "pan-left";
    case "ArrowRight":
      return "pan-right";
    case "ArrowUp":
      return "pan-up";
    case "ArrowDown":
      return "pan-down";
    // "+" needs Shift on most layouts, so Shift stays allowed for the zoom keys.
    case "+":
    case "=":
      return "zoom-in";
    case "-":
    case "_":
      return "zoom-out";
    case "0":
      return "fit";
    default:
      return null;
  }
}

/**
 * The camera after one keyboard pan/zoom, using the same pure transforms as the pointer gestures.
 * An arrow names the direction the view moves, so ArrowLeft reveals content on the left and the
 * map itself shifts right; zoom keeps the centre of the visible area fixed.
 */
export function cameraAfterKeyboard(
  action: SurfaceKeyboardPanZoom,
  camera: SurfaceCamera,
  width: number,
  height: number,
): SurfaceCamera {
  switch (action) {
    case "pan-left":
      return panCamera(camera, { x: 0, y: 0 }, { x: SURFACE_KEYBOARD_PAN_PX, y: 0 });
    case "pan-right":
      return panCamera(camera, { x: 0, y: 0 }, { x: -SURFACE_KEYBOARD_PAN_PX, y: 0 });
    case "pan-up":
      return panCamera(camera, { x: 0, y: 0 }, { x: 0, y: SURFACE_KEYBOARD_PAN_PX });
    case "pan-down":
      return panCamera(camera, { x: 0, y: 0 }, { x: 0, y: -SURFACE_KEYBOARD_PAN_PX });
    case "zoom-in":
      return zoomCamera(camera, width / 2, height / 2, SURFACE_KEYBOARD_ZOOM_STEP);
    case "zoom-out":
      return zoomCamera(camera, width / 2, height / 2, 1 / SURFACE_KEYBOARD_ZOOM_STEP);
  }
}
