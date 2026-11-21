// The hub guards and flow mapping (issue #64): hubs never commit a drag position (the saved
// layout must not learn about them) and a hub click toggles expansion instead of selecting
// (selection is URL state). The chip node itself is non-draggable, non-selectable and carries
// the route labels for the hover satellite. Its dimming composes the card channels: user
// focus/drill/hub hover (12%), edge-kind isolation (10%), the AI focus outlines (never dims).
import { describe, expect, it, vi } from "vitest";
import type { GraphEdge } from "@facilis.dev/analyze";
import { deriveEdgeHubOverlay, hubIdFor, type GraphHubOverlay, type HubIsolation } from "@/facilis/graph-edge-hubs";
import { buildProjectGraphView } from "@/facilis/graph-model";
import { graphOf, routeNode, tableNode } from "@/facilis/graph-model.test-fixtures";
import { reachabilityClosure } from "@/facilis/graph-reachability";
import { HUB_NODE_TYPE } from "./ProjectGraphHubNode";
import { NOTE_NODE_TYPE } from "./ProjectGraphNote";
import { buildProjectGraphFlowNodes } from "./project-graph-flow-nodes";
import { buildHubFlowNodes, resolveDragCommit, resolveNodeClick, type HubFlowChannels } from "./project-graph-hub-flow";
import type { ProjectGraphHubsState } from "./useProjectGraphHubs";

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

const CHANNELS: HubFlowChannels = {
  focus: null,
  userFocus: null,
  isolatedEdgeKinds: [],
  drill: null,
};

function hubsOf(
  next: GraphHubOverlay = overlay,
  activeHover: string | null = null,
  isolation: HubIsolation | null = null,
): ProjectGraphHubsState {
  return { overlay: next, isolation, activeHover, toggleHub: vi.fn(), hoverHub: vi.fn() };
}

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
    const nodes = buildHubFlowNodes(hubsOf(), view, CHANNELS);
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
    expect(node?.data.focused).toBe(true);
    expect(node?.data.isolated).toBe(false);
    expect(node?.data.aiOutlined).toBe(false);
  });

  it("hover raises the chip above its neighbours; another hub's isolation dims it", () => {
    const isolation: HubIsolation = { nodeIds: new Set([hubId]), edgeIds: new Set<string>() };
    const nodes = buildHubFlowNodes(hubsOf(overlay, hubId, isolation), view, CHANNELS);
    expect(nodes[0]?.zIndex).toBe(1000);
    expect(nodes[0]?.data.hovered).toBe(true);
    expect(nodes[0]?.data.focused).toBe(true);
    // Hovering a DIFFERENT hub isolates that hub's parts: this chip recedes with the rest.
    const elsewhere: HubIsolation = {
      nodeIds: new Set(["hub:route-view:view:other"]),
      edgeIds: new Set<string>(),
    };
    const outside = buildHubFlowNodes(hubsOf(overlay, null, elsewhere), view, CHANNELS);
    expect(outside[0]?.data.focused).toBe(false);
  });

  it("the AI focus outlines a hub that names its parts and never dims it", () => {
    const focus = { nodeIds: new Set(["table:other"]), edgeIds: new Set<string>(), zoom: false };
    const unnamed = buildHubFlowNodes(hubsOf(), view, { ...CHANNELS, focus });
    expect(unnamed[0]?.data.aiOutlined).toBe(false);
    expect(unnamed[0]?.data.focused).toBe(true);
    const named = {
      nodeIds: new Set([routes[0]?.id ?? ""]),
      edgeIds: new Set<string>(),
      zoom: false,
    };
    const outlined = buildHubFlowNodes(hubsOf(), view, { ...CHANNELS, focus: named });
    expect(outlined[0]?.data.aiOutlined).toBe(true);
  });

  it("the user focus dims the chip when none of its parts is in the closure", () => {
    const closure = reachabilityClosure(view, routes[0]?.id ?? "");
    expect(closure).not.toBeNull();
    if (closure === null) return;
    const inside = buildHubFlowNodes(hubsOf(), view, { ...CHANNELS, userFocus: closure });
    expect(inside[0]?.data.focused).toBe(true);
    // A closure around an unrelated node names neither the routes nor the target.
    const other = buildProjectGraphView({
      graph: graphOf([...routes, TASKS, tableNode("other")], edges),
    });
    const outsideClosure = reachabilityClosure(other, "table:other");
    expect(outsideClosure).not.toBeNull();
    if (outsideClosure === null) return;
    const outside = buildHubFlowNodes(hubsOf(), view, { ...CHANNELS, userFocus: outsideClosure });
    expect(outside[0]?.data.focused).toBe(false);
  });

  it("edge-kind isolation dims the chip only when its kind is not isolated", () => {
    const other = buildHubFlowNodes(hubsOf(), view, { ...CHANNELS, isolatedEdgeKinds: ["fk"] });
    expect(other[0]?.data.isolated).toBe(true);
    const own = buildHubFlowNodes(hubsOf(), view, {
      ...CHANNELS,
      isolatedEdgeKinds: ["route-table"],
    });
    expect(own[0]?.data.isolated).toBe(false);
  });

  it("hub chips join the node list without moving any analysis card (spatial constancy)", () => {
    const base = buildProjectGraphFlowNodes({
      view,
      notes: [],
      previous: [],
      selectedNodeId: null,
      focus: null,
      userFocus: null,
      isolatedEdgeKinds: [],
      drill: null,
      hubIsolation: null,
      onToggleCollapse: vi.fn(),
      onToggleClusterCollapse: vi.fn(),
      onEditNote: vi.fn(),
      onDeleteNote: vi.fn(),
    });
    const combined = [...base, ...buildHubFlowNodes(hubsOf(), view, CHANNELS)];
    expect(combined).toHaveLength(base.length + 1);
    for (const node of base) {
      const again = combined.find((entry) => entry.id === node.id);
      expect(again?.position).toEqual(node.position);
      const model = view.nodes.find((entry) => entry.id === node.id);
      expect(node.position).toEqual(model?.position);
    }
  });
});
