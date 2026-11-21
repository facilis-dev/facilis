// The project-graph canvas: React Flow over the pure view model. Cards, cluster frames, notes
// and edges live in ProjectGraphNodes/ClusterNode/Note/Edge.tsx; the details satellite and its
// session pins (issue #59) in useProjectGraphDetails; the pointer interactions in
// use-project-graph-interactions; the instance-driven effects in useProjectGraphCanvasEffects
// and useGraphFitEffects. This file only wires the library: a drag commits to the saved layout
// only on drag stop, cluster children drag frame-relative and commit absolute (issue #62).
// fitView padding comes from the measured HUD (issue #57); role tokens only (XYFLOW_THEME_TOKENS).

import "@xyflow/react/dist/style.css";
import { useCallback, useMemo, useRef, useState, type Dispatch } from "react";
import { Background, ReactFlow, type ReactFlowInstance } from "@xyflow/react";
import { toFlowPadding, type HudFitPadding } from "@/facilis/graph-hud-padding";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { GraphViewport } from "@/facilis/graph-layout";
import type { NodeDetails } from "@/facilis/graph-details";
import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import type { GraphReachability } from "@/facilis/graph-reachability";
import type { PinnedDetailsAction, PinnedDetailsCard } from "@/facilis/graph-satellite";
import type { GraphCurve, GraphNote } from "@/facilis/graph-types";
import type { GraphEdgeConcentration } from "@/facilis/graph-view-state";
import { PROJECT_GRAPH_EDGE_TYPES } from "./ProjectGraphEdge";
import {
  DETAILS_LINK_EDGE_TYPE,
  ProjectGraphDetailsLinkEdge,
  type ProjectCanvasEdge,
} from "./ProjectGraphDetailsLinkEdge";
import { PROJECT_GRAPH_NODE_TYPES, type ProjectFlowNode } from "./ProjectGraphNodes";
import { ProjectGraphZoomVar } from "./ProjectGraphZoomVar";
import type { ProjectFlowContractState, ProjectGraphDrill } from "./project-graph-flow-nodes";
import { useProjectGraphEdges } from "./useProjectGraphEdges";
import { useGraphFitEffects } from "./useGraphFitEffects";
import { useProjectGraphCanvasEffects } from "./useProjectGraphCanvasEffects";
import { useProjectGraphDetails, type PinRequest } from "./useProjectGraphDetails";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";
import { useProjectGraphHubs } from "./useProjectGraphHubs";
import { useProjectGraphInteractions } from "./use-project-graph-interactions";
import { XYFLOW_THEME_TOKENS } from "./xyflow-theme";

// Module scope: React Flow rebuilds its internals when the registry identity changes.
const EDGE_TYPES = {
  ...PROJECT_GRAPH_EDGE_TYPES,
  [DETAILS_LINK_EDGE_TYPE]: ProjectGraphDetailsLinkEdge,
};

export function ProjectGraphCanvas({
  view,
  concentration,
  fitPadding,
  onInstance,
  notes,
  addNoteNonce,
  viewport,
  fitNonce,
  edgeCurves,
  bridges,
  focus,
  userFocus,
  isolatedEdgeKinds,
  contract,
  drill,
  selectedNodeId,
  onSelectNode,
  onMoveNode,
  onToggleCollapse,
  onToggleClusterCollapse,
  onDrillCluster,
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
  /** The edge-concentration threshold (issue #64); expansion/hover stay session-scoped. */
  concentration: GraphEdgeConcentration;
  fitPadding: HudFitPadding;
  onInstance: (instance: ReactFlowInstance<ProjectFlowNode, ProjectCanvasEdge>) => void;
  notes: readonly GraphNote[];
  addNoteNonce: number;
  viewport: GraphViewport | null;
  fitNonce: number;
  edgeCurves: Readonly<Record<string, GraphCurve>>;
  /** The bridges lens (issue #65): false restores every orthogonal route. */
  bridges: boolean;
  focus: ProjectGraphFocusState | null;
  /** The selection's closure (issue #66): the dimming channel, null when nothing is selected. */
  userFocus: GraphReachability | null;
  /** Edge kinds isolated by the chips (issue #63): opacity only, never a removal. */
  isolatedEdgeKinds: readonly GraphEdgeKind[];
  /** The contract lens's inputs (issue #69): audit dimming + the diagnostics join. */
  contract: ProjectFlowContractState;
  /** The active cluster drill-down (issue #62): dims outsiders and frames its fit. */
  drill: ProjectGraphDrill | null;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onMoveNode: (id: string, position: { x: number; y: number }) => void;
  onToggleCollapse: (id: string) => void;
  onToggleClusterCollapse: (id: string) => void;
  onDrillCluster: (id: string) => void;
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
  const wrapper = useRef<HTMLDivElement>(null);
  // Hub expansion and hover are session-scoped (issue #64); only the threshold is URL state.
  const hubs = useProjectGraphHubs(view, concentration);

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
      userFocus,
      isolatedEdgeKinds,
      contract,
      drill,
      hubs,
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
      onToggleClusterCollapse,
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
    nodes,
    addNoteNonce,
    createNote,
    sheet,
  });
  // The AI focus and drill-down fits compose with the canvas effects on the same instance.
  useGraphFitEffects(instance, nodes, focus, drill, fitPadding);

  // The edge list owns the bridge plan and its hover isolation (issue #65); the satellite
  // connector stays cubic dashed and never bridges (F.1).
  const edges = useProjectGraphEdges({
    nodes,
    edges: view.edges,
    overlay: hubs.overlay,
    hubIsolation: hubs.isolation,
    edgeCurves,
    selectedEdgeId,
    focus,
    userFocus,
    isolatedEdgeKinds,
    drill,
    bridges,
    activeAnchorId,
    onEdgeCurveChange,
  });

  const {
    onEdgeClick,
    onNodeClick,
    onNodeDragStop,
    onNodeDoubleClick,
    onMoveStart,
    onMove,
    onMoveEnd,
  } = useProjectGraphInteractions({
    view,
    focus,
    drill,
    onToggleHub: hubs.toggleHub,
    setSelectedEdgeId,
    onSelectNode,
    onMoveNode,
    onMoveNote,
    movePinned,
    onOpenNode,
    onDrillCluster,
    onViewportChange,
    onViewportMove,
  });

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
        <ProjectGraphZoomVar target={wrapper} />
        <Background color="var(--border)" gap={20} />
      </ReactFlow>
    </div>
  );
}
