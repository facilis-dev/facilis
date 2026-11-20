// The details nodes of the canvas (issue #59): the active satellite beside the selected card
// and the session's pinned free-floating cards. Pure mapping over the analysis nodes, so the
// placement rules (gap, side flip, screen-constant size) stay testable in graph-satellite.ts and
// this module only assembles React Flow nodes. The dashed connector is built by the canvas.

import type { Viewport } from "@xyflow/react";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { NodeDetails } from "@/facilis/graph-details";
import {
  satelliteNodeId,
  satellitePosition,
  satelliteSide,
  type PinnedDetailsCard,
  type SatelliteAnchor,
} from "@/facilis/graph-satellite";
import { cardFallbackSize } from "./ProjectGraphEdge";
import { DETAILS_NODE_TYPE, type ProjectDetailsFlowNode } from "./ProjectGraphDetailsNode";
import type { ProjectFlowNode } from "./ProjectGraphNodes";

export interface DetailsFlowNodesInput {
  readonly view: ProjectGraphView;
  /** The analysis and note nodes already built: the anchor's position and measurement. */
  readonly analysisNodes: readonly ProjectFlowNode[];
  /** The previous full list: a pinned card's in-flight drag survives a rebuild. */
  readonly previous: readonly ProjectFlowNode[];
  readonly pinned: readonly PinnedDetailsCard[];
  readonly activeAnchorId: string | null;
  readonly viewport: Viewport;
  readonly containerWidth: number;
  readonly details: ReadonlyMap<string, NodeDetails>;
  readonly sources: ReadonlyMap<string, string>;
  readonly nodeLabel: (id: string) => string | null;
  readonly onCloseActive: () => void;
  readonly onClosePinned: (card: PinnedDetailsCard) => void;
  readonly onTogglePin: (nodeId: string) => void;
  readonly onOpenFileAt: (file: string, line: number) => void;
  readonly onOpenPreview: (path: string) => void;
  readonly onSelectNode: (id: string) => void;
}

function anchorOf(flow: ProjectFlowNode): SatelliteAnchor {
  return {
    x: flow.position.x,
    y: flow.position.y,
    width: flow.measured?.width ?? cardFallbackSize(flow.type).width,
  };
}

export function buildDetailsFlowNodes({
  view,
  analysisNodes,
  previous,
  pinned,
  activeAnchorId,
  viewport,
  containerWidth,
  details,
  sources,
  nodeLabel,
  onCloseActive,
  onClosePinned,
  onTogglePin,
  onOpenFileAt,
  onOpenPreview,
  onSelectNode,
}: DetailsFlowNodesInput): ProjectDetailsFlowNode[] {
  const byId = new Map(analysisNodes.map((node) => [node.id, node]));
  const sharedFor = (nodeId: string) => {
    const node = view.nodes.find((entry) => entry.id === nodeId);
    if (node === undefined) return null;
    return {
      node,
      // Incident edges, both directions: the page body lists page links, the view body reads
      // the routes that use it.
      edges: view.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId),
      details: details.get(nodeId) ?? null,
      sources,
      nodeLabel,
      onOpenFileAt,
      onOpenPreview,
      onSelectNode,
      onTogglePin: () => onTogglePin(nodeId),
    };
  };
  const out: ProjectDetailsFlowNode[] = [];
  if (activeAnchorId !== null) {
    const anchorFlow = byId.get(activeAnchorId);
    const shared = sharedFor(activeAnchorId);
    if (anchorFlow !== undefined && shared !== null) {
      const anchor = anchorOf(anchorFlow);
      const side = satelliteSide(anchor, viewport, containerWidth);
      out.push({
        id: satelliteNodeId(activeAnchorId),
        type: DETAILS_NODE_TYPE,
        position: satellitePosition(anchor, side, viewport.zoom),
        data: { ...shared, pinned: false, onClose: onCloseActive },
        // The satellite follows its anchor; only a pinned card drags on its own.
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: 1000,
      });
    }
  }
  const existing = new Map(previous.map((node) => [node.id, node]));
  for (const card of pinned) {
    const shared = sharedFor(card.nodeId);
    if (shared === null) continue;
    const current = existing.get(card.id);
    out.push({
      id: card.id,
      type: DETAILS_NODE_TYPE,
      // A drag in flight wins over the committed session position, like the analysis cards.
      position: current?.dragging === true ? current.position : card.position,
      data: { ...shared, pinned: true, onClose: () => onClosePinned(card) },
      draggable: true,
      selectable: false,
      focusable: false,
      zIndex: 900,
    });
  }
  return out;
}

/**
 * Keep the satellite attached while its anchor drags or the viewport moves: recompute its
 * position (and side) from the anchor's current rect. Returns the same array when nothing
 * changed, so a pan frame without a flip costs no re-render.
 */
export function repositionDetailsNode(
  nodes: ProjectFlowNode[],
  activeAnchorId: string | null,
  viewport: Viewport,
  containerWidth: number,
): ProjectFlowNode[] {
  if (activeAnchorId === null) return nodes;
  const satelliteId = satelliteNodeId(activeAnchorId);
  const anchor = nodes.find((node) => node.id === activeAnchorId);
  const satellite = nodes.find((node) => node.id === satelliteId);
  if (anchor === undefined || satellite === undefined) return nodes;
  const anchorRect = anchorOf(anchor);
  const side = satelliteSide(anchorRect, viewport, containerWidth);
  const position = satellitePosition(anchorRect, side, viewport.zoom);
  if (satellite.position.x === position.x && satellite.position.y === position.y) {
    return nodes;
  }
  return nodes.map((node) => (node.id === satelliteId ? { ...node, position } : node));
}
