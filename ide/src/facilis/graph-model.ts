// The project-graph view model: the analyzer's one ProjectGraph (`@facilis/analyze`) mapped
// to what React Flow draws, plus the deterministic layered auto-layout. Pure: no React, no
// bridge, no IO, so the geometry and the filters are unit-testable and a refresh can rebuild
// the view without touching the editor.
//
// Layout is four columns — pages, routes, tables, workflows — with FK/relation edges staying
// inside the tables column. A saved position overrides the automatic one; edge kinds listed in
// the layout's `hiddenEdges` are dropped before the canvas sees them.

import type { GraphEdgeKind, GraphNodeKind, ProjectGraph } from "@facilis/analyze";
import { GRAPH_EDGE_KINDS, type GraphPosition } from "./graph-layout";
import { pageData, routeData, tableData, workflowData } from "./graph-node-data";
import {
  GRAPH_COLUMNS,
  type ProjectGraphEdge,
  type ProjectGraphNode,
  type ProjectGraphView,
  type ProjectGraphViewInput,
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
  WorkflowGraphData,
  WorkflowStepGraphData,
} from "./graph-types";
export { GRAPH_COLUMNS } from "./graph-types";

/**
 * Vertical pitch per kind; a node never overlaps the next one of its column. Route cards are
 * the tallest of the fixed rows because they carry the input flags and path-parameter row.
 */
const ROW_PITCH = { page: 88, route: 112, table: 190, workflow: 150 } as const;

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
  workflows: readonly ProjectGraphNode[],
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
  place("workflow", workflows);
  return positions;
}

function matchesQuery(node: ProjectGraphNode, needle: string): boolean {
  if (needle.length === 0) return true;
  const values: string[] = [node.label, node.id, node.sourceFile ?? ""];
  const data = node.data;
  if (data.kind === "page") {
    values.push(data.pagePath, data.pageKind, ...data.routePaths);
  } else if (data.kind === "route") {
    values.push(data.method, data.path, data.wrapper, ...data.permission);
    for (const elevation of data.elevations) {
      values.push(elevation.kind, ...elevation.tables);
    }
  } else if (data.kind === "table") {
    for (const column of data.columns) values.push(column.property, column.name, column.type);
  } else {
    values.push(data.name);
    for (const step of data.steps) {
      values.push(step.kind, step.name ?? "", step.permission ?? "");
    }
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
          : node.data.kind === "table"
            ? tableData(node)
            : workflowData(node);
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
  const workflows = nodes
    .filter((node) => node.kind === "workflow")
    .toSorted((a, b) => a.label.localeCompare(b.label));
  const tableOrder = orderTables(tables, input.graph.edges.map(edgeView).filter(isTableEdge));
  const orderedTables = tableOrder
    .map((id) => tables.find((node) => node.id === id))
    .filter((node): node is ProjectGraphNode => node !== undefined);
  const auto = autoPositions(pages, routes, orderedTables, workflows);

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
      workflows: workflows.length,
      edges: visible.length,
      hiddenEdges: hiddenCount,
      matches: positioned.filter((node) => node.matched).length,
      unknownNodes: positioned.filter((node) => node.data.kind !== "page" && node.data.unknown)
        .length,
      pageLinks: visible.filter((edge) => edge.kind === "page-link").length,
      elevatedEdges: visible.filter((edge) => edge.access === "elevated").length,
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
    ...(edge.access === undefined ? {} : { access: edge.access }),
  };
}

/** Resolve a fact's project-relative source to an absolute VFS path. */
export function sourcePathFor(root: string | null, sourceFile: string | null): string | null {
  if (root === null || sourceFile === null || sourceFile.length === 0) return null;
  return sourceFile.startsWith("/") ? sourceFile : root + "/" + sourceFile;
}

/** The canonical edge kinds, re-exported so the UI imports one module. */
export { GRAPH_EDGE_KINDS };
