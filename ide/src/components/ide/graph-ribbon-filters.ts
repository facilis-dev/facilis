// The stats ribbon's filter logic (issue #57), pure so the toggles are unit-tested.
//
// Two filter families share one ribbon:
//  * the seven edge kinds toggle the layout's persisted hiddenEdges (the old toolbar
//    checkboxes, semantics unchanged — D-179's tableVisibility is a separate dropdown);
//  * the five node kinds toggle a view-only filter applied after buildProjectGraphView, so
//    node positions never move and nothing new enters the layout file (version 3 stays).

import type { GraphEdgeKind, GraphNodeKind } from "@facilis.dev/analyze";
import { GRAPH_EDGE_KINDS, type ProjectGraphView } from "@/facilis/graph-types";

/** The node-kind counters, in the footer's original order. */
export const GRAPH_NODE_KINDS = [
  "page",
  "route",
  "table",
  "view",
  "workflow",
] as const satisfies readonly GraphNodeKind[];

/** Add the kind when absent, drop it when present; never mutates the saved list. */
export function toggleKind<T>(hidden: readonly T[], kind: T): T[] {
  return hidden.includes(kind) ? hidden.filter((entry) => entry !== kind) : [...hidden, kind];
}

export function allEdgeKindsHidden(hidden: readonly GraphEdgeKind[]): boolean {
  return GRAPH_EDGE_KINDS.every((kind) => hidden.includes(kind));
}

/** The "edges" master counter: hide every kind at once, or bring them all back. */
export function toggleAllEdgeKinds(hidden: readonly GraphEdgeKind[]): GraphEdgeKind[] {
  return allEdgeKindsHidden(hidden) ? [] : [...GRAPH_EDGE_KINDS];
}

/** Per-kind totals over the analyzed edges, so a hidden chip still shows what it holds. */
export function edgeKindTotals(
  edges: readonly { readonly kind: GraphEdgeKind }[],
): Record<GraphEdgeKind, number> {
  const totals = Object.fromEntries(GRAPH_EDGE_KINDS.map((kind) => [kind, 0])) as Record<
    GraphEdgeKind,
    number
  >;
  for (const edge of edges) totals[edge.kind] += 1;
  return totals;
}

/**
 * Drop the hidden node kinds and every edge that would point at a removed card. The stats
 * are recounted over what remains; hiddenEdges/hiddenNodes describe the other filters and
 * carry through untouched. An empty filter returns the same view (no re-render churn).
 */
export function filterViewByNodeKinds(
  view: ProjectGraphView,
  hidden: readonly GraphNodeKind[],
): ProjectGraphView {
  if (hidden.length === 0) return view;
  const nodes = view.nodes.filter((node) => !hidden.includes(node.kind));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = view.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  const count = (kind: GraphNodeKind) => nodes.filter((node) => node.kind === kind).length;
  return {
    nodes,
    edges,
    stats: {
      ...view.stats,
      pages: count("page"),
      routes: count("route"),
      tables: count("table"),
      views: count("view"),
      workflows: count("workflow"),
      edges: edges.length,
      matches: nodes.filter((node) => node.matched).length,
      unknownNodes: nodes.filter((node) => node.data.kind !== "page" && node.data.unknown).length,
      pageLinks: edges.filter((edge) => edge.kind === "page-link").length,
      elevatedEdges: edges.filter((edge) => edge.access === "elevated").length,
    },
  };
}
