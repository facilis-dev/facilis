// Feature clusters (issue #62, epic #56): the deterministic derivation of node groups from the
// analysis, and the boundary-edge aggregation a collapse applies. Pure — no React, no IO — so
// the grouping rules are unit-testable and a reload rebuilds the identical clusters.
//
// Derivation order (D-202): routes group by an explicit Nitro route group — a "(name)" directory
// segment the URL router strips, so the source path is the only fact that carries it — else the
// directory above the route file inside routes/ (the feature directory, e.g. api/todos), else the
// first URL path segment, else the source folder. Tables and views group by their schema prefix
// (the part before the first underscore) else their source folder. Pages join the cluster of the
// routes they call (the dominant page-route target, ties lexicographic). Workflows group by source
// folder. Whatever no rule groups lands in the visible "other" cluster — never a silent guess.
//
// Clustering is a layout MODE, not a lens (F.4): it re-lays AUTO positions into cluster frames,
// like reset-layout may; saved positions stay absolute overrides and lenses never move nodes.

import type { GraphNodeKind } from "@facilis.dev/analyze";
import type { GraphGroupBy, GraphViewState } from "./graph-view-state";
import type { GraphCluster, GraphClusterInput, ProjectGraphEdge } from "./graph-types";

export const GRAPH_CLUSTER_PREFIX = "cluster:";
export const OTHER_CLUSTER_KEY = "other";
/** Above this node count the group-by mode defaults to on (issue #62: "more than ~40 nodes"). */
export const GRAPH_CLUSTER_AUTO_THRESHOLD = 40;

/** The effective mode state: an explicit choice wins, "auto" follows the node count. */
export function isClusterGroupingEnabled(groupBy: GraphGroupBy, nodeCount: number): boolean {
  return groupBy === "on" || (groupBy === "auto" && nodeCount > GRAPH_CLUSTER_AUTO_THRESHOLD);
}

/** The model input for one view build: the URL choices plus the auto threshold (F.4). */
export function clusterInputFor(state: GraphViewState, nodeCount: number): GraphClusterInput {
  return {
    enabled: isClusterGroupingEnabled(state.groupBy, nodeCount),
    collapsed: state.collapsedClusters,
    forceExpanded: state.drill === null ? [] : [state.drill],
  };
}

// The analyzer's two route roots (passes/routes.ts); a route file elsewhere falls through to
// the path-segment and source-folder rules.
const ROUTE_DIRS = ["server/routes/", "server/api/"];

/** The basename of a project-relative file's parent directory, or null when there is none. */
export function folderOf(sourceFile: string | null): string | null {
  if (sourceFile === null) return null;
  const slash = sourceFile.lastIndexOf("/");
  if (slash <= 0) return null;
  const parent = sourceFile.slice(0, slash);
  const base = parent.slice(parent.lastIndexOf("/") + 1);
  return base === "" ? null : base;
}

function firstPathSegment(path: string): string | null {
  const segment = path.split("/").find((part) => part !== "");
  return segment === undefined ? null : segment;
}

/**
 * The facts the derivation reads. Both the analyzer's GraphNode and the view's ProjectGraphNode
 * satisfy it structurally, so the grouping is testable on raw analyzer fixtures.
 */
export interface ClusterNodeFact {
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly sourceFile: string | null;
  readonly data:
    | { readonly kind: "page" }
    | { readonly kind: "route"; readonly path: string }
    | { readonly kind: "table"; readonly table: string }
    | { readonly kind: "view"; readonly view: string }
    | { readonly kind: "workflow" };
}

function routeKey(node: ClusterNodeFact): string | null {
  const source = node.sourceFile;
  if (source !== null) {
    const dir = ROUTE_DIRS.find((candidate) => source.startsWith(candidate));
    if (dir !== undefined) {
      const segments = source.slice(dir.length).split("/");
      const group = segments.find((part) => /^\([^()]+\)$/.test(part));
      if (group !== undefined) return group.slice(1, -1);
      const parent = segments.slice(0, -1).join("/");
      if (parent !== "") return parent;
    }
  }
  if (node.data.kind === "route") {
    const segment = firstPathSegment(node.data.path);
    if (segment !== null) return segment;
  }
  return folderOf(source);
}

/** Schema prefix first (todo_files -> todo), then the declaring folder (db/schema.ts -> db). */
function schemaKey(name: string, sourceFile: string | null): string | null {
  const underscore = name.indexOf("_");
  if (underscore > 0) return name.slice(0, underscore);
  return folderOf(sourceFile);
}

function nodeKey(node: ClusterNodeFact): string | null {
  switch (node.data.kind) {
    case "route":
      return routeKey(node);
    case "table":
      return schemaKey(node.data.table, node.sourceFile);
    case "view":
      return schemaKey(node.data.view, node.sourceFile);
    case "workflow":
      return folderOf(node.sourceFile);
    case "page":
      return null; // resolved in a second pass, once the route keys exist
  }
}

/**
 * A page joins the cluster of the routes it calls: the most page-route edges wins, ties break
 * lexicographically so the same analysis always groups the same way. A page that calls nothing
 * grouped falls into "other" with the rest of the ungrouped nodes.
 */
function pageKey(
  node: ClusterNodeFact,
  edges: readonly ProjectGraphEdge[],
  keys: ReadonlyMap<string, string>,
): string | null {
  const tally = new Map<string, number>();
  for (const edge of edges) {
    if (edge.kind !== "page-route" || edge.source !== node.id) continue;
    const key = keys.get(edge.target);
    if (key === undefined) continue;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [key, count] of [...tally.entries()].toSorted((a, b) => a[0].localeCompare(b[0]))) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

function emptyCounts(): Record<GraphNodeKind, number> {
  return { page: 0, route: 0, table: 0, view: 0, workflow: 0 };
}

/**
 * Derive the clusters of one visible node/edge set. Deterministic: clusters sort by key with
 * "other" last, members sort by id. Geometry fields are zero placeholders —
 * graph-cluster-layout.ts fills them; collapsed/matched are the view's business, not the
 * derivation's. Every node lands in exactly one cluster (a partition, never an overlap).
 */
export function deriveClusters(
  nodes: readonly ClusterNodeFact[],
  edges: readonly ProjectGraphEdge[],
): GraphCluster[] {
  const keys = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind === "page") continue;
    keys.set(node.id, nodeKey(node) ?? OTHER_CLUSTER_KEY);
  }
  for (const node of nodes) {
    if (node.kind !== "page") continue;
    keys.set(node.id, pageKey(node, edges, keys) ?? OTHER_CLUSTER_KEY);
  }
  const members = new Map<string, string[]>();
  for (const node of nodes) {
    const key = keys.get(node.id) ?? OTHER_CLUSTER_KEY;
    const list = members.get(key) ?? [];
    list.push(node.id);
    members.set(key, list);
  }
  const crossing = new Map<string, number>();
  for (const edge of edges) {
    const from = keys.get(edge.source);
    const to = keys.get(edge.target);
    if (from === undefined || to === undefined || from === to) continue;
    crossing.set(from, (crossing.get(from) ?? 0) + 1);
    crossing.set(to, (crossing.get(to) ?? 0) + 1);
  }
  const ordered = [...members.keys()].toSorted((a, b) =>
    a === OTHER_CLUSTER_KEY ? 1 : b === OTHER_CLUSTER_KEY ? -1 : a.localeCompare(b),
  );
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return ordered.map((key) => {
    // Sorted members make the derivation independent of the analysis' node order.
    const nodeIds = [...(members.get(key) ?? [])].toSorted();
    const counts = emptyCounts();
    for (const id of nodeIds) {
      const node = byId.get(id);
      if (node !== undefined) counts[node.kind] += 1;
    }
    return {
      id: GRAPH_CLUSTER_PREFIX + key,
      key,
      label: key,
      nodeIds,
      counts,
      crossingEdges: crossing.get(key) ?? 0,
      // A lone "other" cluster is the whole graph: collapsing it would empty the canvas.
      collapsible: !(ordered.length === 1 && key === OTHER_CLUSTER_KEY),
      collapsed: false,
      matched: true,
      position: { x: 0, y: 0 },
      size: { width: 0, height: 0 },
    };
  });
}

/** nodeId -> clusterId, the lookup the collapse and the canvas drag conversion share. */
export function clusterOfNodes(clusters: readonly GraphCluster[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const cluster of clusters) {
    for (const id of cluster.nodeIds) lookup.set(id, cluster.id);
  }
  return lookup;
}

/**
 * Apply a collapse set to the visible edges: children of collapsed clusters hide, internal
 * edges drop, and boundary crossings re-anchor to the cluster border. Parallel crossings of
 * the same kind between the same endpoints aggregate into one edge carrying their count, so
 * N crossings read as a number instead of N overlapping lines. The kept id is the smallest
 * original id, so a saved curve still applies to the bundle it belonged to.
 */
export function collapseClusterEdges(
  edges: readonly ProjectGraphEdge[],
  clusters: readonly GraphCluster[],
  collapsed: ReadonlySet<string>,
): ProjectGraphEdge[] {
  const clusterOf = clusterOfNodes(clusters);
  const anchor = (nodeId: string): string => {
    const clusterId = clusterOf.get(nodeId);
    return clusterId !== undefined && collapsed.has(clusterId) ? clusterId : nodeId;
  };
  const bundles = new Map<string, ProjectGraphEdge>();
  const kept: ProjectGraphEdge[] = [];
  for (const edge of [...edges].toSorted((a, b) => a.id.localeCompare(b.id))) {
    const source = anchor(edge.source);
    const target = anchor(edge.target);
    // Both ends inside one collapsed cluster: the edge is internal, the super-node counts it.
    if (source === target && source !== edge.source) continue;
    if (source === edge.source && target === edge.target) {
      kept.push(edge);
      continue;
    }
    const key = [source, target, edge.kind, edge.access ?? ""].join("\u0000");
    const bundle = bundles.get(key);
    if (bundle === undefined) {
      bundles.set(key, { ...edge, source, target, count: 1 });
    } else {
      bundles.set(key, { ...bundle, count: (bundle.count ?? 1) + 1 });
    }
  }
  return [...kept, ...bundles.values()].toSorted((a, b) => a.id.localeCompare(b.id));
}
