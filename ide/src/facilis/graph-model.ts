// The project-graph view model: the analyzer's one ProjectGraph (`@facilis.dev/analyze`) mapped
// to what React Flow draws, plus the deterministic layered auto-layout. Pure: no React, no
// bridge, no IO, so the geometry and the filters are unit-testable and a refresh can rebuild
// the view without touching the editor.
//
// Layout comes from the wrapped-layer engine (graph-layout-engine.ts, issue #61): layers keep
// their order — pages, routes, data, workflows — but spill into sub-columns to stay near 16:9.
// Views are schema objects too, so they join the data layer behind a gap. A saved position
// overrides the automatic one; edge kinds listed in the layout's `hiddenEdges` are dropped
// before the canvas sees them.

import type { GraphEdgeKind, GraphNodeKind, ProjectGraph } from "@facilis.dev/analyze";
import { pageData, routeData, tableData, viewData } from "./graph-model-data";
import { matchesNodeQuery, workflowData } from "./graph-node-data";
import { hiddenTableNodeIds } from "./graph-system";
import { GRAPH_EDGE_KINDS } from "./graph-layout";
import { buildClusteredView } from "./graph-cluster-layout";
import { layoutGraph } from "./graph-layout-engine";
import { isTableEdge, layoutLayers, orderTables } from "./graph-layout-layers";
import {
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
  // The stats-ribbon kind filter (issue #57) is an explicit user choice layered on top of D-179
  // table visibility. It isolates node kinds but never inflates stats.hiddenNodes, which counts
  // only the table-visibility removals. Routes are still never filtered by table visibility.
  const kindSet =
    input.kinds !== undefined && input.kinds.length > 0
      ? new Set<GraphNodeKind>(input.kinds)
      : null;
  const visibleNodes = nodes.filter(
    (node) => !hiddenNodeIds.has(node.id) && (kindSet === null || kindSet.has(node.kind)),
  );
  const visibleById = new Map(visibleNodes.map((node) => [node.id, node]));
  // A hidden node takes its edges with it: a half-visible edge would point at nothing.
  const allVisibleEdges =
    visibleNodes.length === nodes.length
      ? allEdges
      : allEdges.filter((edge) => visibleById.has(edge.source) && visibleById.has(edge.target));

  // Feature clustering (issue #62) is a separate pure path over the same visible nodes/edges:
  // frames reserve the layout, and the collapse set hides children and re-anchors the boundary.
  const clusterOptions = input.clusters;
  if (clusterOptions !== undefined && clusterOptions.enabled) {
    return buildClusteredView({
      nodes: visibleNodes,
      edges: allVisibleEdges,
      positions,
      needle,
      hiddenEdgeKinds: hidden,
      hiddenNodes: hiddenNodeIds.size,
      options: clusterOptions,
    });
  }

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
  const orderedTables = tableOrder
    .map((id) => tables.find((node) => node.id === id))
    .filter((node): node is ProjectGraphNode => node !== undefined);
  const views = visibleNodes
    .filter((node) => node.kind === "view")
    .toSorted((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const workflows = visibleNodes
    .filter((node) => node.kind === "workflow")
    .toSorted((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const layout = layoutGraph(
    layoutLayers(pages, routes, orderedTables, views, workflows),
    positions,
  );

  const users = routeUsers(allVisibleEdges, visibleById);

  const positioned = visibleNodes.map((node) => {
    const data =
      node.data.kind === "view"
        ? { ...node.data, usedByRoutes: users.get(node.id) ?? [] }
        : node.data;
    const position = layout.positions.get(node.id) ?? { x: 0, y: 0 };
    const base = { ...node, data, position };
    return { ...base, matched: matchesNodeQuery(base, needle) };
  });

  const visible = allVisibleEdges.filter((edge) => !hidden.has(edge.kind));
  const hiddenCount = allVisibleEdges.length - visible.length;

  return {
    nodes: positioned,
    edges: visible,
    clusters: [],
    layoutSize: { width: layout.width, height: layout.height },
    stats: {
      pages: pages.length,
      routes: routes.length,
      tables: tables.length,
      views: views.length,
      workflows: workflows.length,
      edges: visible.length,
      hiddenEdges: hiddenCount,
      hiddenNodes: hiddenNodeIds.size,
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
