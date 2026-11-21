// The bridge planner's card rects (issue #65): the controlled node list yields the same
// geometry the per-edge router reads from the node lookup — absolute positions for cluster
// children, collapsed super-nodes as cards, expanded frames as containers, hub chips at their
// own size, and the shared GRAPH_NODE_SIZES fallback before measurement.
import { describe, expect, it } from "vitest";
import type { GraphEdge } from "@facilis.dev/analyze";
import { deriveEdgeHubOverlay, HUB_SIZE } from "@/facilis/graph-edge-hubs";
import { buildProjectGraphView } from "@/facilis/graph-model";
import { GET, PROJECTS, TODOS, graphOf } from "@/facilis/graph-model.test-fixtures";
import { GRAPH_NODE_SIZES } from "@/facilis/graph-node-size";
import { CLUSTER_NODE_TYPE } from "./ProjectGraphClusterNode";
import { HUB_NODE_TYPE } from "./ProjectGraphHubNode";
import type { ProjectFlowNode } from "./ProjectGraphNodes";
import { buildHubFlowNodes } from "./project-graph-hub-flow";
import { flowNodeRects } from "./project-graph-edge-rects";
import { buildProjectGraphFlowNodes } from "./project-graph-flow-nodes";

const EDGES: GraphEdge[] = [
  { id: "e1", kind: "fk", source: TODOS.id, target: PROJECTS.id, label: null },
  { id: "e2", kind: "relation", source: PROJECTS.id, target: TODOS.id, label: null },
  { id: "e3", kind: "route-table", source: GET.id, target: TODOS.id, label: null },
];
const NOOP = () => {};

function buildNodes(view: ReturnType<typeof buildProjectGraphView>): ProjectFlowNode[] {
  return buildProjectGraphFlowNodes({
    view,
    notes: [],
    previous: [],
    selectedNodeId: null,
    focus: null,
    userFocus: null,
    isolatedEdgeKinds: [],
    drill: null,
    hubIsolation: null,
    onToggleCollapse: NOOP,
    onToggleClusterCollapse: NOOP,
    onEditNote: NOOP,
    onDeleteNote: NOOP,
  });
}

describe("flowNodeRects", () => {
  const view = buildProjectGraphView({ graph: graphOf([GET, TODOS, PROJECTS], EDGES) });

  it("falls back to the shared card sizes before measurement", () => {
    const rects = flowNodeRects(buildNodes(view));
    const rect = rects.get(TODOS.id);
    expect(rect).toBeDefined();
    const size = GRAPH_NODE_SIZES.table;
    const node = view.nodes.find((entry) => entry.id === TODOS.id);
    expect(node).toBeDefined();
    if (rect === undefined || node === undefined) return;
    expect(rect.width).toBe(size.width);
    expect(rect.height).toBe(size.height);
    expect(rect.center.x).toBe(node.position.x + size.width / 2);
    expect(rect.center.y).toBe(node.position.y + size.height / 2);
  });

  it("prefers a measured size over the fallback", () => {
    const nodes = buildNodes(view);
    const target = nodes.find((node) => node.id === TODOS.id);
    expect(target).toBeDefined();
    if (target !== undefined) target.measured = { width: 300, height: 120 };
    const rect = flowNodeRects(nodes).get(TODOS.id);
    expect(rect?.width).toBe(300);
    expect(rect?.height).toBe(120);
  });

  it("adds the frame origin back to cluster children (absolute planner coordinates)", () => {
    const clustered = buildProjectGraphView({
      graph: graphOf([GET, TODOS, PROJECTS], EDGES),
      clusters: { enabled: true, collapsed: [] },
    });
    const nodes = buildNodes(clustered);
    const rects = flowNodeRects(nodes);
    const frames = nodes.filter((node) => node.type === CLUSTER_NODE_TYPE);
    expect(frames.length).toBeGreaterThan(0);
    for (const child of nodes) {
      if (child.parentId === undefined) continue;
      const frame = frames.find((entry) => entry.id === child.parentId);
      const model = clustered.nodes.find((entry) => entry.id === child.id);
      const rect = rects.get(child.id);
      expect(frame, child.id).toBeDefined();
      expect(model, child.id).toBeDefined();
      expect(rect, child.id).toBeDefined();
      if (frame === undefined || model === undefined || rect === undefined) continue;
      const size = GRAPH_NODE_SIZES[model.kind];
      expect(rect.center.x).toBe(model.position.x + size.width / 2);
      expect(rect.center.y).toBe(model.position.y + size.height / 2);
    }
    // An expanded frame is a container, not an obstacle: the planner never sees it.
    for (const frame of frames) expect(rects.has(frame.id)).toBe(false);
  });

  it("draws a collapsed super-node as a card at its cluster size", () => {
    const clustered = buildProjectGraphView({
      graph: graphOf([GET, TODOS, PROJECTS], EDGES),
      clusters: { enabled: true, collapsed: ["cluster:db"] },
    });
    const rects = flowNodeRects(buildNodes(clustered));
    const cluster = clustered.clusters.find((entry) => entry.id === "cluster:db");
    expect(cluster).toBeDefined();
    if (cluster === undefined) return;
    const rect = rects.get(cluster.id);
    expect(rect).toBeDefined();
    if (rect === undefined) return;
    expect(rect.width).toBe(cluster.size.width);
    expect(rect.height).toBe(cluster.size.height);
    expect(rect.center.x).toBe(cluster.position.x + cluster.size.width / 2);
    expect(rect.center.y).toBe(cluster.position.y + cluster.size.height / 2);
  });

  it("keeps hub chips at their own size, not the card fallback", () => {
    const routes = Array.from({ length: 6 }, (_, index) => ({
      ...GET,
      id: "route:GET /api/tasks/" + index,
    }));
    const fanEdges: GraphEdge[] = routes.map((route, index) => ({
      id: "route-table:" + index,
      kind: "route-table",
      source: route.id,
      target: TODOS.id,
      label: null,
    }));
    const fanView = buildProjectGraphView({ graph: graphOf([...routes, TODOS], fanEdges) });
    const overlay = deriveEdgeHubOverlay(fanView, 4, new Set());
    expect(overlay.hubs.length).toBeGreaterThan(0);
    const hubNodes = buildHubFlowNodes(
      { overlay, isolation: null, activeHover: null, toggleHub: NOOP, hoverHub: NOOP },
      fanView,
      { focus: null, userFocus: null, isolatedEdgeKinds: [], drill: null },
    );
    const rects = flowNodeRects([...buildNodes(fanView), ...hubNodes]);
    for (const hub of hubNodes) {
      expect(hub.type).toBe(HUB_NODE_TYPE);
      const rect = rects.get(hub.id);
      expect(rect, hub.id).toBeDefined();
      if (rect === undefined) continue;
      expect(rect.width).toBe(HUB_SIZE.width);
      expect(rect.height).toBe(HUB_SIZE.height);
      expect(rect.center.x).toBe(hub.position.x + HUB_SIZE.width / 2);
      expect(rect.center.y).toBe(hub.position.y + HUB_SIZE.height / 2);
    }
  });
});
