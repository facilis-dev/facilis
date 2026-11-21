// The clustered project-graph view (issue #62): frames around feature groups, laid out by the
// same wrapped-layer engine as the flat graph. Each cluster's members keep the semantic layer
// order inside the frame; the frames themselves wrap near 16:9 as variable-size boxes. A
// collapse hides the children, draws a super-node and re-anchors the boundary edges; the layout
// is a pure function of (analysis, pins, collapse set), so expanding restores the exact previous
// positions (epic #56 rule 2). Saved pins stay absolute overrides and grow their frame to keep
// every child inside it — .facilis/graph/ (v3) is untouched; the collapse set lives in the URL.
//
// Clustering is a layout MODE (F.4): re-laying auto positions is what reset-layout may do too;
// a lens never moves a node. The card footprints come from GRAPH_NODE_SIZES, the one size source.

import type { GraphEdgeKind } from "@facilis.dev/analyze";
import { matchesNodeQuery } from "./graph-node-data";
import { layoutBoxes, layoutGraph } from "./graph-layout-engine";
import { GRAPH_NODE_SIZES } from "./graph-node-size";
import { layoutLayers, orderTables } from "./graph-layout-layers";
import { collapseClusterEdges, deriveClusters } from "./graph-clusters";
import type {
  GraphCluster,
  GraphClusterInput,
  ProjectGraphEdge,
  ProjectGraphNode,
  ProjectGraphView,
} from "./graph-types";
import type { GraphPosition } from "./graph-layout-file";

/** Frame padding around the members; the header carries the label and the collapse control. */
export const GRAPH_FRAME_PAD = 24;
export const GRAPH_FRAME_HEADER = 40;
/** The collapsed super-node: a chip card with the kind counts and the boundary-edge count. */
export const GRAPH_CLUSTER_SUPER_SIZE = { width: 256, height: 96 } as const;

export interface ClusteredViewInput {
  readonly nodes: readonly ProjectGraphNode[];
  readonly edges: readonly ProjectGraphEdge[];
  readonly positions: Readonly<Record<string, GraphPosition>>;
  readonly needle: string;
  readonly hiddenEdgeKinds: ReadonlySet<GraphEdgeKind>;
  readonly hiddenNodes: number;
  readonly options: GraphClusterInput;
}

/** The member order inside a frame mirrors the flat layout's layer order exactly. */
function memberLayers(members: readonly ProjectGraphNode[], edges: readonly ProjectGraphEdge[]) {
  const pages = members
    .filter((node) => node.kind === "page")
    .toSorted((a, b) => a.id.localeCompare(b.id));
  const routes = members
    .filter((node) => node.kind === "route")
    .toSorted((a, b) => {
      if (a.data.kind !== "route" || b.data.kind !== "route") return a.id.localeCompare(b.id);
      return a.data.path.localeCompare(b.data.path) || a.data.method.localeCompare(b.data.method);
    });
  const tables = members.filter((node) => node.kind === "table");
  const ordered = orderTables(
    tables,
    edges.filter((e) => e.kind === "fk" || e.kind === "relation"),
  )
    .map((id) => tables.find((node) => node.id === id))
    .filter((node): node is ProjectGraphNode => node !== undefined);
  const views = members
    .filter((node) => node.kind === "view")
    .toSorted((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const workflows = members
    .filter((node) => node.kind === "workflow")
    .toSorted((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  return layoutLayers(pages, routes, ordered, views, workflows);
}

/**
 * The effective collapse set: the user's choice, minus clusters forced open (drill-down) and,
 * while a search is active, minus every cluster holding a match — search auto-expands what it
 * finds and dims the rest (issue #62 criterion 4). A non-collapsible cluster never collapses.
 */
function effectiveCollapsed(
  clusters: readonly GraphCluster[],
  options: GraphClusterInput,
  needle: string,
): Set<string> {
  const forced = new Set(options.forceExpanded ?? []);
  const collapsed = new Set<string>();
  for (const cluster of clusters) {
    if (!cluster.collapsible || forced.has(cluster.id)) continue;
    if (!options.collapsed.includes(cluster.id)) continue;
    if (needle !== "" && cluster.matched) continue;
    collapsed.add(cluster.id);
  }
  return collapsed;
}

export function buildClusteredView(input: ClusteredViewInput): ProjectGraphView {
  const { nodes, edges, positions, needle, options } = input;
  const derived = deriveClusters(nodes, edges);
  const matchedNodes = nodes.map((node) => ({
    ...node,
    matched: matchesNodeQuery(node, needle),
  }));
  const matchedById = new Map(matchedNodes.map((node) => [node.id, node.matched]));
  const clusters = derived.map((cluster) => ({
    ...cluster,
    matched:
      needle === "" ||
      cluster.label.toLowerCase().includes(needle) ||
      cluster.nodeIds.some((id) => matchedById.get(id) === true),
  }));
  const collapsed = effectiveCollapsed(clusters, options, needle);
  const byId = new Map(matchedNodes.map((node) => [node.id, node]));

  // Pass 1: each expanded frame reserves its members' wrapped box; a collapsed one is the
  // super-node chip. The boxes wrap together so the whole clustered graph stays near 16:9.
  const content = new Map<
    string,
    { positions: ReadonlyMap<string, GraphPosition>; width: number; height: number }
  >();
  const boxes = clusters.map((cluster) => {
    if (collapsed.has(cluster.id)) {
      return {
        id: cluster.id,
        width: GRAPH_CLUSTER_SUPER_SIZE.width,
        height: GRAPH_CLUSTER_SUPER_SIZE.height,
      };
    }
    const members = cluster.nodeIds
      .map((id) => byId.get(id))
      .filter((node): node is ProjectGraphNode => node !== undefined);
    const layout = layoutGraph(memberLayers(members, edges));
    content.set(cluster.id, layout);
    return {
      id: cluster.id,
      width: layout.width + GRAPH_FRAME_PAD * 2,
      height: layout.height + GRAPH_FRAME_HEADER + GRAPH_FRAME_PAD,
    };
  });
  const packed = layoutBoxes(boxes);

  // Pass 2: absolute member positions (frame origin + header/pad + relative), then the saved
  // absolute pins; the frame grows to keep every pinned child inside it (extent: "parent").
  const memberPositions = new Map<string, GraphPosition>();
  const frames = clusters.map((cluster) => {
    const origin = packed.positions.get(cluster.id) ?? { x: 0, y: 0 };
    if (collapsed.has(cluster.id)) {
      return {
        ...cluster,
        collapsed: true,
        position: origin,
        size: { ...GRAPH_CLUSTER_SUPER_SIZE },
      };
    }
    const layout = content.get(cluster.id);
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const id of cluster.nodeIds) {
      const relative = layout?.positions.get(id) ?? { x: 0, y: 0 };
      const auto = {
        x: origin.x + GRAPH_FRAME_PAD + relative.x,
        y: origin.y + GRAPH_FRAME_HEADER + relative.y,
      };
      const pin = positions[id];
      const position =
        pin !== undefined && Number.isFinite(pin.x) && Number.isFinite(pin.y) ? pin : auto;
      memberPositions.set(id, position);
      const size = GRAPH_NODE_SIZES[byId.get(id)?.kind ?? "route"];
      minX = Math.min(minX, position.x);
      minY = Math.min(minY, position.y);
      maxX = Math.max(maxX, position.x + size.width);
      maxY = Math.max(maxY, position.y + size.height);
    }
    const position = { x: minX - GRAPH_FRAME_PAD, y: minY - GRAPH_FRAME_HEADER };
    const size = {
      width: maxX - minX + GRAPH_FRAME_PAD * 2,
      height: maxY - minY + GRAPH_FRAME_HEADER + GRAPH_FRAME_PAD,
    };
    return { ...cluster, collapsed: false, position, size };
  });

  const visibleEdges = edges.filter((edge) => !input.hiddenEdgeKinds.has(edge.kind));
  const drawnEdges = collapseClusterEdges(visibleEdges, frames, collapsed);
  const drawnNodes = matchedNodes
    .filter((node) => {
      const cluster = frames.find((entry) => entry.nodeIds.includes(node.id));
      return cluster === undefined || !cluster.collapsed;
    })
    .map((node) => ({ ...node, position: memberPositions.get(node.id) ?? node.position }));

  let width = 0;
  let height = 0;
  for (const frame of frames) {
    width = Math.max(width, frame.position.x + frame.size.width);
    height = Math.max(height, frame.position.y + frame.size.height);
  }
  const count = (kind: ProjectGraphNode["kind"]) =>
    drawnNodes.filter((n) => n.kind === kind).length;
  return {
    nodes: drawnNodes,
    edges: drawnEdges,
    clusters: frames,
    layoutSize: { width, height },
    stats: {
      pages: count("page"),
      routes: count("route"),
      tables: count("table"),
      views: count("view"),
      workflows: count("workflow"),
      edges: drawnEdges.length,
      hiddenEdges: edges.length - visibleEdges.length,
      hiddenNodes: input.hiddenNodes,
      matches: drawnNodes.filter((node) => node.matched).length,
      unknownNodes: drawnNodes.filter((node) => node.data.kind !== "page" && node.data.unknown)
        .length,
      pageLinks: drawnEdges.filter((edge) => edge.kind === "page-link").length,
      elevatedEdges: drawnEdges.filter((edge) => edge.access === "elevated").length,
    },
  };
}
