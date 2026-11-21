// Long-edge bridges (issue #65, epic #56): an edge whose orthogonal route renders longer than
// BRIDGE_LENGTH_THRESHOLD (or collides with a card) is drawn as a quadratic arc that leaves the
// source port, flies above/below the layer band and re-enters the target port, with a label at
// the apex. Pure: the React edge and the screenshot scene share this one planner, so the canvas
// and graph_screenshot agree. A saved user curve keeps the orthogonal rendering — explicit user
// intent wins over automatic bridging — and short orthogonal routes between neighbours are
// never bridged. Clearance is sound (graph-bridge-clearance.ts): the arc lies inside its control
// triangle, and subdivision proves every piece misses every card before the bridge is drawn.

import { EDGE_ENDPOINT_GAP, type Point, type Rect } from "./graph-edge-geometry";
import { BRIDGE_CLEARANCE, bridgeClearsCards } from "./graph-bridge-clearance";
import { quadraticPoint, type BridgeSide, type BridgeSpec } from "./graph-bridge-geometry";
import { routeEdgeInfo } from "./graph-edge-routing";
import { portPoint } from "./graph-ports";
import type { GraphCurve } from "./graph-types";

/** Rendered orthogonal length (flow px) above which an edge becomes a bridge. */
export const BRIDGE_LENGTH_THRESHOLD = 1200;

/** Apex lift of the first bridge in a corridor, measured from the band edge. */
export const BRIDGE_BASE_LIFT = 48;

/** Radius stagger between bridges sharing a corridor, and the clearance-retry step. */
export const BRIDGE_RADIUS_STEP = 26;

/** Lift-search cap: an edge that cannot clear the band keeps its orthogonal route. */
const MAX_LIFT_ATTEMPTS = 24;

/** Control offset into the free gap beside the deep endpoint (under half a column gap). */
const BRIDGE_CONTROL_OFFSET = 24;

/** The structural edge shape the planner needs; ProjectGraphEdge satisfies it. */
export interface BridgeEdgeInput {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label: string | null;
}

export interface BridgePlanInput {
  readonly edges: readonly BridgeEdgeInput[];
  readonly rects: ReadonlyMap<string, Rect>;
  readonly curves: Readonly<Record<string, GraphCurve>>;
  readonly enabled: boolean;
}

/** The detection rule: a long rendered route, or one that collides with a card (issue #65). */
export function shouldBridgeRoute(length: number, hits: number): boolean {
  return length > BRIDGE_LENGTH_THRESHOLD || hits > 0;
}

function routeLength(points: readonly Point[]): number {
  let length = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    length += Math.abs(points[i + 1].x - points[i].x) + Math.abs(points[i + 1].y - points[i].y);
  }
  return length;
}

interface Band {
  readonly top: number;
  readonly bottom: number;
  readonly centerY: number;
}

function bandOf(obstacles: readonly Rect[]): Band | null {
  if (obstacles.length === 0) return null;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const rect of obstacles) {
    top = Math.min(top, rect.center.y - rect.height / 2);
    bottom = Math.max(bottom, rect.center.y + rect.height / 2);
  }
  return { top, bottom, centerY: (top + bottom) / 2 };
}

function specAt(
  edgeId: string,
  side: BridgeSide,
  source: Point,
  target: Point,
  band: Band,
  lift: number,
  label: string | null,
): BridgeSpec {
  // The endpoint deeper inside the band escapes almost vertically through its own port gap:
  // the control sits in that gap, so the arc never drags through the neighbouring column. A
  // midpoint control would force a shallow climb across every card between the endpoints.
  const deep =
    side === "above"
      ? source.y >= target.y
        ? source
        : target
      : source.y <= target.y
        ? source
        : target;
  const shallow = deep === source ? target : source;
  const toward = Math.sign(shallow.x - deep.x) || 1;
  const apexY = side === "above" ? band.top - lift : band.bottom + lift;
  // B(0.5) = (source + 2 control + target) / 4, so this control parks the apex exactly there.
  const control = {
    x: deep.x + toward * BRIDGE_CONTROL_OFFSET,
    y: 2 * apexY - (source.y + target.y) / 2,
  };
  const apex = { x: (source.x + 2 * control.x + target.x) / 4, y: apexY };
  return { edgeId, side, source, target, control, apex, radius: lift, label };
}

/** A sample on the curve inside an inflated card is a definite hit: cheap rejection. */
function sampleHitsCard(
  source: Point,
  control: Point,
  target: Point,
  obstacles: readonly Rect[],
): boolean {
  for (let i = 1; i < 24; i += 1) {
    const point = quadraticPoint(source, control, target, i / 24);
    for (const rect of obstacles) {
      if (
        point.x > rect.center.x - rect.width / 2 - BRIDGE_CLEARANCE &&
        point.x < rect.center.x + rect.width / 2 + BRIDGE_CLEARANCE &&
        point.y > rect.center.y - rect.height / 2 - BRIDGE_CLEARANCE &&
        point.y < rect.center.y + rect.height / 2 + BRIDGE_CLEARANCE
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * The smallest lift that clears every card. Raising the apex only raises the arc (the control
 * is the sole lift-dependent term, with a positive weight on the open interval), so clearance
 * is monotone in the lift and a binary search over the step grid finds the threshold in a
 * handful of proofs — the drag-time planner budget depends on it.
 */
function minClearLift(
  edgeId: string,
  side: BridgeSide,
  source: Point,
  target: Point,
  band: Band,
  obstacles: readonly Rect[],
  label: string | null,
): number | null {
  const clears = (attempt: number): boolean => {
    const lift = BRIDGE_BASE_LIFT + attempt * BRIDGE_RADIUS_STEP;
    const spec = specAt(edgeId, side, source, target, band, lift, label);
    // Reject cheaply first; the subdivision proof only runs on a sampled-clear candidate.
    if (sampleHitsCard(spec.source, spec.control, spec.target, obstacles)) return false;
    return bridgeClearsCards(spec.source, spec.control, spec.target, obstacles);
  };
  let lo = 0;
  let hi = MAX_LIFT_ATTEMPTS - 1;
  if (!clears(hi)) return null;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (clears(mid)) hi = mid;
    else lo = mid + 1;
  }
  return BRIDGE_BASE_LIFT + lo * BRIDGE_RADIUS_STEP;
}

interface Candidate {
  readonly edgeId: string;
  readonly side: BridgeSide;
  readonly source: Point;
  readonly target: Point;
  readonly spanStart: number;
  readonly spanEnd: number;
  readonly minLift: number;
  readonly label: string | null;
}

/**
 * Decide which edges bridge and stagger their radii. A corridor is one side of the band with
 * overlapping horizontal spans; within it every bridge gets a distinct lift (greedy interval
 * colouring plus a strictly-increasing pass), so parallel arcs never coincide. Deterministic:
 * edges are walked in id order and corridors in span order.
 */
export function planGraphBridges(input: BridgePlanInput): ReadonlyMap<string, BridgeSpec> {
  const plan = new Map<string, BridgeSpec>();
  if (!input.enabled) return plan;
  const obstacles = [...input.rects.values()];
  const band = bandOf(obstacles);
  if (band === null) return plan;
  const candidates: Candidate[] = [];
  const edges = [...input.edges].sort((a, b) => a.id.localeCompare(b.id));
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    // A saved curve is explicit user intent: keep the orthogonal rendering (issue #65).
    if (input.curves[edge.id] !== undefined) continue;
    const source = input.rects.get(edge.source);
    const target = input.rects.get(edge.target);
    if (source === undefined || target === undefined) continue;
    const route = routeEdgeInfo(source, target, { obstacles });
    // Neighbours with a short clean orthogonal route keep the direct path.
    if (!shouldBridgeRoute(routeLength(route.points), route.hits)) continue;
    const side: BridgeSide =
      (source.center.y + target.center.y) / 2 <= band.centerY ? "above" : "below";
    // Facing side ports: the arc leaves sideways, so it never climbs through the cards
    // stacked above/below its own column — a top port would trap it there (issue #65).
    const eastward = target.center.x >= source.center.x;
    const from = portPoint(source, eastward ? "right" : "left", EDGE_ENDPOINT_GAP);
    const to = portPoint(target, eastward ? "left" : "right", EDGE_ENDPOINT_GAP);
    const minLift = minClearLift(edge.id, side, from, to, band, obstacles, edge.label);
    if (minLift === null) continue;
    candidates.push({
      edgeId: edge.id,
      side,
      source: from,
      target: to,
      spanStart: Math.min(from.x, to.x),
      spanEnd: Math.max(from.x, to.x),
      minLift,
      label: edge.label,
    });
  }
  for (const side of ["above", "below"] as const) {
    const lane = candidates
      .filter((candidate) => candidate.side === side)
      .sort((a, b) => a.spanStart - b.spanStart || a.edgeId.localeCompare(b.edgeId));
    const assigned: { start: number; end: number; index: number; lift: number }[] = [];
    for (const candidate of lane) {
      const overlapping = assigned.filter(
        (entry) => entry.start <= candidate.spanEnd && candidate.spanStart <= entry.end,
      );
      const used = new Set(overlapping.map((entry) => entry.index));
      let index = 0;
      while (used.has(index)) index += 1;
      const maxOverlapLift = overlapping.reduce((max, entry) => Math.max(max, entry.lift), 0);
      const lift = Math.max(
        candidate.minLift,
        BRIDGE_BASE_LIFT + index * BRIDGE_RADIUS_STEP,
        maxOverlapLift + BRIDGE_RADIUS_STEP,
      );
      assigned.push({ start: candidate.spanStart, end: candidate.spanEnd, index, lift });
      plan.set(
        candidate.edgeId,
        specAt(
          candidate.edgeId,
          side,
          candidate.source,
          candidate.target,
          band,
          lift,
          candidate.label,
        ),
      );
    }
  }
  return plan;
}
