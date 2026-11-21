// Orthogonal edge routing for the project graph (issue #61): a Manhattan path between two card
// ports with a small bend budget, chosen so no segment passes under a card. Port pairs are tried
// nearest-first and lanes cheapest-first (endpoint lanes, then every card's border lanes); the
// first clean path within the budget wins, and a dense graph falls back to the least-colliding
// path rather than dropping the edge. A saved curve bends the middle segment, so the handle
// still moves by exactly the stored offset. Pure: the scene and the React edge share this router.

import {
  orthogonalGeometry,
  type EdgeGeometry,
  type Point,
  type Rect,
} from "./graph-edge-geometry";
import { portAnchorsRanked, portDirection, type PortAnchors } from "./graph-ports";

/** How far a stub reaches out of its port before the path may turn. */
const STUB = 14;

/** Segments keep this clearance from a card border; touching the inflated border is a hit. */
const CLEARANCE = 3;

/** A routing lane sits this far outside a card border. */
const LANE_MARGIN = CLEARANCE + 2;

/** Direction changes a routed path may make; stubs included. */
export const MAX_EDGE_BENDS = 4;

export interface RouteOptions {
  readonly obstacles: readonly Rect[];
  readonly curve?: Point | null;
}

interface RouteFound {
  readonly points: Point[];
  readonly hits: number;
  readonly bends: number;
  readonly length: number;
}

function shift(point: Point, direction: Point, distance: number): Point {
  return { x: point.x + direction.x * distance, y: point.y + direction.y * distance };
}

function rectBounds(rect: Rect) {
  return {
    left: rect.center.x - rect.width / 2,
    right: rect.center.x + rect.width / 2,
    top: rect.center.y - rect.height / 2,
    bottom: rect.center.y + rect.height / 2,
  };
}

/** True when an axis-aligned segment crosses the rect inflated by `clearance`. */
export function segmentHitsRect(a: Point, b: Point, rect: Rect, clearance = CLEARANCE): boolean {
  const bounds = rectBounds(rect);
  const left = bounds.left - clearance;
  const right = bounds.right + clearance;
  const top = bounds.top - clearance;
  const bottom = bounds.bottom + clearance;
  if (a.x === b.x) {
    if (a.x <= left || a.x >= right) return false;
    return Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom;
  }
  if (a.y === b.y) {
    if (a.y <= top || a.y >= bottom) return false;
    return Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right;
  }
  // Diagonal segments only come from the cubic fallback; use the bounding-box overlap.
  return (
    Math.max(a.x, b.x) > left &&
    Math.min(a.x, b.x) < right &&
    Math.max(a.y, b.y) > top &&
    Math.min(a.y, b.y) < bottom
  );
}

/** How many segments of a polyline pass under a card. */
export function countCardCollisions(
  points: readonly Point[],
  obstacles: readonly Rect[],
  clearance = CLEARANCE,
): number {
  let hits = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (obstacles.some((rect) => segmentHitsRect(a, b, rect, clearance))) hits += 1;
  }
  return hits;
}

function countBends(points: readonly Point[]): number {
  let bends = 0;
  for (let i = 1; i + 1 < points.length; i += 1) {
    const horizontalBefore = points[i].y === points[i - 1].y;
    const horizontalAfter = points[i + 1].y === points[i].y;
    if (horizontalBefore !== horizontalAfter) bends += 1;
  }
  return bends;
}

function pathLength(points: readonly Point[]): number {
  let length = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    length += Math.abs(points[i + 1].x - points[i].x) + Math.abs(points[i + 1].y - points[i].y);
  }
  return length;
}

/** Drop zero-length steps so a lane that lands on a stub does not add a phantom bend. */
function cleanPath(points: readonly Point[]): Point[] {
  const cleaned: Point[] = [];
  for (const point of points) {
    const last = cleaned[cleaned.length - 1];
    if (last === undefined || last.x !== point.x || last.y !== point.y) cleaned.push(point);
  }
  return cleaned;
}

function uniqueLanes(values: readonly number[]): number[] {
  return [...new Set(values.map((value) => Math.round(value * 100) / 100))];
}

/** Endpoint lanes first; the extended pass adds every card's border lanes (the grid corridors). */
function lanes(
  base: readonly number[],
  obstacles: readonly Rect[],
  extended: boolean,
  axis: "x" | "y",
): number[] {
  const values = [...base];
  if (extended) {
    for (const rect of obstacles) {
      const bounds = rectBounds(rect);
      if (axis === "x") values.push(bounds.left - LANE_MARGIN, bounds.right + LANE_MARGIN);
      else values.push(bounds.top - LANE_MARGIN, bounds.bottom + LANE_MARGIN);
    }
  }
  return uniqueLanes(values);
}

function candidatePaths(
  anchors: PortAnchors,
  sourceRect: Rect,
  targetRect: Rect,
  obstacles: readonly Rect[],
  extended: boolean,
): Point[][] {
  const sourceDir = portDirection(anchors.sourcePort);
  const targetDir = portDirection(anchors.targetPort);
  const start = shift(anchors.source, sourceDir, STUB);
  const end = shift(anchors.target, targetDir, STUB);
  const sourceHorizontal = sourceDir.y === 0;
  const targetHorizontal = targetDir.y === 0;
  const sourceBounds = rectBounds(sourceRect);
  const targetBounds = rectBounds(targetRect);
  const lanesX = lanes(
    [
      (start.x + end.x) / 2,
      start.x,
      end.x,
      sourceBounds.right + LANE_MARGIN,
      sourceBounds.left - LANE_MARGIN,
      targetBounds.right + LANE_MARGIN,
      targetBounds.left - LANE_MARGIN,
    ],
    obstacles,
    extended,
    "x",
  );
  const lanesY = lanes(
    [
      (start.y + end.y) / 2,
      start.y,
      end.y,
      sourceBounds.bottom + LANE_MARGIN,
      sourceBounds.top - LANE_MARGIN,
      targetBounds.bottom + LANE_MARGIN,
      targetBounds.top - LANE_MARGIN,
    ],
    obstacles,
    extended,
    "y",
  );
  const head = [anchors.source, start];
  const tail = [end, anchors.target];
  const paths: Point[][] = [];
  const push = (middle: readonly Point[]): void => {
    paths.push([...head, ...middle, ...tail]);
  };
  if (sourceHorizontal) {
    if (!targetHorizontal) {
      push([{ x: end.x, y: start.y }]);
      push([{ x: start.x, y: end.y }]);
    }
    for (const lane of lanesX)
      push([
        { x: lane, y: start.y },
        { x: lane, y: end.y },
      ]);
    // One extra jog: out of the port, along a horizontal corridor, across at a vertical lane.
    for (const laneY of lanesY) {
      for (const laneX of lanesX) {
        push([
          { x: start.x, y: laneY },
          { x: laneX, y: laneY },
          { x: laneX, y: end.y },
        ]);
      }
    }
  } else {
    if (targetHorizontal) {
      push([{ x: start.x, y: end.y }]);
      push([{ x: end.x, y: start.y }]);
    }
    for (const lane of lanesY)
      push([
        { x: start.x, y: lane },
        { x: end.x, y: lane },
      ]);
    for (const laneX of lanesX) {
      for (const laneY of lanesY) {
        push([
          { x: laneX, y: start.y },
          { x: laneX, y: laneY },
          { x: end.x, y: laneY },
        ]);
      }
    }
  }
  return paths.map(cleanPath);
}

/** The cheapest path for one port pair: first clean within budget, else least-colliding. */
function bestRoute(
  anchors: PortAnchors,
  sourceRect: Rect,
  targetRect: Rect,
  obstacles: readonly Rect[],
): RouteFound {
  let best: RouteFound | null = null;
  for (const extended of [false, true]) {
    for (const points of candidatePaths(anchors, sourceRect, targetRect, obstacles, extended)) {
      if (points.length < 2) continue;
      const hits = countCardCollisions(points, obstacles);
      const bends = countBends(points);
      const length = pathLength(points);
      if (hits === 0 && bends <= MAX_EDGE_BENDS) return { points, hits, bends, length };
      if (
        best === null ||
        hits < best.hits ||
        (hits === best.hits &&
          (bends < best.bends || (bends === best.bends && length < best.length)))
      ) {
        best = { points, hits, bends, length };
      }
    }
  }
  // candidatePaths always yields at least the two-point direct path.
  return best ?? { points: [anchors.source, anchors.target], hits: 0, bends: 0, length: 0 };
}

/**
 * Route one edge between two cards: the nearest port pair that yields a clean path within the
 * bend budget wins; if none does, the least-colliding route of the nearest pair is drawn.
 */
export function routeEdge(source: Rect, target: Rect, options: RouteOptions): EdgeGeometry {
  const curve = options.curve ?? null;
  const ranked = portAnchorsRanked(source, target);
  let fallback: RouteFound | null = null;
  for (const anchors of ranked) {
    const route = bestRoute(anchors, source, target, options.obstacles);
    if (route.hits === 0 && route.bends <= MAX_EDGE_BENDS)
      return orthogonalGeometry(route.points, curve);
    if (fallback === null) fallback = route;
  }
  // The 16-pair loop always sets a fallback; the degenerate centre line is unreachable.
  return orthogonalGeometry((fallback ?? { points: [source.center, target.center] }).points, curve);
}
