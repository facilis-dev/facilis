// The sound clearance proof for bridge arcs (issue #65): a quadratic Bezier lies inside its
// control triangle, and de Casteljau subdivision covers the curve with ever-smaller triangles.
// If every piece misses every card (SAT against the inflated rect), the whole arc clears them.
// The depth cap only ever reports a false hit, never a false clearance, so a bridge is drawn
// only when its clearance is proven. Pure geometry, shared by the planner and its tests.

import type { Point, Rect } from "./graph-edge-geometry";

/** Clearance a bridge keeps from every card border (the orthogonal router's clearance). */
export const BRIDGE_CLEARANCE = 3;

/** Subdivision depth of the clearance proof; beyond it the test conservatively reports a hit. */
const MAX_CLEARANCE_DEPTH = 12;

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** SAT: a triangle misses an inflated rect iff some axis separates their projections. */
function triangleHitsRect(tri: readonly Point[], rect: Rect, clearance: number): boolean {
  const left = rect.center.x - rect.width / 2 - clearance;
  const right = rect.center.x + rect.width / 2 + clearance;
  const top = rect.center.y - rect.height / 2 - clearance;
  const bottom = rect.center.y + rect.height / 2 + clearance;
  // Bounding-box reject first: most small triangles sit far from most cards, and the full
  // SAT below is only worth running when the boxes overlap (drag-time planner budget).
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of tri) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  if (maxX <= left || right <= minX || maxY <= top || bottom <= minY) return false;
  const corners: readonly Point[] = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
  const axes: Point[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  for (let i = 0; i < tri.length; i += 1) {
    const a = tri[i];
    const b = tri[(i + 1) % tri.length];
    axes.push({ x: -(b.y - a.y), y: b.x - a.x });
  }
  for (const axis of axes) {
    let minTri = Number.POSITIVE_INFINITY;
    let maxTri = Number.NEGATIVE_INFINITY;
    let minRect = Number.POSITIVE_INFINITY;
    let maxRect = Number.NEGATIVE_INFINITY;
    for (const point of tri) {
      const value = point.x * axis.x + point.y * axis.y;
      minTri = Math.min(minTri, value);
      maxTri = Math.max(maxTri, value);
    }
    for (const point of corners) {
      const value = point.x * axis.x + point.y * axis.y;
      minRect = Math.min(minRect, value);
      maxRect = Math.max(maxRect, value);
    }
    // Touching the inflated border is not a hit, matching the router's strict overlap.
    if (maxTri <= minRect || maxRect <= minTri) return false;
  }
  return true;
}

/**
 * True when the whole arc keeps `clearance` from every card. The walk splits any triangle
 * that still hits a card; a piece that cannot be proven clear within the depth cap fails the
 * whole test, so the planner lifts the apex or keeps the orthogonal route instead.
 */
export function bridgeClearsCards(
  source: Point,
  control: Point,
  target: Point,
  obstacles: readonly Rect[],
  clearance = BRIDGE_CLEARANCE,
): boolean {
  const walk = (a: Point, b: Point, c: Point, depth: number): boolean => {
    if (!obstacles.some((rect) => triangleHitsRect([a, b, c], rect, clearance))) return true;
    if (depth >= MAX_CLEARANCE_DEPTH) return false;
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const abc = midpoint(ab, bc);
    return walk(a, ab, abc, depth + 1) && walk(abc, bc, c, depth + 1);
  };
  return walk(source, control, target, 0);
}
