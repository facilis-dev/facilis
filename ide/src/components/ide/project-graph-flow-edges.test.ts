// The render-edge mapping (issue #64): concentrated fan-outs become route->hub edges plus one
// thick count edge; expanded hubs restore the real edges WITH their labels; below-threshold
// groups carry a trunk lane and lose their curve handle; dimming composes AI focus and hover.
import { describe, expect, it, vi } from "vitest";
import type { GraphEdge } from "@facilis.dev/analyze";
import { deriveEdgeHubOverlay, hubEdgeIdFor, hubIdFor } from "@/facilis/graph-edge-hubs";
import { buildProjectGraphView } from "@/facilis/graph-model";
import { graphOf, routeNode, tableNode } from "@/facilis/graph-model.test-fixtures";
import { buildProjectGraphFlowEdges } from "./project-graph-flow-edges";

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
const noop = vi.fn();

function build(view: ReturnType<typeof fanOut>, expanded: ReadonlySet<string>, isolation: null | { nodeIds: ReadonlySet<string>; edgeIds: ReadonlySet<string> } = null) {
  const overlay = deriveEdgeHubOverlay(view, 4, expanded);
  return buildProjectGraphFlowEdges({
    overlay,
    edgeCurves: {},
    selectedEdgeId: null,
    focus: null,
    isolation,
    onCurveChange: noop,
  });
}

describe("buildProjectGraphFlowEdges", () => {
  it("concentrated fan-out: 10 route->hub edges keep their real ids, one thick count edge", () => {
    const edges = build(fanOut(10), new Set());
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
    const edges = build(fanOut(10), new Set([hubId]));
    expect(edges).toHaveLength(10);
    expect(edges.every((edge) => edge.target === TASKS.id)).toBe(true);
    expect(edges.every((edge) => edge.data?.label === "dbTables")).toBe(true);
    expect(edges.some((edge) => edge.id === hubEdgeId)).toBe(false);
  });

  it("below threshold: every member carries the same trunk lane and no curve handle", () => {
    const view = fanOut(3);
    const edges = build(view, new Set());
    expect(edges).toHaveLength(3);
    const lanes = edges.map((edge) => edge.data?.trunkLane);
    expect(lanes.every((lane) => typeof lane === "number")).toBe(true);
    expect(new Set(lanes).size).toBe(1);
    expect(edges.every((edge) => edge.data?.bundled === true)).toBe(true);
    expect(edges.every((edge) => edge.data?.curve === null)).toBe(true);
    // A saved curve must not bend one member off the shared trunk.
    const overlay = deriveEdgeHubOverlay(view, 4, new Set());
    const withCurve = buildProjectGraphFlowEdges({
      overlay,
      edgeCurves: { "route-table:0": { x: 20, y: 10 } },
      selectedEdgeId: null,
      focus: null,
      isolation: null,
      onCurveChange: noop,
    });
    expect(withCurve.find((edge) => edge.id === "route-table:0")?.data?.curve).toBeNull();
  });

  it("hover isolation dims every edge the hub does not name", () => {
    const view = fanOut(10);
    const overlay = deriveEdgeHubOverlay(view, 4, new Set());
    const hub = overlay.hubs[0];
    expect(hub).toBeDefined();
    if (hub === undefined) return;
    const isolation = {
      nodeIds: new Set([hub.id, hub.target, ...hub.sources]),
      edgeIds: new Set([hubEdgeId, ...hub.edges.map((edge) => edge.id)]),
    };
    const edges = buildProjectGraphFlowEdges({
      overlay,
      edgeCurves: {},
      selectedEdgeId: null,
      focus: null,
      isolation,
      onCurveChange: noop,
    });
    expect(edges.every((edge) => edge.data?.focused === true)).toBe(true);
    // An unrelated edge outside the isolation is dimmed.
    const other = buildProjectGraphFlowEdges({
      overlay,
      edgeCurves: {},
      selectedEdgeId: null,
      focus: null,
      isolation: { nodeIds: new Set(), edgeIds: new Set(["route-table:0"]) },
      onCurveChange: noop,
    });
    expect(other.find((edge) => edge.id === "route-table:0")?.data?.focused).toBe(true);
    expect(other.find((edge) => edge.id === "route-table:1")?.data?.focused).toBe(false);
    expect(other.find((edge) => edge.id === hubEdgeId)?.data?.focused).toBe(false);
  });

  it("no focus and no hover leaves the focused flag unset (the pre-#64 behaviour)", () => {
    const edges = build(fanOut(2), new Set());
    expect(edges.every((edge) => edge.data?.focused === undefined)).toBe(true);
  });
});
