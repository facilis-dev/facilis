// The key map and camera response behind the canvas keyboard pan/zoom (issue #213): arrows move
// the map, +/− zoom about the centre, 0 is left to the fit callback, and every modified chord
// stays with the window shortcuts.
import { describe, expect, it } from "vitest";
import { SURFACE_MAX_ZOOM, SURFACE_MIN_ZOOM } from "./camera.ts";
import {
  SURFACE_KEYBOARD_PAN_PX,
  cameraAfterKeyboard,
  surfaceKeyboardAction,
} from "./surface-keyboard.ts";

const CAMERA = { tx: 10, ty: 20, scale: 1 };
const SIZE = { width: 800, height: 600 };

describe("surfaceKeyboardAction", () => {
  it("maps the arrows to pans", () => {
    expect(surfaceKeyboardAction({ key: "ArrowLeft" })).toBe("pan-left");
    expect(surfaceKeyboardAction({ key: "ArrowRight" })).toBe("pan-right");
    expect(surfaceKeyboardAction({ key: "ArrowUp" })).toBe("pan-up");
    expect(surfaceKeyboardAction({ key: "ArrowDown" })).toBe("pan-down");
  });

  it("maps the plus/minus variants to zoom and 0 to fit", () => {
    expect(surfaceKeyboardAction({ key: "+" })).toBe("zoom-in");
    expect(surfaceKeyboardAction({ key: "=" })).toBe("zoom-in");
    expect(surfaceKeyboardAction({ key: "-" })).toBe("zoom-out");
    expect(surfaceKeyboardAction({ key: "_" })).toBe("zoom-out");
    expect(surfaceKeyboardAction({ key: "0" })).toBe("fit");
  });

  it("leaves every other key and the browser/OS chords alone", () => {
    expect(surfaceKeyboardAction({ key: "a" })).toBeNull();
    expect(surfaceKeyboardAction({ key: "Escape" })).toBeNull();
    expect(surfaceKeyboardAction({ key: "Tab" })).toBeNull();
    expect(surfaceKeyboardAction({ key: "ArrowDown", ctrlKey: true })).toBeNull();
    expect(surfaceKeyboardAction({ key: "ArrowDown", altKey: true })).toBeNull();
    expect(surfaceKeyboardAction({ key: "0", metaKey: true })).toBeNull();
  });
});

describe("cameraAfterKeyboard", () => {
  it("moves the map in the direction the arrow names", () => {
    expect(cameraAfterKeyboard("pan-left", CAMERA, SIZE.width, SIZE.height)).toEqual({
      tx: 10 + SURFACE_KEYBOARD_PAN_PX,
      ty: 20,
      scale: 1,
    });
    expect(cameraAfterKeyboard("pan-right", CAMERA, SIZE.width, SIZE.height)).toEqual({
      tx: 10 - SURFACE_KEYBOARD_PAN_PX,
      ty: 20,
      scale: 1,
    });
    expect(cameraAfterKeyboard("pan-up", CAMERA, SIZE.width, SIZE.height)).toEqual({
      tx: 10,
      ty: 20 + SURFACE_KEYBOARD_PAN_PX,
      scale: 1,
    });
    expect(cameraAfterKeyboard("pan-down", CAMERA, SIZE.width, SIZE.height)).toEqual({
      tx: 10,
      ty: 20 - SURFACE_KEYBOARD_PAN_PX,
      scale: 1,
    });
  });

  it("zooms around the centre of the visible area", () => {
    const zoomed = cameraAfterKeyboard("zoom-in", CAMERA, SIZE.width, SIZE.height);
    expect(zoomed.scale).toBeGreaterThan(CAMERA.scale);
    // The world point under the centre stays under the centre: 400 = tx + worldX * scale.
    const centreWorld = (SIZE.width / 2 - CAMERA.tx) / CAMERA.scale;
    expect(zoomed.tx + centreWorld * zoomed.scale).toBeCloseTo(SIZE.width / 2);
  });

  it("clamps the zoom at both ends like the pointer wheel", () => {
    const far = { tx: 0, ty: 0, scale: SURFACE_MAX_ZOOM };
    expect(cameraAfterKeyboard("zoom-in", far, SIZE.width, SIZE.height).scale).toBe(
      SURFACE_MAX_ZOOM,
    );
    const near = { tx: 0, ty: 0, scale: SURFACE_MIN_ZOOM };
    expect(cameraAfterKeyboard("zoom-out", near, SIZE.width, SIZE.height).scale).toBe(
      SURFACE_MIN_ZOOM,
    );
  });
});
