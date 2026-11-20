// The flow-node mapping for clusters (issue #62): compound children carry parentId + extent
// and frame-relative positions, frames are non-draggable boxes, and a drill dims everything
// outside the drilled cluster without moving anything (epic #56 rule 2).

import { describe, expect, it } from "vitest";
import { buildProjectGraphView } from "@/facilis/graph-model";
import { GET, PAGE, TODOS, graphOf } from "@/facilis/graph-model.test-fixtures";
import type { GraphEdge } from "@facilis.dev/analyze";
import { buildProjectGraphFlowNodes } from "./project-graph-flow-nodes";
import { CLUSTER_NODE_TYPE } from "./ProjectGraphClusterNode";

const PAGE_ROUTE: GraphEdge = {
  id: "page-route:1",
  kind: "page-route",
  source: PAGE.id,
  target: GET.id,
  label: null,
};
const ROUTE_TABLE: GraphEdge = {
  id: "route-table:1",
  kind: "route-table",
  source: GET.id,
  target: TODOS.id,
  label: null,
};
const graph = graphOf([PAGE, GET, TODOS], [PAGE_ROUTE, ROUTE_TABLE]);
const noop = () => {};

function inputs(view: ReturnType<typeof buildProjectGraphView>, overrides: Partial<Parameters<typeof buildProjectGraphFlowNodes>[0]> = {}) {
  return {
    view,
    notes: [],
    previous: [],
    selectedNodeId: null,
    focus: null,
    drill: null,
    onToggleCollapse: noop,
    onToggleClusterCollapse: noop,
    onDrillCluster: noop,
    onEditNote: noop,
    onDeleteNote: noop,
    ...overrides,
  };
}

describe("buildProjectGraphFlowNodes clusters", () => {
  const view = buildProjectGraphView({ graph, clusters: { enabled: true, collapsed: [] } });

  it("maps every cluster to a non-draggable frame node of the reserved size", () => {
    const nodes = buildProjectGraphFlowNodes(inputs(view));
    const frames = nodes.filter((node) => node.type === CLUSTER_NODE_TYPE);
    expect(frames).toHaveLength(view.clusters.length);
    for (const frame of frames) {
      const cluster = view.clusters.find((entry) => entry.id === frame.id);
      expect(frame.draggable).toBe(false);
      expect(frame.position).toEqual(cluster?.position);
      expect(frame.style).toEqual({ width: cluster?.size.width, height: cluster?.size.height });
    }
  });

  it("members become compound children with frame-relative positions", () => {
    const nodes = buildProjectGraphFlowNodes(inputs(view));
    for (const cluster of view.clusters) {
      for (const id of cluster.nodeIds) {
        const child = nodes.find((node) => node.id === id);
        const model = view.nodes.find((node) => node.id === id);
        expect(child?.parentId).toBe(cluster.id);
        expect(child?.extent).toBe("parent");
        expect(child?.position).toEqual({
          x: (model?.position.x ?? 0) - cluster.position.x,
          y: (model?.position.y ?? 0) - cluster.position.y,
        });
      }
    }
  });

  it("a drill dims outsiders and brightens the drilled cluster, positions unchanged", () => {
    const target = view.clusters[0];
    expect(target).toBeDefined();
    if (target === undefined) return;
    const drill = { clusterId: target.id, nodeIds: new Set(target.nodeIds) };
    const plain = buildProjectGraphFlowNodes(inputs(view));
    const drilled = buildProjectGraphFlowNodes(inputs(view, { drill }));
    for (const node of drilled) {
      const before = plain.find((entry) => entry.id === node.id);
      expect(node.position).toEqual(before?.position);
      const inside = node.id === target.id || target.nodeIds.includes(node.id);
      expect(node.data.focused).toBe(inside);
    }
  });

  it("grouping off keeps absolute positions and no parent", () => {
    const flat = buildProjectGraphView({ graph });
    const nodes = buildProjectGraphFlowNodes(inputs(flat));
    expect(nodes.some((node) => node.type === CLUSTER_NODE_TYPE)).toBe(false);
    for (const node of nodes) {
      expect(node.parentId).toBeUndefined();
      const model = flat.nodes.find((entry) => entry.id === node.id);
      expect(node.position).toEqual(model?.position);
    }
  });

  it("a collapsed cluster maps its super-node and no children", () => {
    const collapsedView = buildProjectGraphView({
      graph,
      clusters: { enabled: true, collapsed: ["cluster:api/api"] },
    });
    const nodes = buildProjectGraphFlowNodes(inputs(collapsedView));
    const frame = nodes.find((node) => node.id === "cluster:api/api");
    expect(frame?.type).toBe(CLUSTER_NODE_TYPE);
    const clusterData = frame?.type === CLUSTER_NODE_TYPE ? frame.data.cluster : null;
    expect(clusterData?.collapsed).toBe(true);
    expect(nodes.some((node) => node.id === GET.id)).toBe(false);
    expect(nodes.some((node) => node.id === PAGE.id)).toBe(false);
  });

  it("an in-flight drag keeps its position across a rebuild", () => {
    const nodes = buildProjectGraphFlowNodes(inputs(view));
    const child = nodes.find((node) => node.id === GET.id);
    expect(child).toBeDefined();
    if (child === undefined) return;
    const dragging = { ...child, dragging: true, position: { x: 9, y: 9 } };
    const rebuilt = buildProjectGraphFlowNodes(inputs(view, { previous: [dragging] }));
    expect(rebuilt.find((node) => node.id === GET.id)?.position).toEqual({ x: 9, y: 9 });
  });
});
