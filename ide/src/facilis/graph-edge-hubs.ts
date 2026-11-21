// The edge-concentration overlay (issue #64): a pure RENDER-TIME derivation over the view's
// real edges. A fan-out of more than `threshold` distinct routes to one table/view collapses
// into a hub chip (id hub:<kind>:<target>): the routes point at the hub, the hub points at the
// target with ONE thick count edge. Hubs are view artefacts — ProjectGraphView, the stats, the
// saved layout, the URL state and the AI scene never see them; only the threshold is URL state.
// Expanding a hub is session-scoped: its real edges return (with their labels) while the chip
// stays as the collapse control. Below the threshold, groups share a trunk (graph-edge-bundles).

import { deriveEdgeBundles, viewObstacleRects } from "./graph-edge-bundles";
import { nodeRect, type Point, type Rect } from "./graph-edge-geometry";
import { GRAPH_NODE_SIZES } from "./graph-node-size";
import type { ProjectGraphEdge, ProjectGraphView } from "./graph-types";
import type { GraphEdgeConcentration } from "./graph-view-state";

/** The chip's flow size; the node card matches it so routing and drawing agree. */
export const HUB_SIZE = { width: 56, height: 28 } as const;

/** Clearance the chip keeps from every card when choosing its corridor slot. */
const HUB_CLEARANCE = 6;

export type HubEdgeKind = "route-table" | "route-view";

export interface GraphEdgeHub {
  readonly id: string;
  readonly kind: HubEdgeKind;
  readonly target: string;
  /** Distinct source route ids, sorted: the chip's count and the satellite's route list. */
  readonly sources: readonly string[];
  /** The real edges this hub stands for; expansion restores exactly these. */
  readonly edges: readonly ProjectGraphEdge[];
  readonly count: number;
  /** Top-left flow position of the chip; real node positions are never touched. */
  readonly position: Point;
  /** Session-scoped expansion: the real edges are drawn, the chip is the collapse control. */
  readonly expanded: boolean;
}

/** What the canvas draws instead of the raw edge list. */
export type GraphRenderEdge =
  | { readonly type: "real"; readonly edge: ProjectGraphEdge; readonly showLabel: boolean }
  | { readonly type: "hub-source"; readonly edge: ProjectGraphEdge; readonly hubId: string }
  | {
      readonly type: "hub-target";
      readonly id: string;
      readonly hubId: string;
      readonly kind: HubEdgeKind;
      readonly target: string;
      readonly count: number;
    };

export interface GraphHubOverlay {
  readonly hubs: readonly GraphEdgeHub[];
  readonly edges: readonly GraphRenderEdge[];
  /** Real edges currently replaced by hub geometry (empty for expanded hubs). */
  readonly concentratedEdgeIds: ReadonlySet<string>;
  /** Shared-trunk lanes for the below-threshold groups (issue #64, step 2). */
  readonly bundleLanes: ReadonlyMap<string, number>;
}

export function hubIdFor(kind: HubEdgeKind, target: string): string {
  return `hub:${kind}:${target}`;
}

export function hubEdgeIdFor(kind: HubEdgeKind, target: string): string {
  return `hub-edge:${kind}:${target}`;
}

/** Hub artefact ids must never reach selection, curves or the saved layout. */
export function isHubArtefactId(id: string): boolean {
  return id.startsWith("hub:") || id.startsWith("hub-edge:");
}

/** Session-scoped expand/collapse: a pure set toggle, unit-tested without React. */
export function toggleExpandedHub(
  expanded: ReadonlySet<string>,
  hubId: string,
): ReadonlySet<string> {
  const next = new Set(expanded);
  if (next.has(hubId)) next.delete(hubId);
  else next.add(hubId);
  return next;
}

interface HubGroup {
  readonly kind: HubEdgeKind;
  readonly target: string;
  readonly edges: readonly ProjectGraphEdge[];
  readonly sources: readonly string[];
}

/** Group the concentratable edges by (edge kind, target); deterministic order by key. */
function hubGroups(view: ProjectGraphView): HubGroup[] {
  const kindById = new Map(view.nodes.map((node) => [node.id, node.kind]));
  const groups = new Map<string, { kind: HubEdgeKind; target: string; edges: ProjectGraphEdge[] }>();
  for (const edge of view.edges) {
    if (edge.kind !== "route-table" && edge.kind !== "route-view") continue;
    if (kindById.get(edge.source) !== "route") continue;
    const targetKind = kindById.get(edge.target);
    if (targetKind !== "table" && targetKind !== "view") continue;
    const key = edge.kind + "\u0000" + edge.target;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { kind: edge.kind, target: edge.target, edges: [edge] });
    else group.edges.push(edge);
  }
  return [...groups.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => ({
      ...group,
      sources: [...new Set(group.edges.map((edge) => edge.source))].toSorted(),
    }));
}

function rectsOverlap(a: Rect, b: Rect, clearance: number): boolean {
  return (
    Math.abs(a.center.x - b.center.x) < (a.width + b.width) / 2 + clearance &&
    Math.abs(a.center.y - b.center.y) < (a.height + b.height) / 2 + clearance
  );
}

/**
 * Deterministic hub placement in the corridor between the sources' column and the target's
 * left port: the corridor midpoint at the sources' mean height, falling back to the target's
 * own height and then just above/below the target when a card occupies the slot. Real node
 * positions are inputs only — concentration never moves a card.
 */
export function placeHub(
  sourceRects: readonly Rect[],
  targetRect: Rect,
  obstacles: readonly Rect[],
): Point {
  const first = sourceRects[0];
  if (first === undefined) return { x: targetRect.center.x, y: targetRect.center.y };
  const sourceRight = Math.max(...sourceRects.map((rect) => rect.center.x + rect.width / 2));
  const targetLeft = targetRect.center.x - targetRect.width / 2;
  const x = (sourceRight + targetLeft) / 2;
  const meanY = sourceRects.reduce((sum, rect) => sum + rect.center.y, 0) / sourceRects.length;
  const half = HUB_SIZE.height / 2;
  const candidates = [
    meanY,
    targetRect.center.y,
    targetRect.center.y - targetRect.height / 2 - half - HUB_CLEARANCE,
    targetRect.center.y + targetRect.height / 2 + half + HUB_CLEARANCE,
  ];
  const free = candidates.find((y) => {
    const rect: Rect = { center: { x, y }, width: HUB_SIZE.width, height: HUB_SIZE.height };
    return !obstacles.some((obstacle) => rectsOverlap(rect, obstacle, HUB_CLEARANCE));
  });
  const y = free ?? meanY;
  return { x: x - HUB_SIZE.width / 2, y: y - HUB_SIZE.height / 2 };
}

/** Derive the render overlay; the view itself is never mutated. */
export function deriveEdgeHubOverlay(
  view: ProjectGraphView,
  threshold: GraphEdgeConcentration,
  expanded: ReadonlySet<string>,
): GraphHubOverlay {
  const bundleLanes = deriveEdgeBundles(view, threshold);
  const real = view.edges.map((edge) => ({ type: "real" as const, edge, showLabel: false }));
  if (threshold === "off") {
    return { hubs: [], edges: real, concentratedEdgeIds: new Set(), bundleLanes };
  }
  const nodeById = new Map(view.nodes.map((node) => [node.id, node]));
  const cardRects = viewObstacleRects(view);
  const hubs: GraphEdgeHub[] = [];
  const concentratedEdgeIds = new Set<string>();
  const expandedEdgeIds = new Set<string>();
  const placed: Rect[] = [];
  for (const group of hubGroups(view)) {
    if (group.sources.length <= threshold) continue;
    const id = hubIdFor(group.kind, group.target);
    const isExpanded = expanded.has(id);
    const targetNode = nodeById.get(group.target);
    if (targetNode === undefined) continue;
    const targetSize = GRAPH_NODE_SIZES[targetNode.kind];
    const targetRect = nodeRect(targetNode.position, targetSize.width, targetSize.height);
    const sourceRects = group.sources
      .map((sourceId) => nodeById.get(sourceId))
      .filter((node): node is NonNullable<typeof node> => node !== undefined)
      .map((node) => {
        const size = GRAPH_NODE_SIZES[node.kind];
        return nodeRect(node.position, size.width, size.height);
      });
    const position = placeHub(sourceRects, targetRect, [...cardRects, ...placed]);
    placed.push({
      center: { x: position.x + HUB_SIZE.width / 2, y: position.y + HUB_SIZE.height / 2 },
      width: HUB_SIZE.width,
      height: HUB_SIZE.height,
    });
    hubs.push({
      id,
      kind: group.kind,
      target: group.target,
      sources: group.sources,
      edges: group.edges,
      count: group.sources.length,
      position,
      expanded: isExpanded,
    });
    for (const edge of group.edges) {
      if (isExpanded) expandedEdgeIds.add(edge.id);
      else concentratedEdgeIds.add(edge.id);
    }
  }
  const hubIdByEdgeId = new Map<string, string>();
  for (const hub of hubs) {
    if (hub.expanded) continue;
    for (const edge of hub.edges) hubIdByEdgeId.set(edge.id, hub.id);
  }
  const edges: GraphRenderEdge[] = view.edges.map((edge) => {
    const hubId = hubIdByEdgeId.get(edge.id);
    if (hubId !== undefined) return { type: "hub-source", edge, hubId };
    return { type: "real", edge, showLabel: expandedEdgeIds.has(edge.id) };
  });
  for (const hub of hubs) {
    if (hub.expanded) continue;
    edges.push({
      type: "hub-target",
      id: hubEdgeIdFor(hub.kind, hub.target),
      hubId: hub.id,
      kind: hub.kind,
      target: hub.target,
      count: hub.count,
    });
  }
  return { hubs, edges, concentratedEdgeIds, bundleLanes };
}

export interface HubIsolation {
  readonly nodeIds: ReadonlySet<string>;
  readonly edgeIds: ReadonlySet<string>;
}

/** Hover isolation: the hub, its routes and its target stay bright, everything else recedes. */
export function hubIsolation(overlay: GraphHubOverlay, hubId: string | null): HubIsolation | null {
  if (hubId === null) return null;
  const hub = overlay.hubs.find((entry) => entry.id === hubId);
  if (hub === undefined) return null;
  return {
    nodeIds: new Set([hub.id, hub.target, ...hub.sources]),
    edgeIds: new Set([hubEdgeIdFor(hub.kind, hub.target), ...hub.edges.map((edge) => edge.id)]),
  };
}
