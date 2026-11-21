// The edge mapping's dimming contract (issue #63): isolation is a data flag, never a removal,
// so the canvas cannot move a node or change the bounds when a chip isolates a kind. The user
// focus (issue #66) and the AI outline are independent channels the edge composes with it.
import { describe, expect, it } from "vitest";
import type { GraphEdge } from "@facilis.dev/analyze";
import { deriveEdgeHubOverlay, hubEdgeIdFor, hubIdFor } from "@/facilis/graph-edge-hubs";
import { buildProjectGraphView } from "@/facilis/graph-model";
import { GET, PROJECTS, TODOS, graphOf, routeNode, tableNode } from "@/facilis/graph-model.test-fixtures";
import { buildProjectGraphFlowEdges } from "./project-graph-flow-edges";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

const EDGES: GraphEdge[] = [
  { id: "e1", kind: "fk", source: TODOS.id, target: PROJECTS.id, label: null },
  { id: "e2", kind: "relation", source: PROJECTS.id, target: TODOS.id, label: null },
  { id: "e3", kind: "route-table", source: GET.id, target: TODOS.id, label: null },
];

const view = buildProjectGraphView({ graph: graphOf([GET, TODOS, PROJECTS], EDGES) });

const build = (
  isolatedEdgeKinds: readonly ("fk" | "relation" | "route-table")[],
  focus: ProjectGraphFocusState | null = null,
) =>
  buildProjectGraphFlowEdges({
    overlay: deriveEdgeHubOverlay(view, "off", new Set()),
    edgeCurves: {},
    selectedEdgeId: null,
    focus,
    userFocus: null,
    isolatedEdgeKinds,
    drill: null,
    hubIsolation: null,
    onEdgeCurveChange: () => {},
  });

describe("buildProjectGraphFlowEdges", () => {
  it("keeps every edge bright without isolation or focus", () => {
    const edges = build([]);
    expect(edges).toHaveLength(3);
    for (const edge of edges) {
      expect(edge.data?.dimmed).toBeUndefined();
      expect(edge.data?.userDimmed).toBeUndefined();
      expect(edge.data?.aiOutlined).toBeUndefined();
    }
  });

  it("dims every other kind to a flag but never removes an edge", () => {
    const edges = build(["fk"]);
    expect(edges).toHaveLength(3);
    expect(edges.map((edge) => edge.data?.dimmed)).toEqual([false, true, true]);
  });

  it("dims nothing when every kind is isolated", () => {
    const edges = build(["fk", "relation", "route-table"]);
    expect(edges.every((edge) => edge.data?.dimmed === false)).toBe(true);
  });

  it("keeps the AI outline flag independent of isolation", () => {
    const focus: ProjectGraphFocusState = {
      nodeIds: new Set([TODOS.id]),
      edgeIds: new Set(["e2"]),
      zoom: false,
    };
    const edges = build(["fk"], focus);
    expect(edges.map((edge) => edge.data?.aiOutlined)).toEqual([false, true, false]);
    expect(edges.map((edge) => edge.data?.dimmed)).toEqual([false, true, true]);
  });

  it("never moves an edge's endpoints when isolation toggles (spatial constancy)", () => {
    const plain = build([]);
    const isolated = build(["fk"]);
    expect(isolated.map((edge) => [edge.source, edge.target])).toEqual(
      plain.map((edge) => [edge.source, edge.target]),
    );
  });

  it("marks the selected edge and keeps the kind's marker colour", () => {
    const edges = buildProjectGraphFlowEdges({
      overlay: deriveEdgeHubOverlay(view, "off", new Set()),
      edgeCurves: {},
      selectedEdgeId: "e1",
      focus: null,
      userFocus: null,
      isolatedEdgeKinds: [],
      drill: null,
      hubIsolation: null,
      onEdgeCurveChange: () => {},
    });
    expect(edges[0]?.selected).toBe(true);
    expect(edges[0]?.markerEnd).toMatchObject({ color: "var(--brand)" });
  });
});

// The boundary bundle and the drill dimming (issue #62): a collapse aggregates parallel
// crossings into one counted edge, and a drill faints the edges leaving the drilled cluster —
// data flags only, never a removal (epic #56 rule 2).
describe("buildProjectGraphFlowEdges clusters (issue #62)", () => {
  const graph = graphOf([GET, TODOS, PROJECTS], EDGES);
  const clustered = buildProjectGraphView({
    graph,
    clusters: { enabled: true, collapsed: ["cluster:db"] },
  });

  it("carries the bundle count as data and keeps every edge drawn", () => {
    const edges = buildProjectGraphFlowEdges({
      overlay: deriveEdgeHubOverlay(clustered, "off", new Set()),
      edgeCurves: {},
      selectedEdgeId: null,
      focus: null,
      userFocus: null,
      isolatedEdgeKinds: [],
      drill: null,
      hubIsolation: null,
      onEdgeCurveChange: () => {},
    });
    expect(edges.length).toBe(clustered.edges.length);
    const bundled = edges.filter((edge) => (edge.data?.count ?? 1) > 1);
    for (const edge of bundled) {
      const model = clustered.edges.find((entry) => entry.id === edge.id);
      expect(edge.data?.count).toBe(model?.count);
    }
  });

  it("a drill faints the edges leaving the drilled cluster, positions untouched", () => {
    const clusterView = buildProjectGraphView({
      graph,
      clusters: { enabled: true, collapsed: [] },
    });
    const frame = clusterView.clusters.find((cluster) => cluster.nodeIds.includes(GET.id));
    expect(frame).toBeDefined();
    if (frame === undefined) return;
    const drill = { clusterId: frame.id, nodeIds: new Set(frame.nodeIds) };
    const edges = buildProjectGraphFlowEdges({
      overlay: deriveEdgeHubOverlay(clusterView, "off", new Set()),
      edgeCurves: {},
      selectedEdgeId: null,
      focus: null,
      userFocus: null,
      isolatedEdgeKinds: [],
      drill,
      hubIsolation: null,
      onEdgeCurveChange: () => {},
    });
    const inside = (id: string) => id === frame.id || frame.nodeIds.includes(id);
    for (const edge of edges) {
      const bright = inside(edge.source) && inside(edge.target);
      expect(edge.data?.drillDimmed).toBe(!bright);
    }
    // The route-table edge leaves the route's cluster toward the table: it recedes.
    const leaving = edges.find((edge) => edge.id === "e3");
    expect(leaving?.data?.drillDimmed).toBe(true);
  });
});

// The concentration overlay's render mapping (issue #64): concentrated fan-outs become
// route->hub edges plus one thick count edge; expanded hubs restore the real edges WITH their
// labels; below-threshold groups carry a trunk lane and lose their curve handle; the hub hover
// composes as one more dimming channel, never a removal (epic rule 2).
const TASKS = tableNode("tasks");
function fanOut(count: number) {
  const routes = Array.from({ length: count }, (_, index) =>
    routeNode("GET", "/api/tasks/" + index),
  );
  const edges: GraphEdge[] = routes.map((route, index) => ({
    id: "route-table:" + index,
    kind: "route-table",
    source: route.id,
    target: TASKS.id,
    label: "dbTables",
  }));
  return buildProjectGraphView({ graph: graphOf([...routes, TASKS], edges) });
}

const hubId = hubIdFor("route-table", TASKS.id);
const hubEdgeId = hubEdgeIdFor("route-table", TASKS.id);

function buildOverlay(
  fan: ReturnType<typeof fanOut>,
  expanded: ReadonlySet<string>,
  hubIsolation: null | { nodeIds: ReadonlySet<string>; edgeIds: ReadonlySet<string> } = null,
  edgeCurves: Readonly<Record<string, { x: number; y: number }>> = {},
) {
  return buildProjectGraphFlowEdges({
    overlay: deriveEdgeHubOverlay(fan, 4, expanded),
    edgeCurves,
    selectedEdgeId: null,
    focus: null,
    userFocus: null,
    isolatedEdgeKinds: [],
    drill: null,
    hubIsolation,
    onEdgeCurveChange: () => {},
  });
}

describe("buildProjectGraphFlowEdges concentration (issue #64)", () => {
  it("concentrated fan-out: 10 route->hub edges keep their real ids, one thick count edge", () => {
    const edges = buildOverlay(fanOut(10), new Set());
    expect(edges).toHaveLength(11);
    const stubs = edges.filter((edge) => edge.target === hubId);
    expect(stubs).toHaveLength(10);
    expect(stubs.map((edge) => edge.id).toSorted()).toEqual(
      Array.from({ length: 10 }, (_, index) => "route-table:" + index).toSorted(),
    );
    const trunk = edges.find((edge) => edge.id === hubEdgeId);
    expect(trunk?.source).toBe(hubId);
    expect(trunk?.target).toBe(TASKS.id);
    expect(trunk?.data?.hubCount).toBe(10);
    expect(trunk?.selected).toBe(false);
    expect(trunk?.data?.curve).toBeNull();
  });

  it("expanded hub: the 10 real edges return with their labels and original targets", () => {
    const edges = buildOverlay(fanOut(10), new Set([hubId]));
    expect(edges).toHaveLength(10);
    expect(edges.every((edge) => edge.target === TASKS.id)).toBe(true);
    expect(edges.every((edge) => edge.data?.label === "dbTables")).toBe(true);
    expect(edges.some((edge) => edge.id === hubEdgeId)).toBe(false);
  });

  it("below threshold: every member carries the same trunk lane and no curve handle", () => {
    const edges = buildOverlay(fanOut(3), new Set());
    expect(edges).toHaveLength(3);
    const lanes = edges.map((edge) => edge.data?.trunkLane);
    expect(lanes.every((lane) => typeof lane === "number")).toBe(true);
    expect(new Set(lanes).size).toBe(1);
    expect(edges.every((edge) => edge.data?.bundled === true)).toBe(true);
    expect(edges.every((edge) => edge.data?.curve === null)).toBe(true);
    // A saved curve must not bend one member off the shared trunk.
    const withCurve = buildOverlay(fanOut(3), new Set(), null, {
      "route-table:0": { x: 20, y: 10 },
    });
    expect(withCurve.find((edge) => edge.id === "route-table:0")?.data?.curve).toBeNull();
  });

  it("hover isolation dims every edge the hub does not name, keeping endpoints in place", () => {
    const fan = fanOut(10);
    const overlay = deriveEdgeHubOverlay(fan, 4, new Set());
    const hub = overlay.hubs[0];
    expect(hub).toBeDefined();
    if (hub === undefined) return;
    const isolation = {
      nodeIds: new Set([hub.id, hub.target, ...hub.sources]),
      edgeIds: new Set([hubEdgeId, ...hub.edges.map((edge) => edge.id)]),
    };
    const edges = buildOverlay(fan, new Set(), isolation);
    expect(edges.every((edge) => edge.data?.hubDimmed === false)).toBe(true);
    // An unrelated isolation: only the named edge stays bright, the count edge recedes.
    const other = buildOverlay(fan, new Set(), {
      nodeIds: new Set(),
      edgeIds: new Set(["route-table:0"]),
    });
    expect(other.find((edge) => edge.id === "route-table:0")?.data?.hubDimmed).toBe(false);
    expect(other.find((edge) => edge.id === "route-table:1")?.data?.hubDimmed).toBe(true);
    expect(other.find((edge) => edge.id === hubEdgeId)?.data?.hubDimmed).toBe(true);
    // Dimming is opacity only: the drawn endpoints never move (spatial constancy).
    expect(other.map((edge) => [edge.id, edge.source, edge.target])).toEqual(
      edges.map((edge) => [edge.id, edge.source, edge.target]),
    );
  });

  it("no focus and no hover leaves every dimming flag unset (the pre-#64 behaviour)", () => {
    const edges = buildOverlay(fanOut(2), new Set());
    for (const edge of edges) {
      expect(edge.data?.hubDimmed).toBeUndefined();
      expect(edge.data?.userDimmed).toBeUndefined();
      expect(edge.data?.dimmed).toBeUndefined();
      expect(edge.data?.drillDimmed).toBeUndefined();
    }
  });
});

