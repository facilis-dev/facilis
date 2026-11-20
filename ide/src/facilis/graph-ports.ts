// Named ports on a project-graph card (issue #61): top/bottom carry the flow direction
// (FK and view-base chains run down a sub-column), left/right carry the cross-links between
// layers. Edges anchor to the nearest port pair instead of the border midpoint, so a wrapped
// layer's short neighbour edges leave sideways while dependency edges leave vertically.

import { EDGE_ENDPOINT_GAP, type Point, type Rect } from "./graph-edge-geometry";

/** Port order is the deterministic tie-break when two pairs are equally near. */
export const GRAPH_PORTS = ["top", "bottom", "left", "right"] as const;

export type GraphPort = (typeof GRAPH_PORTS)[number];

export interface PortAnchors {
  readonly source: Point;
  readonly target: Point;
  readonly sourcePort: GraphPort;
  readonly targetPort: GraphPort;
}

/** The point where an edge leaves/enters the card at this port, pushed out by `gap`. */
export function portPoint(rect: Rect, port: GraphPort, gap = 0): Point {
  const { center, width, height } = rect;
  switch (port) {
    case "top":
      return { x: center.x, y: center.y - height / 2 - gap };
    case "bottom":
      return { x: center.x, y: center.y + height / 2 + gap };
    case "left":
      return { x: center.x - width / 2 - gap, y: center.y };
    case "right":
      return { x: center.x + width / 2 + gap, y: center.y };
  }
}

/** Outward unit vector of a port: the direction its stub leaves the card. */
export function portDirection(port: GraphPort): Point {
  switch (port) {
    case "top":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: 0, y: 1 };
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
  }
}

/**
 * All 16 port pairs, nearest first (ties keep GRAPH_PORTS order). The router walks this list
 * until a pair routes cleanly, so an edge takes the nearest port that actually works.
 */
export function portAnchorsRanked(
  source: Rect,
  target: Rect,
  gap = EDGE_ENDPOINT_GAP,
): PortAnchors[] {
  const ranked: { anchors: PortAnchors; distance: number }[] = [];
  for (const sourcePort of GRAPH_PORTS) {
    const from = portPoint(source, sourcePort, gap);
    for (const targetPort of GRAPH_PORTS) {
      const to = portPoint(target, targetPort, gap);
      const distance = (from.x - to.x) ** 2 + (from.y - to.y) ** 2;
      ranked.push({ anchors: { source: from, target: to, sourcePort, targetPort }, distance });
    }
  }
  ranked.sort((a, b) => a.distance - b.distance);
  return ranked.map((entry) => entry.anchors);
}

/** The nearest of the 16 port pairs: right -> left across layers, bottom -> top down a chain. */
export function nearestPortAnchors(
  source: Rect,
  target: Rect,
  gap = EDGE_ENDPOINT_GAP,
): PortAnchors {
  const firstFrom = portPoint(source, "top", gap);
  const firstTo = portPoint(target, "top", gap);
  let best: PortAnchors = {
    source: firstFrom,
    target: firstTo,
    sourcePort: "top",
    targetPort: "top",
  };
  let bestDistance = (firstFrom.x - firstTo.x) ** 2 + (firstFrom.y - firstTo.y) ** 2;
  for (const sourcePort of GRAPH_PORTS) {
    const from = portPoint(source, sourcePort, gap);
    for (const targetPort of GRAPH_PORTS) {
      const to = portPoint(target, targetPort, gap);
      const distance = (from.x - to.x) ** 2 + (from.y - to.y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { source: from, target: to, sourcePort, targetPort };
      }
    }
  }
  return best;
}
