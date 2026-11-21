// Pure geometry for the project-graph edges: the cubic path between two anchors (the satellite
// connector and the unmeasured-card fallback), the draggable midpoint, and a self-loop. Port
// anchoring lives in graph-ports.ts and orthogonal routing in graph-edge-routing.ts (issue #61);
// orthogonalGeometry shapes a routed polyline with the same handle contract. No React and no DOM
// here, so every shape is unit-tested directly.

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A node card in flow coordinates: its centre plus its size. */
export interface Rect {
  readonly center: Point;
  readonly width: number;
  readonly height: number;
}

export interface EdgeAnchors {
  readonly source: Point;
  readonly target: Point;
}

export interface EdgeGeometry {
  /** SVG path for the edge. */
  readonly path: string;
  /** Where the curve handle is drawn; a `curve` moves it by exactly that offset. */
  readonly midpoint: Point;
}

/** Clearance (flow px) between a node border and its endpoint, so the arrow does not overlap. */
export const EDGE_ENDPOINT_GAP = 6;

/** How far (flow px) a self-loop bulges out of its node. */
export const SELF_LOOP_RADIUS = 28;

/** Cubic control points sit this fraction of the anchor distance away from their anchor. */
const CONTROL_RATIO = 0.35;

/** Below this anchor distance the controls would collapse onto the anchors. */
const MIN_CONTROL_REACH = 20;

/** Both controls move by `curve * 4/3`, so the cubic midpoint moves by exactly `curve`. */
const CURVE_CONTROL_FACTOR = 4 / 3;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatPoint(point: Point): string {
  return `${round(point.x)} ${round(point.y)}`;
}

function curveControlOffset(curve: Point | null): Point {
  return {
    x: (curve?.x ?? 0) * CURVE_CONTROL_FACTOR,
    y: (curve?.y ?? 0) * CURVE_CONTROL_FACTOR,
  };
}

function cubicGeometry(
  source: Point,
  control1: Point,
  control2: Point,
  target: Point,
): EdgeGeometry {
  const path =
    `M ${formatPoint(source)} C ${formatPoint(control1)} ` +
    `${formatPoint(control2)} ${formatPoint(target)}`;
  return {
    path,
    midpoint: {
      x: (source.x + 3 * control1.x + 3 * control2.x + target.x) / 8,
      y: (source.y + 3 * control1.y + 3 * control2.y + target.y) / 8,
    },
  };
}

/** The card rect for a node at `position` with the given size. */
export function nodeRect(position: Point, width: number, height: number): Rect {
  return {
    center: { x: position.x + width / 2, y: position.y + height / 2 },
    width,
    height,
  };
}

/** Where the ray from the rect centre towards `towards` crosses the border, pushed out by `gap`. */
export function borderPoint(rect: Rect, towards: Point, gap = 0): Point {
  const dx = towards.x - rect.center.x;
  const dy = towards.y - rect.center.y;
  if (dx === 0 && dy === 0) {
    return { x: rect.center.x + rect.width / 2 + gap, y: rect.center.y };
  }
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : rect.width / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : rect.height / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  const length = Math.hypot(dx, dy);
  return {
    x: rect.center.x + dx * scale + (dx / length) * gap,
    y: rect.center.y + dy * scale + (dy / length) * gap,
  };
}

/** Floating endpoints: each card is hit where the line joining the two centres crosses it. */
export function floatingAnchors(source: Rect, target: Rect, gap = EDGE_ENDPOINT_GAP): EdgeAnchors {
  return {
    source: borderPoint(source, target.center, gap),
    target: borderPoint(target, source.center, gap),
  };
}

/** Cubic edge between two anchors; `curve` bends the midpoint by exactly that offset. */
export function edgeGeometry(anchors: EdgeAnchors, curve: Point | null = null): EdgeGeometry {
  const { source, target } = anchors;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  const unit: Point = length === 0 ? { x: 1, y: 0 } : { x: dx / length, y: dy / length };
  const reach = Math.max(MIN_CONTROL_REACH, length * CONTROL_RATIO);
  const bend = curveControlOffset(curve);
  const control1 = {
    x: source.x + unit.x * reach + bend.x,
    y: source.y + unit.y * reach + bend.y,
  };
  const control2 = {
    x: target.x - unit.x * reach + bend.x,
    y: target.y - unit.y * reach + bend.y,
  };
  return cubicGeometry(source, control1, control2, target);
}

/** A self-loop leaving and re-entering the card's right border with a right-hand bulge. */
export function selfLoopGeometry(rect: Rect, curve: Point | null = null): EdgeGeometry {
  const right = rect.center.x + rect.width / 2 + EDGE_ENDPOINT_GAP;
  const half = SELF_LOOP_RADIUS / 2;
  const source = { x: right, y: rect.center.y - half };
  const target = { x: right, y: rect.center.y + half };
  const bend = curveControlOffset(curve);
  const control1 = {
    x: right + SELF_LOOP_RADIUS * 2 + bend.x,
    y: source.y - SELF_LOOP_RADIUS + bend.y,
  };
  const control2 = {
    x: right + SELF_LOOP_RADIUS * 2 + bend.x,
    y: target.y + SELF_LOOP_RADIUS + bend.y,
  };
  return cubicGeometry(source, control1, control2, target);
}

/** The handle's rest position: the middle segment's centre, or the middle vertex of an L. */
function orthogonalMidpoint(points: readonly Point[]): Point {
  const segments = points.length - 1;
  if (segments % 2 === 1) {
    const index = (segments - 1) / 2;
    return {
      x: (points[index].x + points[index + 1].x) / 2,
      y: (points[index].y + points[index + 1].y) / 2,
    };
  }
  return points[segments / 2];
}

function move(point: Point, offset: Point): Point {
  return { x: point.x + offset.x, y: point.y + offset.y };
}

/**
 * Bend an orthogonal path by the curve, staying orthogonal: the middle segment moves by the
 * perpendicular component, the parallel one slides the handle along it. A straight line grows
 * a middle segment, an L one more bend. The handle still sits at base + curve (issue #61).
 */
function bendOrthogonal(points: readonly Point[], curve: Point): Point[] {
  const segments = points.length - 1;
  if (segments === 1) {
    const a = points[0];
    const b = points[1];
    if (a.y === b.y) {
      const lane = a.y + curve.y;
      return [a, { x: a.x, y: lane }, { x: b.x, y: lane }, b];
    }
    const lane = a.x + curve.x;
    return [a, { x: lane, y: a.y }, { x: lane, y: b.y }, b];
  }
  if (segments === 2) {
    const [a, vertex, b] = points;
    const laneX = vertex.x + curve.x;
    const laneY = vertex.y + curve.y;
    if (a.y === vertex.y) {
      return [a, { x: a.x, y: laneY }, { x: laneX, y: laneY }, { x: laneX, y: b.y }, b];
    }
    return [a, { x: laneX, y: a.y }, { x: laneX, y: laneY }, { x: b.x, y: laneY }, b];
  }
  const next = [...points];
  if (segments % 2 === 1) {
    const index = (segments - 1) / 2;
    const vertical = points[index].x === points[index + 1].x;
    const offset = vertical ? { x: curve.x, y: 0 } : { x: 0, y: curve.y };
    next[index] = move(points[index], offset);
    next[index + 1] = move(points[index + 1], offset);
  } else {
    const index = segments / 2;
    const incomingHorizontal = points[index].y === points[index - 1].y;
    const offset = incomingHorizontal ? { x: curve.x, y: 0 } : { x: 0, y: curve.y };
    next[index] = move(points[index], offset);
  }
  return next;
}

/** Shape a routed polyline into an SVG path plus its draggable midpoint. */
export function orthogonalGeometry(points: readonly Point[], curve: Point | null): EdgeGeometry {
  const midpoint = orthogonalMidpoint(points);
  const drawn = curve === null ? points : bendOrthogonal(points, curve);
  const path = drawn
    .map((point, index) => (index === 0 ? "M " : "L ") + formatPoint(point))
    .join(" ");
  return {
    path,
    midpoint: curve === null ? midpoint : { x: midpoint.x + curve.x, y: midpoint.y + curve.y },
  };
}

