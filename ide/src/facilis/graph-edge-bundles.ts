// Shared-trunk bundling for small route fan-outs (issue #64, step 2): edges from the same
// source layer to the same target draw one common vertical trunk in the corridor between the
// two columns, splitting only at the source ends. Conservative by construction: a lane is used
// only when EVERY member's forced trunk path is collision-free against the card rects, so the
// orthogonal router's "no segment under a card" invariant holds for bundles too; a group whose
// corridor admits no clean lane keeps the normal per-edge router. Groups above the concentration
// threshold become hubs instead (graph-edge-hubs.ts); "off" disables both.

import {
  EDGE_ENDPOINT_GAP,
  nodeRect,
  orthogonalGeometry,
  type EdgeGeometry,
  type Point,
  type Rect,
} from "./graph-edge-geometry";
import { countCardCollisions } from "./graph-edge-routing";
import { GRAPH_NODE_SIZES } from "./graph-node-size";
import { portPoint } from "./graph-ports";
import type { ProjectGraphEdge, ProjectGraphView } from "./graph-types";
import type { GraphEdgeConcentration } from "./graph-view-state";

/** A trunk lane keeps the router's lane clearance from every card border. */
const LANE_MARGIN = 5;

/** The forced trunk polyline: right port -> shared lane -> target left port (two bends). */
export function bundleTrunkPoints(source: Rect, target: Rect, laneX: number): Point[] {
  const from = portPoint(source, "right", EDGE_ENDPOINT_GAP);
  const to = portPoint(target, "left", EDGE_ENDPOINT_GAP);
  return [from, { x: laneX, y: from.y }, { x: laneX, y: to.y }, to];
}

/**
 * Trunk geometry when the lane is clean against the (measured) cards; null makes the caller
 * fall back to the normal router. The pure derivation checks fallback sizes, this re-checks
 * the live ones, so a taller-than-expected card can never end up under a drawn trunk.
 */
export function resolveTrunkGeometry(
  source: Rect,
  target: Rect,
  laneX: number,
  curve: Point | null,
  obstacles: readonly Rect[],
): EdgeGeometry | null {
  const points = bundleTrunkPoints(source, target, laneX);
  if (countCardCollisions(points, obstacles) > 0) return null;
  return orthogonalGeometry(points, curve);
}

/**
 * The view's fallback obstacles: every card at its GRAPH_NODE_SIZES footprint plus the
 * collapsed cluster super-nodes (issue #62). Expanded frames are containers, not obstacles —
 * the live router (project-graph-edge-rects.ts) applies the same rule to measured nodes.
 */
export function viewObstacleRects(view: ProjectGraphView): Rect[] {
  const rects = view.nodes.map((node) => {
    const size = GRAPH_NODE_SIZES[node.kind];
    return nodeRect(node.position, size.width, size.height);
  });
  for (const cluster of view.clusters) {
    if (!cluster.collapsed) continue;
    rects.push(nodeRect(cluster.position, cluster.size.width, cluster.size.height));
  }
  return rects;
}

/** Candidate lanes: the corridor midpoint first, then card border lanes nearest the middle. */
function laneCandidates(
  laneMin: number,
  laneMax: number,
  obstacles: readonly Rect[],
): number[] {
  const mid = (laneMin + laneMax) / 2;
  const border: number[] = [];
  for (const rect of obstacles) {
    const left = rect.center.x - rect.width / 2 - LANE_MARGIN;
    const right = rect.center.x + rect.width / 2 + LANE_MARGIN;
    if (left > laneMin && left < laneMax) border.push(left);
    if (right > laneMin && right < laneMax) border.push(right);
  }
  const unique = [...new Set(border.map((value) => Math.round(value * 100) / 100))];
  unique.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
  return [mid, ...unique];
}

/**
 * edge id -> shared trunk lane for every below-threshold fan-out group (at least two edges
 * sharing a source layer and target). A group is skipped when its corridor is degenerate or
 * no lane keeps all members collision-free: those edges keep the normal router.
 */
export function deriveEdgeBundles(
  view: ProjectGraphView,
  threshold: GraphEdgeConcentration,
): ReadonlyMap<string, number> {
  const lanes = new Map<string, number>();
  if (threshold === "off") return lanes;
  const rects = new Map<string, Rect>();
  for (const node of view.nodes) {
    const size = GRAPH_NODE_SIZES[node.kind];
    rects.set(node.id, nodeRect(node.position, size.width, size.height));
  }
  const kindById = new Map(view.nodes.map((node) => [node.id, node.kind]));
  const groups = new Map<string, ProjectGraphEdge[]>();
  for (const edge of view.edges) {
    if (edge.kind !== "route-table" && edge.kind !== "route-view") continue;
    if (kindById.get(edge.source) !== "route") continue;
    const targetKind = kindById.get(edge.target);
    if (targetKind !== "table" && targetKind !== "view") continue;
    // The source layer is the source node kind; routes share one layer, so the key is
    // effectively per target — exactly the fan the issue describes.
    const key = "route\u0000" + edge.target;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [edge]);
    else group.push(edge);
  }
  const obstacles = viewObstacleRects(view);
  for (const edges of groups.values()) {
    if (edges.length < 2) continue;
    const distinct = new Set(edges.map((edge) => edge.source)).size;
    // Above the threshold the group is hub territory — expanded or not, its edges stay individual.
    if (distinct > threshold) continue;
    const first = edges[0];
    if (first === undefined) continue;
    const targetRect = rects.get(first.target);
    if (targetRect === undefined) continue;
    const sourceRects = edges.map((edge) => rects.get(edge.source));
    if (sourceRects.some((rect) => rect === undefined)) continue;
    const sources = sourceRects.filter((rect): rect is Rect => rect !== undefined);
    const laneMin =
      Math.max(...sources.map((rect) => rect.center.x + rect.width / 2 + EDGE_ENDPOINT_GAP)) +
      LANE_MARGIN;
    const laneMax = targetRect.center.x - targetRect.width / 2 - EDGE_ENDPOINT_GAP - LANE_MARGIN;
    if (laneMax <= laneMin) continue;
    for (const laneX of laneCandidates(laneMin, laneMax, obstacles)) {
      const clean = edges.every((_edge, index) => {
        const sourceRect = sources[index];
        if (sourceRect === undefined) return false;
        return countCardCollisions(bundleTrunkPoints(sourceRect, targetRect, laneX), obstacles) === 0;
      });
      if (clean) {
        for (const edge of edges) lanes.set(edge.id, laneX);
        break;
      }
    }
  }
  return lanes;
}
