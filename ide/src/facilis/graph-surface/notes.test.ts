import { describe, expect, it } from "vitest";
import type { SurfaceCamera } from "./camera.ts";
import {
  NOTE_HEIGHT,
  NOTE_WIDTH,
  isNoteEmpty,
  noteContentBox,
  noteContentCentre,
  noteInContentBox,
  noteScreenPlacement,
  noteTitle,
  noteWorldRect,
} from "./notes.ts";
import type { SurfaceInsets } from "./safe-area.ts";

const CAMERA: SurfaceCamera = { tx: 0, ty: 0, scale: 1 };
const VIEWPORT = { width: 800, height: 600 };
const INSETS: SurfaceInsets = { top: 64, right: 200, bottom: 0 };

describe("noteScreenPlacement", () => {
  it("maps the note's world origin through the camera", () => {
    const placement = noteScreenPlacement({ x: 5, y: 6 }, { tx: 10, ty: 20, scale: 2 });
    expect(placement.left).toBe(20);
    expect(placement.top).toBe(32);
    expect(placement.transform).toBe("translate(20px, 32px) scale(2)");
  });
});

describe("noteContentBox", () => {
  it("excludes the HUD and the drawer from the visible world box", () => {
    expect(noteContentBox(CAMERA, VIEWPORT, INSETS)).toEqual({
      x: 0,
      y: 64,
      w: 600,
      h: 536,
    });
  });

  it("follows the camera translation and scale", () => {
    expect(noteContentBox({ tx: -100, ty: 0, scale: 2 }, VIEWPORT, INSETS)).toEqual({
      x: 50,
      y: 32,
      w: 300,
      h: 268,
    });
  });
});

describe("noteInContentBox", () => {
  it("keeps a note that intersects the free content box", () => {
    expect(noteInContentBox({ x: 100, y: 100 }, CAMERA, VIEWPORT, INSETS)).toBe(true);
    // Partially under the HUD/drawer still intersects: culling is not containment.
    expect(noteInContentBox({ x: 100, y: 0 }, CAMERA, VIEWPORT, INSETS)).toBe(true);
    expect(noteInContentBox({ x: 500, y: 100 }, CAMERA, VIEWPORT, INSETS)).toBe(true);
  });

  it("hides a note fully outside the free content box", () => {
    expect(noteInContentBox({ x: 100, y: 700 }, CAMERA, VIEWPORT, INSETS)).toBe(false);
    expect(noteInContentBox({ x: 800, y: 100 }, CAMERA, VIEWPORT, INSETS)).toBe(false);
    expect(noteInContentBox({ x: 100, y: 20 - NOTE_HEIGHT }, CAMERA, VIEWPORT, INSETS)).toBe(false);
  });

  it("re-culls after a pan or a zoom", () => {
    expect(
      noteInContentBox({ x: 0, y: 100 }, { tx: -100, ty: 0, scale: 2 }, VIEWPORT, INSETS),
    ).toBe(true);
    expect(
      noteInContentBox({ x: 500, y: 100 }, { tx: -100, ty: 0, scale: 2 }, VIEWPORT, INSETS),
    ).toBe(false);
  });
});

describe("noteContentCentre", () => {
  it("centres a new note in the free content box", () => {
    expect(noteContentCentre(CAMERA, VIEWPORT, INSETS)).toEqual({
      x: 300 - NOTE_WIDTH / 2,
      y: 332 - NOTE_HEIGHT / 2,
    });
  });

  it("places the note in world coordinates under a panned camera", () => {
    const position = noteContentCentre({ tx: -200, ty: -100, scale: 2 }, VIEWPORT, INSETS);
    const box = noteContentBox({ tx: -200, ty: -100, scale: 2 }, VIEWPORT, INSETS);
    expect(position.x).toBeCloseTo(box.x + box.w / 2 - NOTE_WIDTH / 2, 2);
    expect(position.y).toBeCloseTo(box.y + box.h / 2 - NOTE_HEIGHT / 2, 2);
  });
});

describe("noteWorldRect", () => {
  it("uses the card's fixed world footprint", () => {
    expect(noteWorldRect({ x: 3, y: 4 })).toEqual({ x: 3, y: 4, w: NOTE_WIDTH, h: NOTE_HEIGHT });
  });
});

describe("note text rules", () => {
  it("treats whitespace-only text as empty", () => {
    expect(isNoteEmpty("")).toBe(true);
    expect(isNoteEmpty("   \n\t")).toBe(true);
    expect(isNoteEmpty("hello")).toBe(false);
  });

  it("uses the first non-empty line, without its heading marker, as the title", () => {
    expect(noteTitle("# Payment notes\n\nbody")).toBe("Payment notes");
    expect(noteTitle("\n  first line  \nsecond")).toBe("first line");
    expect(noteTitle("   ")).toBe("");
  });
});
