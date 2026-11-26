// Graph notes on the map-and-lens surface (issue #194, D-126/D-214): a note is a markdown
// annotation whose x/y live in the graph's world coordinates — the same space the detail scene
// draws saved node positions in. These helpers stay pure so world->screen placement, content-box
// culling and the new-note anchor are testable without a DOM.

import type { GraphNote } from "../graph-types.ts";
import { roundCoordinate, type GraphPosition } from "../graph-layout-file.ts";
import { worldPoint, type SurfaceCamera } from "./camera.ts";
import type { SurfaceRect } from "./layout.ts";
import { contentBox, type SurfaceInsets } from "./safe-area.ts";

/** The card's world footprint. The DOM card is this wide; its height is capped, not exact. */
export const NOTE_WIDTH = 256;
export const NOTE_HEIGHT = 220;

export interface NoteViewport {
  readonly width: number;
  readonly height: number;
}

export interface NoteScreenPlacement {
  readonly left: number;
  readonly top: number;
  /** The CSS transform for the absolutely positioned card, scaled from its top-left origin. */
  readonly transform: string;
}

/** The world rectangle the card occupies; culling and centring share it. */
export function noteWorldRect(note: Pick<GraphNote, "x" | "y">): SurfaceRect {
  return { x: note.x, y: note.y, w: NOTE_WIDTH, h: NOTE_HEIGHT };
}

/** World origin -> screen origin, keeping the card anchored to its world point at any zoom. */
export function noteScreenPlacement(
  note: Pick<GraphNote, "x" | "y">,
  camera: SurfaceCamera,
): NoteScreenPlacement {
  const left = camera.tx + note.x * camera.scale;
  const top = camera.ty + note.y * camera.scale;
  return {
    left,
    top,
    transform: "translate(" + left + "px, " + top + "px) scale(" + camera.scale + ")",
  };
}

/**
 * The visible content box in world coordinates. The box excludes the top HUD and the drawer, so
 * a note under a control is not "visible" even though the canvas is on screen.
 */
export function noteContentBox(
  camera: SurfaceCamera,
  viewport: NoteViewport,
  insets: SurfaceInsets,
): SurfaceRect {
  const box = contentBox(viewport.width, viewport.height, insets);
  const topLeft = worldPoint(camera, box.x, box.y);
  const bottomRight = worldPoint(camera, box.x + box.w, box.y + box.h);
  return {
    x: topLeft.x,
    y: topLeft.y,
    w: Math.max(0, bottomRight.x - topLeft.x),
    h: Math.max(0, bottomRight.y - topLeft.y),
  };
}

/** A note is drawn only while its world rectangle intersects the visible content box. */
export function noteInContentBox(
  note: Pick<GraphNote, "x" | "y">,
  camera: SurfaceCamera,
  viewport: NoteViewport,
  insets: SurfaceInsets,
): boolean {
  const box = noteContentBox(camera, viewport, insets);
  return (
    note.x < box.x + box.w &&
    box.x < note.x + NOTE_WIDTH &&
    note.y < box.y + box.h &&
    box.y < note.y + NOTE_HEIGHT
  );
}

/**
 * Where a new note starts: centred in the visible content box of the current mode, never under
 * the HUD or the drawer, so the editor is immediately visible where the user clicked.
 */
export function noteContentCentre(
  camera: SurfaceCamera,
  viewport: NoteViewport,
  insets: SurfaceInsets,
): GraphPosition {
  const box = noteContentBox(camera, viewport, insets);
  return {
    x: roundCoordinate(box.x + box.w / 2 - NOTE_WIDTH / 2),
    y: roundCoordinate(box.y + box.h / 2 - NOTE_HEIGHT / 2),
  };
}

/** A committed empty note is deleted, never persisted (D-126). */
export function isNoteEmpty(text: string): boolean {
  return text.trim() === "";
}

/** The first non-empty line, with the leading heading marker removed: the a11y name. */
export function noteTitle(text: string): string {
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    return trimmed.replace(/^#{1,6}\s+/u, "");
  }
  return "";
}
