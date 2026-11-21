// The hub overlay's React Flow mapping plus the canvas's hub guards as pure functions
// (issue #64). Hubs are view artefacts: clicking one toggles the session-scoped expansion
// (never selection, which is URL state), and a drag never commits a hub position — the saved
// layout (.facilis/graph, v3) must not learn about them. Both decisions are unit-tested here
// instead of inside the canvas, which ships no jsdom. The chip's dimming composes the same
// channels as the cards: user focus/drill/hub hover (12%), edge-kind isolation (10%), and the
// AI focus outlines instead of dimming (D-171, issue #66).

import type { GraphEdgeKind } from "@facilis.dev/analyze";
import { HUB_SIZE, hubEdgeIdFor, type GraphEdgeHub } from "@/facilis/graph-edge-hubs";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { GraphReachability } from "@/facilis/graph-reachability";
import { HUB_NODE_TYPE, type ProjectHubFlowNode } from "./ProjectGraphHubNode";
import { NOTE_NODE_TYPE } from "./ProjectGraphNote";
import { TURN_NODE_TYPE } from "./ProjectGraphTurnNode";
import type { ProjectGraphDrill } from "./project-graph-flow-nodes";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";
import type { ProjectGraphHubsState } from "./useProjectGraphHubs";

/** What a node click does: hubs expand, notes and turn tombstones clear, cards select. */
export function resolveNodeClick(nodeType: string | undefined): "toggle-hub" | "clear" | "select" {
  if (nodeType === HUB_NODE_TYPE) return "toggle-hub";
  if (nodeType === NOTE_NODE_TYPE || nodeType === TURN_NODE_TYPE) return "clear";
  return "select";
}

/** Where a drag stop commits: hub and tombstone positions are lens-only, never persisted. */
export function resolveDragCommit(nodeType: string | undefined): "note" | "analysis" | "none" {
  if (nodeType === HUB_NODE_TYPE || nodeType === TURN_NODE_TYPE) return "none";
  if (nodeType === NOTE_NODE_TYPE) return "note";
  return "analysis";
}

/** The AI focus outlines a hub when it names the target, a route, the count edge or a member. */
function hubAiNamed(hub: GraphEdgeHub, focus: ProjectGraphFocusState): boolean {
  if (focus.nodeIds.has(hub.id) || focus.nodeIds.has(hub.target)) return true;
  if (hub.sources.some((id) => focus.nodeIds.has(id))) return true;
  if (focus.edgeIds.has(hubEdgeIdFor(hub.kind, hub.target))) return true;
  return hub.edges.some((edge) => focus.edgeIds.has(edge.id));
}

/** The dimming/outline channels the cards already compose; the hub chip joins them. */
export interface HubFlowChannels {
  readonly focus: ProjectGraphFocusState | null;
  readonly userFocus: GraphReachability | null;
  readonly isolatedEdgeKinds: readonly GraphEdgeKind[];
  readonly drill: ProjectGraphDrill | null;
}

export function buildHubFlowNodes(
  hubs: ProjectGraphHubsState,
  view: ProjectGraphView,
  { focus, userFocus, isolatedEdgeKinds, drill }: HubFlowChannels,
): ProjectHubFlowNode[] {
  const { overlay, activeHover, isolation, toggleHub, hoverHub } = hubs;
  const nodeById = new Map(view.nodes.map((node) => [node.id, node]));
  const userNodes = userFocus === null ? null : new Set(userFocus.nodeIds);
  const isolationActive = isolatedEdgeKinds.length > 0;
  return overlay.hubs.map((hub) => {
    const hovered = hub.id === activeHover;
    // The hub stands for its routes and target: it stays bright while any of them is inside
    // every active closure, and recedes when another hub's hover isolates a different fan.
    const parts = [hub.target, ...hub.sources];
    const focused =
      (userNodes === null || parts.some((id) => userNodes.has(id))) &&
      (drill === null || parts.some((id) => drill.nodeIds.has(id))) &&
      (isolation === null || isolation.nodeIds.has(hub.id));
    return {
      id: hub.id,
      type: HUB_NODE_TYPE,
      position: { x: hub.position.x, y: hub.position.y },
      width: HUB_SIZE.width,
      height: HUB_SIZE.height,
      data: {
        hub,
        targetLabel: nodeById.get(hub.target)?.label ?? hub.target,
        routeLabels: hub.sources.map((id) => nodeById.get(id)?.label ?? id),
        hovered,
        focused,
        // Every member edge shares the hub's kind, so kind isolation is one membership test.
        isolated: isolationActive && !isolatedEdgeKinds.includes(hub.kind),
        aiOutlined: focus !== null && hubAiNamed(hub, focus),
        onToggle: toggleHub,
        onHover: hoverHub,
      },
      // View artefacts: no drag (the layout must not persist them), no selection (the URL
      // must not name them), and the chip itself is the one keyboard stop.
      draggable: false,
      selectable: false,
      focusable: false,
      // The hover satellite must float above neighbouring cards, not under them.
      zIndex: hovered ? 1000 : 0,
    };
  });
}
