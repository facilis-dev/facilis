// The project graph's table visibility (D-179): framework tables are the only nodes a
// visibility choice may hide. Routes, pages, views and workflows are never filtered — every
// route the analysis sees is project code, because the IDE inlines only the @facilis.dev/auth
// and @facilis.dev/db sources and no framework route reaches the analyzer. This replaces the
// D-163 route heuristic, whose "names no project relation in dbTables" rule misclassified the
// starter's own auth routes and silently cut their edges to framework tables.
//
// Framework provenance is a fact for tables: the analyzer marks those whose declaration lives
// under `node_modules/`. "Used" then asks whether the project's own facts reference the table
// through a graph edge; a framework->framework edge does not make a table used, because the
// framework's internal wiring is not the project's surface.

import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { GraphTableVisibility, ProjectGraphEdge, ProjectGraphNode } from "./graph-types";

/** Edge kinds that carry a project's use of a table (D-179); page and navigation edges never do. */
const REFERENCE_EDGE_KINDS: ReadonlySet<GraphEdgeKind> = new Set([
  "route-table",
  "route-view",
  "fk",
  "relation",
  "view-base",
]);

/** A table declared by an installed @facilis.dev package (its source lives under node_modules/). */
export function isSystemTable(node: ProjectGraphNode): boolean {
  return node.data.kind === "table" && node.data.framework;
}

/**
 * The table ids the chosen visibility removes from the drawn view. Edges are dropped by the
 * caller when an endpoint is hidden, and no route is ever in the result: the choice only
 * decides framework tables.
 */
export function hiddenTableNodeIds(
  nodes: readonly ProjectGraphNode[],
  edges: readonly ProjectGraphEdge[],
  visibility: GraphTableVisibility,
): Set<string> {
  const frameworkTables = nodes.filter(isSystemTable);
  if (visibility === "all" || frameworkTables.length === 0) return new Set();
  if (visibility === "project") return new Set(frameworkTables.map((node) => node.id));

  // "used": keep a framework table only when a project node references it. The source must
  // exist in the drawn graph, so an edge to a node the model dropped cannot mark anything used.
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const referenced = new Set<string>();
  for (const edge of edges) {
    if (!REFERENCE_EDGE_KINDS.has(edge.kind)) continue;
    const source = byId.get(edge.source);
    if (source === undefined || isSystemTable(source)) continue;
    referenced.add(edge.target);
  }
  return new Set(frameworkTables.filter((node) => !referenced.has(node.id)).map((node) => node.id));
}
