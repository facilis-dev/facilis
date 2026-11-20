// The project-graph canvas: React Flow over the pure view model. Cards, notes and edges live in
// ProjectGraphNodes/Note/Edge.tsx; the details satellite and its session pins (issue #59) in
// useProjectGraphDetails; the instance-driven effects in useProjectGraphCanvasEffects. This file
// only wires the interactions: nodes are controlled locally so a drag follows the pointer and
// commits to the saved layout only on drag stop. fitView padding comes from the measured HUD
// (issue #57); chrome and edges use role tokens (XYFLOW_THEME_TOKENS, D-043/D-044).

import "@xyflow/react/dist/style.css";
import { useCallback, useMemo, useRef, useState, type Dispatch } from "react";
import {
  Background,
  ReactFlow,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type OnMove,
  type OnMoveEnd,
  type OnMoveStart,
  type OnNodeDrag,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import { toFlowPadding, type HudFitPadding } from "@/facilis/graph-hud-padding";
import type { GraphViewport } from "@/facilis/graph-layout";
import type { NodeDetails } from "@/facilis/graph-details";
import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import {
  detailsLinkEdgeId,
  satelliteNodeId,
  type PinnedDetailsAction,
  type PinnedDetailsCard,
} from "@/facilis/graph-satellite";
import type { GraphCurve, GraphNote } from "@/facilis/graph-types";
import { PROJECT_GRAPH_EDGE_TYPES } from "./ProjectGraphEdge";
import {
  DETAILS_LINK_EDGE_TYPE,
  ProjectGraphDetailsLinkEdge,
  type ProjectCanvasEdge,
} from "./ProjectGraphDetailsLinkEdge";
import { DETAILS_NODE_TYPE } from "./ProjectGraphDetailsNode";
import {
  LINK_SOURCE_HANDLE_ID,
  LINK_TARGET_HANDLE_ID,
  PROJECT_GRAPH_NODE_TYPES,
  type ProjectFlowNode,
} from "./ProjectGraphNodes";
import { NOTE_NODE_TYPE } from "./ProjectGraphNote";
import { buildProjectGraphFlowEdges } from "./project-graph-flow-edges";
import { useProjectGraphCanvasEffects } from "./useProjectGraphCanvasEffects";
import { useProjectGraphDetails, type PinRequest } from "./useProjectGraphDetails";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";
import { XYFLOW_THEME_TOKENS } from "./xyflow-theme";

// Module scope: React Flow rebuilds its internals when the registry identity changes.
const EDGE_TYPES = {
  ...PROJECT_GRAPH_EDGE_TYPES,
  [DETAILS_LINK_EDGE_TYPE]: ProjectGraphDetailsLinkEdge,
};

export function ProjectGraphCanvas({
  view,
  fitPadding,
  onInstance,
  notes,
  addNoteNonce,
  viewport,
  fitNonce,
  edgeCurves,
  focus,
  selectedNodeId,
  onSelectNode,
  onMoveNode,
  onToggleCollapse,
  onOpenNode,
  onViewportChange,
  onEdgeCurveChange,
  onCreateNote,
  onMoveNote,
  onEditNote,
  onDeleteNote,
  details,
  sources,
  nodeLabel,
  sheetMode,
  sheetHeight,
  containerWidth,
  pinned,
  dispatchPinned,
  pinRequest,
  onOpenFileAt,
  onOpenPreview,
}: {
  view: ProjectGraphView;
  fitPadding: HudFitPadding;
  onInstance: (instance: ReactFlowInstance<ProjectFlowNode, ProjectCanvasEdge>) => void;
  notes: readonly GraphNote[];
  addNoteNonce: number;
  viewport: GraphViewport | null;
  fitNonce: number;
  edgeCurves: Readonly<Record<string, GraphCurve>>;
  focus: ProjectGraphFocusState | null;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onMoveNode: (id: string, position: { x: number; y: number }) => void;
  onToggleCollapse: (id: string) => void;
  onOpenNode: (node: ProjectGraphNode) => void;
  onViewportChange: (viewport: GraphViewport) => void;
  onEdgeCurveChange: (edgeId: string, curve: GraphCurve | null) => void;
  onCreateNote: (position: { x: number; y: number }) => void;
  onMoveNote: (id: string, position: { x: number; y: number }) => void;
  onEditNote: (id: string, text: string) => void;
  onDeleteNote: (id: string) => void;
  details: ReadonlyMap<string, NodeDetails>;
  sources: ReadonlyMap<string, string>;
  nodeLabel: (id: string) => string | null;
  sheetMode: boolean;
  sheetHeight: number;
  containerWidth: number;
  pinned: readonly PinnedDetailsCard[];
  dispatchPinned: Dispatch<PinnedDetailsAction>;
  pinRequest: PinRequest | null;
  onOpenFileAt: (file: string, line: number) => void;
  onOpenPreview: (path: string) => void;
}) {
  const [instance, setInstance] = useState<ReactFlowInstance<
    ProjectFlowNode,
    ProjectCanvasEdge
  > | null>(null);
  // Edge selection is local: it drives only the curve handle, never the saved layout.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const moved = useRef(false);
  const wrapper = useRef<HTMLDivElement>(null);

  // The collapse callback travels through a ref so node data does not depend on the parent's
  // function identity: a parent re-render must not rebuild the cards mid-drag.
  const onToggleCollapseRef = useRef(onToggleCollapse);
  onToggleCollapseRef.current = onToggleCollapse;
  const toggleCollapse = useCallback((id: string) => {
    onToggleCollapseRef.current(id);
  }, []);
  // Same reasoning for the note actions: the note card holds its editor state, so a changed
  // function identity would rebuild its data and could interrupt a drag or an edit.
  const noteActions = useRef({ onCreateNote, onEditNote, onDeleteNote });
  noteActions.current = { onCreateNote, onEditNote, onDeleteNote };
  const createNote = useCallback((position: { x: number; y: number }) => {
    noteActions.current.onCreateNote(position);
  }, []);
  const editNote = useCallback((id: string, text: string) => {
    noteActions.current.onEditNote(id, text);
  }, []);
  const deleteNote = useCallback((id: string) => {
    noteActions.current.onDeleteNote(id);
  }, []);

  const { nodes, onNodesChange, onViewportMove, activeAnchorId, movePinned } =
    useProjectGraphDetails({
      view,
      notes,
      focus,
      selectedNodeId,
      sheetMode,
      pinned,
      dispatchPinned,
      pinRequest,
      details,
      sources,
      nodeLabel,
      instance,
      wrapperRef: wrapper,
      containerWidth,
      onSelectNode,
      onOpenFileAt,
      onOpenPreview,
      onToggleCollapse: toggleCollapse,
      onEditNote: editNote,
      onDeleteNote: deleteNote,
    });

  const sheet = useMemo(
    () => (sheetMode ? { height: sheetHeight, selectedNodeId } : null),
    [sheetMode, sheetHeight, selectedNodeId],
  );
  useProjectGraphCanvasEffects({
    instance,
    wrapperRef: wrapper,
    fitNonce,
    fitPadding,
    focus,
    nodes,
    addNoteNonce,
    createNote,
    sheet,
  });

  const edges = useMemo<ProjectCanvasEdge[]>(() => {
    const analysis = buildProjectGraphFlowEdges({
      view,
      edgeCurves,
      selectedEdgeId,
      focus,
      onEdgeCurveChange,
    });
    if (activeAnchorId === null) return analysis;
    return [
      ...analysis,
      {
        id: detailsLinkEdgeId(activeAnchorId),
        source: activeAnchorId,
        target: satelliteNodeId(activeAnchorId),
        sourceHandle: LINK_SOURCE_HANDLE_ID,
        targetHandle: LINK_TARGET_HANDLE_ID,
        type: DETAILS_LINK_EDGE_TYPE,
        data: {},
        focusable: false,
        selectable: false,
      },
    ];
  }, [view, edgeCurves, selectedEdgeId, focus, onEdgeCurveChange, activeAnchorId]);

  const onEdgeClick: EdgeMouseHandler<ProjectCanvasEdge> = (_event, edge) => {
    setSelectedEdgeId(edge.id);
    onSelectNode(null);
  };
  const onNodeClick: NodeMouseHandler<ProjectFlowNode> = (_event, node) => {
    // A click inside the satellite keeps the selection: it is the selection's own detail.
    if (node.type === DETAILS_NODE_TYPE) return;
    setSelectedEdgeId(null);
    onSelectNode(node.type === NOTE_NODE_TYPE ? null : node.id);
  };
  const onNodeDragStop: OnNodeDrag<ProjectFlowNode> = (_event, node) => {
    const position = { x: node.position.x, y: node.position.y };
    if (node.type === NOTE_NODE_TYPE) onMoveNote(node.id, position);
    else if (node.type === DETAILS_NODE_TYPE) {
      // Only a pinned card drags on its own, and only into session state — never the layout.
      if (node.data.pinned) movePinned(node.id, position);
    } else onMoveNode(node.id, position);
  };
  const onNodeDoubleClick: NodeMouseHandler<ProjectFlowNode> = (_event, node) => {
    // A note opens its own editor; the satellite has no source file of its own.
    if (node.type === NOTE_NODE_TYPE || node.type === DETAILS_NODE_TYPE) return;
    const target = view.nodes.find((entry) => entry.id === node.id);
    if (target !== undefined) onOpenNode(target);
  };
  const onMoveStart: OnMoveStart = (event) => {
    // A fitView transition has no source event, so this is how a programmatic move is told from
    // a user's. While a focus is active such a move is the focus fit, and it must not be saved:
    // the layout keeps the viewport the user chose (D-171 persists no focus state).
    if (event === null && focus !== null) return;
    moved.current = true;
  };
  const onMove: OnMove = (_event, next: Viewport) => onViewportMove(next);
  const onMoveEnd: OnMoveEnd = (_event, next: Viewport) => {
    if (!moved.current) return;
    moved.current = false;
    onViewportChange({ x: next.x, y: next.y, zoom: next.zoom });
  };

  return (
    <div
      ref={wrapper}
      data-testid="project-graph-canvas"
      // Dragging a node or box-selecting must not paint card text as selected; the note editor
      // and the details body opt back in with select-text.
      style={{ userSelect: "none" }}
      className={"h-full min-h-0 " + XYFLOW_THEME_TOKENS}
    >
      <ReactFlow<ProjectFlowNode, ProjectCanvasEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={PROJECT_GRAPH_NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onInit={(inst) => {
          setInstance(inst);
          onInstance(inst);
        }}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeClick={onEdgeClick}
        onNodeClick={onNodeClick}
        onPaneClick={() => {
          setSelectedEdgeId(null);
          onSelectNode(null);
        }}
        onMoveStart={onMoveStart}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        fitView={viewport === null}
        fitViewOptions={{ padding: toFlowPadding(fitPadding) }}
        defaultViewport={viewport === null ? { x: 0, y: 0, zoom: 1 } : viewport}
        nodesConnectable={false}
        zoomOnDoubleClick={false}
        onlyRenderVisibleElements
        minZoom={0.05}
        maxZoom={2}
      >
        <Background color="var(--border)" gap={20} />
      </ReactFlow>
    </div>
  );
}