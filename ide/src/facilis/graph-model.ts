// The project-graph view model: the analyzer's one ProjectGraph (`@facilis/analyze`) mapped
// to what React Flow draws, plus the deterministic layered auto-layout. Pure: no React, no
// bridge, no IO, so the geometry and the filters are unit-testable and a refresh can rebuild
// the view without touching the editor.
//
// Layout is three columns — pages, routes, tables — with FK/relation edges staying inside the
// tables column. A saved position overrides the automatic one; edge kinds listed in the
// layout's `hiddenEdges` are dropped before the canvas sees them.

import type {
  ColumnFact,
  GraphEdgeKind,
  GraphNode,
  GraphNodeKind,
  ProjectGraph,
  RouteInputFact,
} from "@facilis/analyze";
import { GRAPH_EDGE_KINDS, type GraphPosition } from "./graph-layout";
import { pathParamsOf } from "./graph-path-params";
import {
  GRAPH_COLUMNS,
  type ColumnMarker,
  type GraphColumn,
  type PageGraphData,
  type ProjectGraphEdge,
  type ProjectGraphNode,
  type ProjectGraphView,
  type ProjectGraphViewInput,
  type RouteGraphData,
  type TableGraphData,
} from "./graph-types";

export type {
  ColumnMarker,
  GraphColumn,
  GraphScope,
  PageGraphData,
  ProjectGraphEdge,
  ProjectGraphNode,
  ProjectGraphNodeData,
  ProjectGraphStats,
  ProjectGraphView,
  ProjectGraphViewInput,
  RouteGraphData,
  TableGraphData,
} from "./graph-types";
export { GRAPH_COLUMNS } from "./graph-types";

/**
 * Vertical pitch per kind; a node never overlaps the next one of its column. Route cards are
 * the tallest of the fixed rows because they carry the input flags and path-parameter row.
 */
const ROW_PITCH = { page: 88, route: 112, table: 190 } as const;

function columnView(column: ColumnFact): GraphColumn {
  const markers: ColumnMarker[] = [];
  if (column.primaryKey) markers.push("primaryKey");
  if (column.notNull) markers.push("notNull");
  if (column.unique) markers.push("unique");
  if (column.default !== null) markers.push("default");
  if (column.unknown.length > 0) markers.push("unknown");
  return {
    property: column.property,
    name: column.name,
    type: column.type,
    markers,
  };
}

function pageData(node: GraphNode): PageGraphData | null {
  if (node.data.kind !== "page") return null;
  // Defensive: the analyzer already drops pages with no calls, but a hand-built graph
  // must not resurrect a floating page node.
  if (node.data.callCount <= 0) return null;
  return {
    kind: "page",
    pagePath: node.data.pagePath,
    pageKind: node.data.pageKind,
    callCount: node.data.callCount,
  };
}

/** An analyzer bundled before the input facts (or a still-running old worker) omits the field. */
const NO_ROUTE_INPUT: RouteInputFact = { body: false, form: false, query: false, params: false };

function routeData(node: GraphNode): RouteGraphData | null {
  if (node.data.kind !== "route") return null;
  return {
    kind: "route",
    method: node.data.method,
    path: node.data.path,
    permission: node.data.permission,
    wrapper: node.data.wrapper,
    description: node.data.description ?? null,
    input: node.data.input ?? NO_ROUTE_INPUT,
    pathParams: pathParamsOf(node.data.path),
    unknown: node.data.unknown,
  };
}

function tableData(node: GraphNode): TableGraphData | null {
  if (node.data.kind !== "table") return null;
  return {
    kind: "table",
    table: node.data.table,
    columns: node.data.columns.map(columnView),
    rlsEnabled: node.data.rlsEnabled,
    framework: node.data.framework,
    scope:
      node.data.scope === null
        ? null
        : { column: node.data.scope.column, kind: node.data.scope.kind },
    unknown: node.data.unknown,
  };
}

function isTableEdge(edge: ProjectGraphEdge): boolean {
  return edge.kind === "fk" || edge.kind === "relation";
}

/**
 * Order the table column by FK/relation dependency (a table before the tables it points at),
 * breaking ties lexicographically so the same graph always produces the same rows. Cycles —
 * legal in a schema — fall back to the lexicographically first remaining id.
 */
function orderTables(
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

function autoPositions(
  pages: readonly ProjectGraphNode[],
  routes: readonly ProjectGraphNode[],
  tables: readonly ProjectGraphNode[],
): Map<string, GraphPosition> {
  const positions = new Map<string, GraphPosition>();
  const place = (kind: GraphNodeKind, ordered: readonly ProjectGraphNode[]): void => {
    ordered.forEach((node, index) => {
      positions.set(node.id, { x: GRAPH_COLUMNS[kind], y: index * ROW_PITCH[kind] });
    });
  };
  place("page", pages);
  place("route", routes);
  place("table", tables);
  return positions;
}

function matchesQuery(node: ProjectGraphNode, needle: string): boolean {
  if (needle.length === 0) return true;
  const values: string[] = [node.label, node.id, node.sourceFile ?? ""];
  const data = node.data;
  if (data.kind === "page") {
    values.push(data.pagePath, data.pageKind);
  } else if (data.kind === "route") {
    values.push(data.method, data.path, data.wrapper, ...data.permission);
  } else {
    for (const column of data.columns) values.push(column.property, column.name, column.type);
  }
  return values.some((value) => value.toLowerCase().includes(needle));
}

/** Map the analyzer graph to the canvas model. Deterministic and free of side effects. */
export function buildProjectGraphView(input: ProjectGraphViewInput): ProjectGraphView {
  const positions = input.positions ?? {};
  const hidden = new Set<GraphEdgeKind>(input.hiddenEdgeKinds ?? []);
  const collapsed = input.collapsed ?? {};
  const needle = (input.query ?? "").trim().toLowerCase();

  // First occurrence wins, so a defensive duplicate cannot produce two React Flow nodes
  // with the same id (and every edge still points at the retained node).
  const nodes: ProjectGraphNode[] = [];
  const seen = new Set<string>();
  for (const node of input.graph.nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    const data =
      node.data.kind === "page"
        ? pageData(node)
        : node.data.kind === "route"
          ? routeData(node)
          : tableData(node);
    if (data === null) continue;
    nodes.push({
      id: node.id,
      kind: node.kind,
      label: node.label,
      sourceFile: node.sourceFile,
      position: { x: 0, y: 0 },
      data,
      matched: true,
      collapsed: node.kind === "table" && collapsed[node.id] === true,
    });
  }

  const pages = nodes
    .filter((node) => node.kind === "page")
    .toSorted((a, b) => a.id.localeCompare(b.id));
  const routes = nodes
    .filter((node) => node.kind === "route")
    .toSorted((a, b) => {
      if (a.data.kind !== "route" || b.data.kind !== "route") return a.id.localeCompare(b.id);
      return a.data.path.localeCompare(b.data.path) || a.data.method.localeCompare(b.data.method);
    });
  const tables = nodes.filter((node) => node.kind === "table");
  const tableOrder = orderTables(tables, input.graph.edges.map(edgeView).filter(isTableEdge));
  const orderedTables = tableOrder
    .map((id) => tables.find((node) => node.id === id))
    .filter((node): node is ProjectGraphNode => node !== undefined);
  const auto = autoPositions(pages, routes, orderedTables);

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const positioned = nodes.map((node) => {
    const saved = positions[node.id];
    const position =
      saved !== undefined && Number.isFinite(saved.x) && Number.isFinite(saved.y)
        ? { x: saved.x, y: saved.y }
        : (auto.get(node.id) ?? { x: 0, y: 0 });
    return { ...node, position, matched: matchesQuery(node, needle) };
  });

  const allEdges = input.graph.edges
    .map(edgeView)
    .filter((edge) => byId.has(edge.source) && byId.has(edge.target));
  const visible = allEdges.filter((edge) => !hidden.has(edge.kind));
  const hiddenCount = allEdges.length - visible.length;

  return {
    nodes: positioned,
    edges: visible,
    stats: {
      pages: pages.length,
      routes: routes.length,
      tables: tables.length,
      edges: visible.length,
      hiddenEdges: hiddenCount,
      matches: positioned.filter((node) => node.matched).length,
      unknownNodes: positioned.filter((node) => node.data.kind !== "page" && node.data.unknown)
        .length,
    },
  };
}

function edgeView(edge: ProjectGraph["edges"][number]): ProjectGraphEdge {
  return {
    id: edge.id,
    kind: edge.kind,
    source: edge.source,
    target: edge.target,
    label: edge.label,
  };
}

/** Resolve a fact's project-relative source to an absolute VFS path. */
export function sourcePathFor(root: string | null, sourceFile: string | null): string | null {
  if (root === null || sourceFile === null || sourceFile.length === 0) return null;
  return sourceFile.startsWith("/") ? sourceFile : root + "/" + sourceFile;
}

/** The canonical edge kinds, re-exported so the UI imports one module. */
export { GRAPH_EDGE_KINDS };
