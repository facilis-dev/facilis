// The hub overlay's React Flow mapping plus the canvas's hub guards as pure functions
// (issue #64). Hubs are view artefacts: clicking one toggles the session-scoped expansion
// (never selection, which is URL state), and a drag never commits a hub position — the saved
// layout (.facilis/graph, v3) must not learn about them. Both decisions are unit-tested here
// instead of inside the canvas, which ships no jsdom.

import {
  HUB_SIZE,
  hubEdgeIdFor,
  type GraphHubOverlay,
  type HubIsolation,
} from "@/facilis/graph-edge-hubs";
import type { ProjectGraphView } from "@/facilis/graph-model";
import { HUB_NODE_TYPE, type ProjectHubFlowNode } from "./ProjectGraphHubNode";
import { NOTE_NODE_TYPE } from "./ProjectGraphNote";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

/** What a node click does: hubs expand, notes clear the selection, cards select. */
export function resolveNodeClick(nodeType: string | undefined): "toggle-hub" | "clear" | "select" {
  if (nodeType === HUB_NODE_TYPE) return "toggle-hub";
  if (nodeType === NOTE_NODE_TYPE) return "clear";
  return "select";
}

/** Where a drag stop commits: hub positions are never persisted, so they commit nowhere. */
export function resolveDragCommit(nodeType: string | undefined): "note" | "analysis" | "none" {
  if (nodeType === HUB_NODE_TYPE) return "none";
  if (nodeType === NOTE_NODE_TYPE) return "note";
  return "analysis";
}

/** A hub stays bright under an AI focus that names it, its routes, its target or its edges. */
function hubFocused(hub: GraphHubOverlay["hubs"][number], focus: ProjectGraphFocusState): boolean {
  if (focus.nodeIds.has(hub.id) || focus.nodeIds.has(hub.target)) return true;
  if (hub.sources.some((id) => focus.nodeIds.has(id))) return true;
  if (focus.edgeIds.has(hubEdgeIdFor(hub.kind, hub.target))) return true;
  return hub.edges.some((edge) => focus.edgeIds.has(edge.id));
}

export function buildHubFlowNodes(
  overlay: GraphHubOverlay,
  view: ProjectGraphView,
  hoveredHubId: string | null,
  focus: ProjectGraphFocusState | null,
  isolation: HubIsolation | null,
  onToggle: (hubId: string) => void,
  onHover: (hubId: string | null) => void,
): ProjectHubFlowNode[] {
  const nodeById = new Map(view.nodes.map((node) => [node.id, node]));
  return overlay.hubs.map((hub) => {
    const hovered = hub.id === hoveredHubId;
    const bright =
      (focus === null || hubFocused(hub, focus)) &&
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
        dimmed: !bright,
        onToggle,
        onHover,
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
