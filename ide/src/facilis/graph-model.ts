// The project-graph view model: the analyzer's one ProjectGraph (`@facilis.dev/analyze`) mapped
// to what the canvas draws, plus the deterministic layered auto-layout. Pure: no React, no
// bridge, no IO, so the geometry and the filters are unit-testable and a refresh can rebuild
// the view without touching the editor. The model carries NO search state (issue #186): the
// debounced match pass lives in graph-search.ts and dims cards without rebuilding nodes.
//
// Layout is four columns — pages, routes, tables, workflows — with FK/relation edges staying
// inside the tables column. Views are schema objects too, so they sit in the tables column
// below it behind a gap instead of opening another column. A saved position overrides the
// automatic one; edge kinds listed in the layout's `hiddenEdges` are dropped before the canvas
// sees them.

import type { GraphEdgeKind, GraphNodeKind, ProjectGraph } from "@facilis.dev/analyze";
import { pageData, routeData, tableData, viewData } from "./graph-model-data";
import { workflowData } from "./graph-node-data";
import { hiddenTableNodeIds } from "./graph-system";
import { isTableEdge, orderTables } from "./graph-table-order";
import { GRAPH_EDGE_KINDS, type GraphPosition } from "./graph-layout";
import {
  GRAPH_COLUMNS,
  type ProjectGraphEdge,
  type ProjectGraphNode,
  type ProjectGraphView,
  type ProjectGraphViewInput,
  type UsedByRoute,
} from "./graph-types";

export type {
  ColumnMarker,
  GraphColumn,
  GraphScope,
  GraphTableVisibility,
  PageGraphData,
  ProjectGraphEdge,
  ProjectGraphNode,
  ProjectGraphNodeData,
  ProjectGraphStats,
  ProjectGraphView,
  ProjectGraphViewInput,
  RouteGraphData,
  TableGraphData,
  UsedByRoute,
  ViewGraphData,
  WorkflowGraphData,
  WorkflowStepGraphData,
} from "./graph-types";
export { GRAPH_COLUMNS } from "./graph-types";

/**
 * Vertical pitch per kind; a node never overlaps the next one of its column. Route cards are
 * the tallest of the fixed rows because they carry the input flags and path-parameter row.
 */
const ROW_PITCH = { page: 200, route: 112, table: 190, view: 150, workflow: 150 } as const;

/** Blank space between the last table row and the first view row in the schema column. */
const VIEW_GAP = 56;

function autoPositions(
  pages: readonly ProjectGraphNode[],
  routes: readonly ProjectGraphNode[],
  tables: readonly ProjectGraphNode[],
  views: readonly ProjectGraphNode[],
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
  // Tables first, then views, in the same schema column: the gap keeps a view visibly a
  // relation over its base tables rather than another table row.
  const viewsY = tables.length === 0 ? 0 : tables.length * ROW_PITCH.table + VIEW_GAP;
  views.forEach((node, index) => {
    positions.set(node.id, { x: GRAPH_COLUMNS.view, y: viewsY + index * ROW_PITCH.view });
  });
  return positions;
}

/** Incoming route-view edges grouped per view, sorted, for the card chip and the inspector. */
function routeUsers(
  edges: readonly ProjectGraphEdge[],
  byId: ReadonlyMap<string, ProjectGraphNode>,
): Map<string, UsedByRoute[]> {
  const users = new Map<string, UsedByRoute[]>();
  for (const edge of edges) {
    if (edge.kind !== "route-view") continue;
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (source?.data.kind !== "route" || target?.data.kind !== "view") continue;
    const list = users.get(target.id) ?? [];
    if (list.some((entry) => entry.id === source.id)) continue;
    list.push({ id: source.id, label: source.label });
    users.set(target.id, list);
  }
  for (const list of users.values()) {
    list.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  }
  return users;
}

/** Map the analyzer graph to the canvas model. Deterministic and free of side effects. */
export function buildProjectGraphView(input: ProjectGraphViewInput): ProjectGraphView {
  const positions = input.positions ?? {};
  const hidden = new Set<GraphEdgeKind>(input.hiddenEdgeKinds ?? []);
  const collapsed = input.collapsed ?? {};

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
            : node.data.kind === "view"
              ? viewData(node)
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
      collapsed: (node.kind === "table" || node.kind === "view") && collapsed[node.id] === true,
    });
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const allEdges = input.graph.edges
    .map(edgeView)
    .filter((edge) => byId.has(edge.source) && byId.has(edge.target));
  // D-179: the table-visibility choice drops framework tables before layout, so the graph
  // compacts instead of leaving holes where the hidden cards used to be. Routes are never
  // filtered; the default is "all" so an absent preference shows the whole analysis.
  const hiddenNodeIds = hiddenTableNodeIds(nodes, allEdges, input.tableVisibility ?? "all");
  const visibleNodes =
    hiddenNodeIds.size === 0 ? nodes : nodes.filter((node) => !hiddenNodeIds.has(node.id));
  const visibleById =
    hiddenNodeIds.size === 0 ? byId : new Map(visibleNodes.map((node) => [node.id, node]));
  // A hidden node takes its edges with it: a half-visible edge would point at nothing.
  const allVisibleEdges =
    hiddenNodeIds.size === 0
      ? allEdges
      : allEdges.filter((edge) => visibleById.has(edge.source) && visibleById.has(edge.target));

  const pages = visibleNodes
    .filter((node) => node.kind === "page")
    .toSorted((a, b) => a.id.localeCompare(b.id));
  const routes = visibleNodes
    .filter((node) => node.kind === "route")
    .toSorted((a, b) => {
      if (a.data.kind !== "route" || b.data.kind !== "route") return a.id.localeCompare(b.id);
      return a.data.path.localeCompare(b.data.path) || a.data.method.localeCompare(b.data.method);
    });
  const tables = visibleNodes.filter((node) => node.kind === "table");
  const tableOrder = orderTables(tables, allVisibleEdges.filter(isTableEdge));
  // Index Map, not .find per row: the ordering lookup is O(T), not O(T^2) (issue #186).
  const tableById = new Map(tables.map((node) => [node.id, node] as const));
  const orderedTables = tableOrder
    .map((id) => tableById.get(id))
    .filter((node): node is ProjectGraphNode => node !== undefined);
  const views = visibleNodes
    .filter((node) => node.kind === "view")
    .toSorted((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const workflows = visibleNodes
    .filter((node) => node.kind === "workflow")
    .toSorted((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const auto = autoPositions(pages, routes, orderedTables, views, workflows);

  const users = routeUsers(allVisibleEdges, visibleById);

  const positioned = visibleNodes.map((node) => {
    const data =
      node.data.kind === "view"
        ? { ...node.data, usedByRoutes: users.get(node.id) ?? [] }
        : node.data;
    const saved = positions[node.id];
    const position =
      saved !== undefined && Number.isFinite(saved.x) && Number.isFinite(saved.y)
        ? { x: saved.x, y: saved.y }
        : (auto.get(node.id) ?? { x: 0, y: 0 });
    return { ...node, data, position };
  });

  const visible = allVisibleEdges.filter((edge) => !hidden.has(edge.kind));
  const hiddenCount = allVisibleEdges.length - visible.length;

  return {
    nodes: positioned,
    edges: visible,
    stats: {
      pages: pages.length,
      routes: routes.length,
      tables: tables.length,
      views: views.length,
      workflows: workflows.length,
      edges: visible.length,
      hiddenEdges: hiddenCount,
      hiddenNodes: hiddenNodeIds.size,
      // No query lives in the model: every node matches until the panel applies the debounced
      // match count (graph-search.ts) on top of these stats.
      matches: positioned.length,
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
