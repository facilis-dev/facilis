// The canvas's pointer interactions (extracted from ProjectGraphCanvas for the 300-line source
// limit): edge/node selection, the drag-stop commit, double-click (source, or cluster drill for
// a frame — issue #62), and the viewport save. A cluster child drags frame-relative but commits
// ABSOLUTE: the saved layout (v3) keeps one coordinate space whether or not grouping is on.
// Programmatic fits (AI focus, drill) are told from user pans by their null source event and
// are never saved — the layout keeps the viewport the user chose (D-171).

import { useRef } from "react";
import type {
  EdgeMouseHandler,
  NodeMouseHandler,
  OnMove,
  OnMoveEnd,
  OnMoveStart,
  OnNodeDrag,
  Viewport,
} from "@xyflow/react";
import { isHubArtefactId } from "@/facilis/graph-edge-hubs";
import type { GraphViewport } from "@/facilis/graph-layout";
import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import { CLUSTER_NODE_TYPE } from "./ProjectGraphClusterNode";
import { DETAILS_NODE_TYPE } from "./ProjectGraphDetailsNode";
import type { ProjectCanvasEdge } from "./ProjectGraphDetailsLinkEdge";
import type { ProjectFlowNode } from "./ProjectGraphNodes";
import { NOTE_NODE_TYPE } from "./ProjectGraphNote";
import type { ProjectGraphDrill } from "./project-graph-flow-nodes";
import { resolveDragCommit, resolveNodeClick } from "./project-graph-hub-flow";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

export interface ProjectGraphInteractionsInput {
  view: ProjectGraphView;
  focus: ProjectGraphFocusState | null;
  drill: ProjectGraphDrill | null;
  /** A hub click toggles its session-scoped expansion (issue #64), never the selection. */
  onToggleHub: (hubId: string) => void;
  setSelectedEdgeId: (id: string | null) => void;
  onSelectNode: (id: string | null) => void;
  onMoveNode: (id: string, position: { x: number; y: number }) => void;
  onMoveNote: (id: string, position: { x: number; y: number }) => void;
  movePinned: (id: string, position: { x: number; y: number }) => void;
  onOpenNode: (node: ProjectGraphNode) => void;
  onDrillCluster: (id: string) => void;
  onViewportChange: (viewport: GraphViewport) => void;
  onViewportMove: (viewport: Viewport) => void;
  /** Live viewport (issue #68): the minimap follows a pan/zoom before it is committed. */
  onViewportLive?: (viewport: GraphViewport) => void;
}

export function useProjectGraphInteractions({
  view,
  focus,
  drill,
  onToggleHub,
  setSelectedEdgeId,
  onSelectNode,
  onMoveNode,
  onMoveNote,
  movePinned,
  onOpenNode,
  onDrillCluster,
  onViewportChange,
  onViewportMove,
  onViewportLive,
}: ProjectGraphInteractionsInput) {
  const moved = useRef(false);

  const onEdgeClick: EdgeMouseHandler<ProjectCanvasEdge> = (_event, edge) => {
    // Hub artefacts are never selected: no curve handle, no id in the saved layout (issue #64).
    if (isHubArtefactId(edge.id)) return;
    setSelectedEdgeId(edge.id);
    onSelectNode(null);
  };
  const onNodeClick: NodeMouseHandler<ProjectFlowNode> = (_event, node) => {
    // A click inside the satellite keeps the selection: it is the selection's own detail.
    if (node.type === DETAILS_NODE_TYPE) return;
    const action = resolveNodeClick(node.type);
    if (action === "toggle-hub") {
      onToggleHub(node.id);
      return;
    }
    setSelectedEdgeId(null);
    onSelectNode(action === "clear" ? null : node.id);
  };
  const onNodeDragStop: OnNodeDrag<ProjectFlowNode> = (_event, node) => {
    // A hub drag commits nowhere: the saved layout must not learn about view artefacts.
    const commit = resolveDragCommit(node.type);
    if (commit === "none") return;
    const position = { x: node.position.x, y: node.position.y };
    if (commit === "note") {
      onMoveNote(node.id, position);
      return;
    }
    if (node.type === DETAILS_NODE_TYPE) {
      // Only a pinned card drags on its own, and only into session state — never the layout.
      if (node.data.pinned) movePinned(node.id, position);
      return;
    }
    // A frame's origin is derived, never a saved position: it cannot be dragged at all.
    if (node.type === CLUSTER_NODE_TYPE) return;
    const frame = view.clusters.find((cluster) => cluster.id === node.parentId);
    const absolute =
      frame === undefined
        ? position
        : { x: frame.position.x + position.x, y: frame.position.y + position.y };
    onMoveNode(node.id, absolute);
  };
  const onNodeDoubleClick: NodeMouseHandler<ProjectFlowNode> = (_event, node) => {
    // A note opens its own editor; the satellite and the hub chip have no source file of
    // their own; a cluster frame drills down (issue #62); any other card opens its source (F.6).
    if (node.type === NOTE_NODE_TYPE || node.type === DETAILS_NODE_TYPE) return;
    if (resolveDragCommit(node.type) === "none") return;
    if (node.type === CLUSTER_NODE_TYPE) {
      onDrillCluster(node.id);
      return;
    }
    const target = view.nodes.find((entry) => entry.id === node.id);
    if (target !== undefined) onOpenNode(target);
  };
  const onMoveStart: OnMoveStart = (event) => {
    // A fitView transition has no source event, so this is how a programmatic move is told from
    // a user's. While a focus or a drill is active such a move is their fit, and it must not be
    // saved: the layout keeps the viewport the user chose (D-171 persists no focus state).
    if (event === null && (focus !== null || drill !== null)) return;
    moved.current = true;
  };
  const onMove: OnMove = (_event, next: Viewport) => {
    onViewportMove(next);
    onViewportLive?.({ x: next.x, y: next.y, zoom: next.zoom });
  };
  const onMoveEnd: OnMoveEnd = (_event, next: Viewport) => {
    onViewportLive?.({ x: next.x, y: next.y, zoom: next.zoom });
    if (!moved.current) return;
    moved.current = false;
    onViewportChange({ x: next.x, y: next.y, zoom: next.zoom });
  };

  return {
    onEdgeClick,
    onNodeClick,
    onNodeDragStop,
    onNodeDoubleClick,
    onMoveStart,
    onMove,
    onMoveEnd,
  };
}
