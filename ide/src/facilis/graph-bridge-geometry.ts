// Bridge arc shape (issue #65): the quadratic spec, its SVG path, translation, and the apex
// label's zoom rules. Split from the planner (graph-edge-bridges.ts) so both stay under the
// 300-line limit; pure geometry shared by the React edge and the screenshot scene. Epic #56
// rule 4 lives here: no text below 7 px on screen, even when hover/focus reveals a label.

import { formatPoint, type EdgeGeometry, type Point } from "./graph-edge-geometry";

export type BridgeSide = "above" | "below";

export interface BridgeSpec {
  readonly edgeId: string;
  readonly side: BridgeSide;
  readonly source: Point;
  readonly target: Point;
  readonly control: Point;
  readonly apex: Point;
  /** Apex distance from the band edge; distinct within a corridor so arcs stay readable. */
  readonly radius: number;
  readonly label: string | null;
}

/** Apex label font size in flow px; on screen it is this times the viewport zoom. */
export const BRIDGE_LABEL_FONT_PX = 11;

/** Epic #56 rule 4: no text below 7 px on screen, so labels hide below this rendered size. */
export const BRIDGE_MIN_TEXT_PX = 7;

/** Point on the quadratic at t (0 = source, 1 = target); the apex sits at t = 0.5. */
export function quadraticPoint(source: Point, control: Point, target: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * source.x + 2 * u * t * control.x + t * t * target.x,
    y: u * u * source.y + 2 * u * t * control.y + t * t * target.y,
  };
}

/** The SVG path plus the apex as the handle position (a drag saves a curve and unbundles it). */
export function bridgeGeometry(spec: BridgeSpec): EdgeGeometry {
  return {
    path: `M ${formatPoint(spec.source)} Q ${formatPoint(spec.control)} ${formatPoint(spec.target)}`,
    midpoint: spec.apex,
  };
}

/** Translate a spec (the scene shifts flow coordinates into its padded picture). */
export function shiftBridgeSpec(spec: BridgeSpec, offset: Point): BridgeSpec {
  const move = (point: Point): Point => ({ x: point.x + offset.x, y: point.y + offset.y });
  return {
    ...spec,
    source: move(spec.source),
    target: move(spec.target),
    control: move(spec.control),
    apex: move(spec.apex),
  };
}

/** The apex label is drawn only when its rendered size clears the epic's 7 px floor. */
export function bridgeLabelVisible(zoom: number): boolean {
  return BRIDGE_LABEL_FONT_PX * zoom >= BRIDGE_MIN_TEXT_PX;
}

/**
 * Hover/focus reveals the label even below the floor, counter-scaled so it never renders
 * under 7 px on screen (epic rule 4 holds for revealed labels too).
 */
export function bridgeLabelFontPx(zoom: number, revealed: boolean): number {
  if (!revealed) return BRIDGE_LABEL_FONT_PX;
  const scale = zoom > 0 ? zoom : 1;
  return Math.max(BRIDGE_LABEL_FONT_PX, BRIDGE_MIN_TEXT_PX / scale);
}
