// The hub guards and flow mapping (issue #64): hubs never commit a drag position (the saved
// layout must not learn about them) and a hub click toggles expansion instead of selecting
// (selection is URL state). The chip node itself is non-draggable, non-selectable and carries
// the route labels for the hover satellite.
import { describe, expect, it, vi } from "vitest";
import type { GraphEdge } from "@facilis.dev/analyze";
import { deriveEdgeHubOverlay, hubIdFor } from "@/facilis/graph-edge-hubs";
import { buildProjectGraphView } from "@/facilis/graph-model";
import { graphOf, routeNode, tableNode } from "@/facilis/graph-model.test-fixtures";
import { HUB_NODE_TYPE } from "./ProjectGraphHubNode";
import { NOTE_NODE_TYPE } from "./ProjectGraphNote";
import { buildHubFlowNodes, resolveDragCommit, resolveNodeClick } from "./project-graph-hub-flow";

const TASKS = tableNode("tasks");
const routes = Array.from({ length: 10 }, (_, index) => routeNode("GET", "/api/tasks/" + index));
const edges: GraphEdge[] = routes.map((route, index) => ({
  id: "route-table:" + index,
  kind: "route-table",
  source: route.id,
  target: TASKS.id,
  label: "dbTables",
}));
const view = buildProjectGraphView({ graph: graphOf([...routes, TASKS], edges) });
const overlay = deriveEdgeHubOverlay(view, 4, new Set());
const hubId = hubIdFor("route-table", TASKS.id);

describe("hub guards", () => {
  it("a hub click toggles expansion, a note click clears, a card click selects", () => {
    expect(resolveNodeClick(HUB_NODE_TYPE)).toBe("toggle-hub");
    expect(resolveNodeClick(NOTE_NODE_TYPE)).toBe("clear");
    expect(resolveNodeClick("table")).toBe("select");
    expect(resolveNodeClick(undefined)).toBe("select");
  });

  it("a hub drag commits nowhere: no hub position can reach the saved layout", () => {
    expect(resolveDragCommit(HUB_NODE_TYPE)).toBe("none");
    expect(resolveDragCommit(NOTE_NODE_TYPE)).toBe("note");
    expect(resolveDragCommit("route")).toBe("analysis");
    expect(resolveDragCommit(undefined)).toBe("analysis");
  });
});

describe("buildHubFlowNodes", () => {
  it("maps the hub to a fixed-size, non-draggable, non-selectable chip with its route labels", () => {
    const nodes = buildHubFlowNodes(overlay, view, null, null, null, vi.fn(), vi.fn());
    expect(nodes).toHaveLength(1);
    const node = nodes[0];
    expect(node?.id).toBe(hubId);
    expect(node?.type).toBe(HUB_NODE_TYPE);
    expect(node?.draggable).toBe(false);
    expect(node?.selectable).toBe(false);
    expect(node?.position).toEqual(overlay.hubs[0]?.position);
    expect(node?.data.routeLabels).toHaveLength(10);
    expect(node?.data.routeLabels[0]).toBe(routes[0]?.label);
    expect(node?.data.targetLabel).toBe("tasks");
    expect(node?.data.dimmed).toBe(false);
  });

  it("hover raises the chip above its neighbours; another hub's isolation dims it", () => {
    const isolation = {
      nodeIds: new Set([hubId]),
      edgeIds: new Set<string>(),
    };
    const nodes = buildHubFlowNodes(overlay, view, hubId, null, isolation, vi.fn(), vi.fn());
    expect(nodes[0]?.zIndex).toBe(1000);
    expect(nodes[0]?.data.hovered).toBe(true);
    expect(nodes[0]?.data.dimmed).toBe(false);
    // Hovering a DIFFERENT hub isolates that hub's parts: this chip recedes with the rest.
    const elsewhere = { nodeIds: new Set(["hub:route-view:view:other"]), edgeIds: new Set<string>() };
    const outside = buildHubFlowNodes(overlay, view, null, null, elsewhere, vi.fn(), vi.fn());
    expect(outside[0]?.data.dimmed).toBe(true);
  });

  it("an AI focus that names none of the hub's parts dims the chip", () => {
    const focus = { nodeIds: new Set(["table:other"]), edgeIds: new Set<string>(), zoom: false };
    const nodes = buildHubFlowNodes(overlay, view, null, focus, null, vi.fn(), vi.fn());
    expect(nodes[0]?.data.dimmed).toBe(true);
    const named = {
      nodeIds: new Set([routes[0]?.id ?? ""]),
      edgeIds: new Set<string>(),
      zoom: false,
    };
    const bright = buildHubFlowNodes(overlay, view, null, named, null, vi.fn(), vi.fn());
    expect(bright[0]?.data.dimmed).toBe(false);
  });
});
