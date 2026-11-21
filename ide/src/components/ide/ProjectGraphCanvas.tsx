// The project-graph canvas: React Flow over the pure view model. Cards, edges, the satellite,
// the interactions and the effects live in their own modules; this file wires the library.

import "@xyflow/react/dist/style.css";
import { useMemo, useRef, useState, type Dispatch } from "react";
import { Background, ReactFlow, type ReactFlowInstance } from "@xyflow/react";
import { toFlowPadding, type HudFitPadding } from "@/facilis/graph-hud-padding";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { ImpactOverlay } from "@/facilis/graph-impact";
import type { GraphViewport } from "@/facilis/graph-layout";
import type { NodeDetails } from "@/facilis/graph-details";
import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import type { GraphReachability } from "@/facilis/graph-reachability";
import type { PinnedDetailsAction, PinnedDetailsCard } from "@/facilis/graph-satellite";
import type { GraphCurve, GraphNote } from "@/facilis/graph-types";
import type { GraphEdgeConcentration } from "@/facilis/graph-view-state";
import type { TurnOverlay } from "@/facilis/graph-turn-diff";
import { PROJECT_GRAPH_EDGE_TYPES } from "./ProjectGraphEdge";
import {
  DETAILS_LINK_EDGE_TYPE,
  ProjectGraphDetailsLinkEdge,
  type ProjectCanvasEdge,
} from "./ProjectGraphDetailsLinkEdge";
import { PROJECT_GRAPH_NODE_TYPES, type ProjectFlowNode } from "./ProjectGraphNodes";
import { ProjectGraphZoomVar } from "./ProjectGraphZoomVar";
import type {
  ProjectFlowContractState,
  ProjectFlowDataState,
  ProjectGraphDrill,
} from "./project-graph-flow-nodes";
import { useProjectGraphEdges } from "./useProjectGraphEdges";
import { useGraphFitEffects } from "./useGraphFitEffects";
import { useProjectGraphCanvasEffects } from "./useProjectGraphCanvasEffects";
import { useProjectGraphDetails, type PinRequest } from "./useProjectGraphDetails";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";
import { useProjectGraphHubs } from "./useProjectGraphHubs";
import { useProjectGraphInteractions } from "./use-project-graph-interactions";
import { useProjectGraphStableActions } from "./useProjectGraphStableActions";
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
  data,
  turn,
  impact,
  drill,
  selectedNodeId,
  onSelectNode,
  onMoveNode,
  onToggleCollapse,
  onToggleClusterCollapse,
  onDrillCluster,
  onOpenNode,
  onViewportChange,
  onViewportLive,
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
  /** The contract lens (issue #69): audit dimming + the diagnostics join. */
  contract: ProjectFlowContractState;
  /** The data lens (issue #70): marks and schema strokes, never a position change. */
  data: ProjectFlowDataState;
  /** The agent/impact lens overlays (#73/#74): marks and dimming, never positions. */
  turn: TurnOverlay | null;
  impact: ImpactOverlay | null;
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
  /** Live viewport during any move (issue #68): the minimap reflects it before the commit. */
  onViewportLive?: (viewport: GraphViewport) => void;
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
  // Edge selection is local: it drives the curve handle, never the saved layout.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  // Hub expansion and hover are session-scoped (issue #64); only the threshold is URL state.
  const hubs = useProjectGraphHubs(view, concentration);
  // Ref-stabilized card actions: a parent re-render cannot rebuild a card mid-drag.
  const { toggleCollapse, createNote, editNote, deleteNote } = useProjectGraphStableActions(
    onToggleCollapse,
    onCreateNote,
    onEditNote,
    onDeleteNote,
  );

  const { nodes, onNodesChange, onViewportMove, activeAnchorId, movePinned } =
    useProjectGraphDetails({
      view,
      notes,
      focus,
      userFocus,
      isolatedEdgeKinds,
      contract,
      data,
      turn,
      impact,
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
  // The AI-focus and drill fits compose with the canvas effects on the same instance.
  useGraphFitEffects(instance, nodes, focus, drill, fitPadding);

  // The edge list owns the bridge plan and its hover isolation (#65); the satellite stays cubic.
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
    data,
    turn,
    impact,
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
    onViewportLive,
  });

  return (
    <div
      ref={wrapper}
      data-testid="project-graph-canvas"
      // A drag or box-select must not paint card text as selected; note/details opt back in.
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
