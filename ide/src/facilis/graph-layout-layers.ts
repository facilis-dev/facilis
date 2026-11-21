// The layered row ordering shared by the flat layout (graph-model.ts) and the clustered layout
// (graph-cluster-layout.ts, issue #62): tables ordered by FK dependency, views behind a gap in
// the data layer, layers in semantic page -> route -> data -> workflow order. Extracted so both
// paths place rows identically without importing each other (no cycle).

import { GRAPH_VIEW_GAP, type GraphLayoutLayer } from "./graph-layout-engine";
import type { ProjectGraphEdge, ProjectGraphNode } from "./graph-types";

export function isTableEdge(edge: ProjectGraphEdge): boolean {
  return edge.kind === "fk" || edge.kind === "relation";
}

/**
 * Order the table column by FK/relation dependency (a table before the tables it points at),
 * breaking ties lexicographically so the same graph always produces the same rows. Cycles —
 * legal in a schema — fall back to the lexicographically first remaining id.
 */
export function orderTables(
  tables: readonly ProjectGraphNode[],
  edges: readonly ProjectGraphEdge[],
): string[] {
  const ids = tables.map((node) => node.id).toSorted();
  const idSet = new Set(ids);
  const outgoing = new Map<string, string[]>(ids.map((id) => [id, []]));
  const incoming = new Map<string, number>(ids.map((id) => [id, 0]));
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!isTableEdge(edge) || !idSet.has(edge.source) || !idSet.has(edge.target)) continue;
    if (edge.source === edge.target) continue;
    const pair = edge.source + "\u0000" + edge.target;
    if (seen.has(pair)) continue;
    seen.add(pair);
    outgoing.get(edge.source)?.push(edge.target);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }
  const remaining = new Set(ids);
  const order: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].toSorted();
    const next = ready.find((id) => (incoming.get(id) ?? 0) === 0) ?? ready[0];
    if (next === undefined) break;
    order.push(next);
    remaining.delete(next);
    for (const target of outgoing.get(next) ?? []) {
      incoming.set(target, Math.max(0, (incoming.get(target) ?? 0) - 1));
    }
  }
  return order;
}

/**
 * The engine's layers in semantic order. Tables and views share the data layer — the gap keeps
 * a view visibly a relation over its base tables rather than another table row — so wrapping
 * treats the schema as one unit.
 */
export function layoutLayers(
  pages: readonly ProjectGraphNode[],
  routes: readonly ProjectGraphNode[],
  tables: readonly ProjectGraphNode[],
  views: readonly ProjectGraphNode[],
  workflows: readonly ProjectGraphNode[],
): GraphLayoutLayer[] {
  const rows = (nodes: readonly ProjectGraphNode[]) =>
    nodes.map((node) => ({ id: node.id, kind: node.kind }));
  const dataRows = [
    ...rows(tables),
    ...views.map((node, index) => ({
      id: node.id,
      kind: node.kind,
      ...(index === 0 && tables.length > 0 ? { gapBefore: GRAPH_VIEW_GAP } : {}),
    })),
  ];
  return [
    { rows: rows(pages) },
    { rows: rows(routes) },
    { rows: dataRows },
    { rows: rows(workflows) },
  ];
}
