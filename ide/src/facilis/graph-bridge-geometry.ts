// Bridge arc shape (issue #65): the quadratic spec, its SVG path and its translation. Split
// from the planner (graph-edge-bridges.ts) so both stay under the 300-line limit; pure geometry
// shared by the React edge and the screenshot scene. The apex label's zoom rules live on the
// React side (ProjectGraphBridgeLabel): counter-scaled through lodScreenPx like the bundle
// count (#62) and the hub count (#64), so epic rule 4 holds at every zoom without a per-frame
// re-render.

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
