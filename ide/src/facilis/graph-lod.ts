// The project graph's semantic zoom (issue #60, epic #56 rule 4): three levels of detail driven
// by the viewport zoom. Pure and total so the thresholds are unit-testable in Node; the React
// side (use-graph-lod.ts) reads the LEVEL through a quantised store selector, never the raw
// zoom, so a zoom gesture re-renders a card only when its level changes.
//
// Text floor: no rendered text may fall below 7 effective (screen) px. The full card keeps flow
// px sizes (>= 10 px, so > 9 px effective above the full threshold); chip and compact counter-
// scale through the --graph-lod-zoom CSS variable the canvas writes per frame, keeping their
// text at a constant screen size WITHOUT a React re-render per frame.

/** chip < 0.45 <= compact <= 0.9 < full (the issue's table: full is strictly above 0.9). */
export const GRAPH_LOD_COMPACT_ZOOM = 0.45;
export const GRAPH_LOD_FULL_ZOOM = 0.9;

/** The epic's readability floor, in effective (screen) pixels. */
export const GRAPH_LOD_MIN_TEXT_PX = 7;
/** The full card's base text floor, in flow pixels (issue #60: "at least 10 px"). */
export const GRAPH_LOD_FULL_MIN_TEXT_PX = 10;

/** The chip's visual box and minimum hit area, in SCREEN px (counter-scaled into flow px). */
export const GRAPH_LOD_CHIP_HEIGHT_PX = 28;
export const GRAPH_LOD_CHIP_HIT_PX = 24;

/** The CSS variable the canvas updates per frame; chip/compact sizes divide by it. */
export const GRAPH_LOD_ZOOM_VAR = "--graph-lod-zoom";

export type GraphLodLevel = "chip" | "compact" | "full";

/**
 * The level for a viewport zoom. Total: a non-finite or non-positive zoom (a corrupt viewport,
 * a store before init) degrades to the chip, the safest rendering. Boundaries follow the issue
 * table exactly: 0.45 is compact, 0.90 is still compact, anything above 0.9 is full.
 */
export function lodForZoom(zoom: number): GraphLodLevel {
  if (!Number.isFinite(zoom) || zoom < GRAPH_LOD_COMPACT_ZOOM) return "chip";
  return zoom <= GRAPH_LOD_FULL_ZOOM ? "compact" : "full";
}

/**
 * The counter-scaled length for a screen-px size: a CSS calc that divides by the live zoom so
 * the rendered size stays constant on screen. Used in inline styles (the value is dynamic, so
 * Tailwind cannot scan it); the fallback 1 keeps static markup (tests, SSR) at nominal size.
 */
export function lodScreenPx(px: number): string {
  return `calc(${px}px/var(${GRAPH_LOD_ZOOM_VAR},1))`;
}
