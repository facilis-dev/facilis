// The gv viewport codec (issue #58, split from graph-view-state.ts for the 300-line limit):
// the URL carries a rounded [x, y, zoom] triple, not the layout file's object form. Pure and
// total — a hostile triple degrades to null (no viewport), never a throw.

import { isFiniteNumber, roundCoordinate, type GraphViewport } from "./graph-layout-file";

/** Zoom keeps three decimals: it is a ratio, not a pixel coordinate (two would visibly snap). */
function roundZoom(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Below this zoom the graph is unreadable (cards are sub-pixel): a persisted viewport this
 * small can only come from a collapsed auto-fit, so it degrades to null and the canvas fits
 * on mount instead of restoring an unusable view.
 */
const MIN_READABLE_ZOOM = 0.12;

export function encodeViewport(viewport: GraphViewport): [number, number, number] {
  return [roundCoordinate(viewport.x), roundCoordinate(viewport.y), roundZoom(viewport.zoom)];
}

export function readEncodedViewport(value: unknown): GraphViewport | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, zoom] = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(zoom)) return null;
  if (zoom < MIN_READABLE_ZOOM) return null;
  const rounded = { x: roundCoordinate(x), y: roundCoordinate(y), zoom: roundZoom(zoom) };
  // Rounding can overflow a hostile 1e308 to Infinity; such a viewport is not a view.
  if (!isFiniteNumber(rounded.x) || !isFiniteNumber(rounded.y) || !isFiniteNumber(rounded.zoom)) {
    return null;
  }
  return rounded;
}
