// The project-graph canvas: React Flow over the pure view model. Cards, notes, edges and their
// geometry live in ProjectGraphNodes/Note/Edge.tsx and graph-edge-geometry.ts, so this file only
// maps the view to the library and wires the interactions (drag, note placement, double-click
// source, viewport, fit, edge curves). Nodes are controlled locally so a drag follows the pointer;
// the position commits to the saved layout only on drag stop, so the parent cannot reset a drag.
// fitView padding comes from the measured HUD (issue #57); chrome and edges use role tokens
// (XYFLOW_THEME_TOKENS, D-043/D-044), never raw palette values.

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  ReactFlow,
  applyNodeChanges,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type OnMoveEnd,
  type OnMoveStart,
  type OnNodeDrag,
  type OnNodesChange,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import { toFlowPadding, type HudFitPadding } from "@/facilis/graph-hud-padding";
import type { GraphViewport } from "@/facilis/graph-layout";
import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import type { GraphCurve, GraphNote } from "@/facilis/graph-types";
import { PROJECT_GRAPH_EDGE_TYPES, type ProjectFlowEdge } from "./ProjectGraphEdge";
import { PROJECT_GRAPH_NODE_TYPES, type ProjectFlowNode } from "./ProjectGraphNodes";
import { NOTE_NODE_TYPE } from "./ProjectGraphNote";
import { buildProjectGraphFlowEdges } from "./project-graph-flow-edges";
import { buildProjectGraphFlowNodes } from "./project-graph-flow-nodes";
import { useProjectGraphBridgePlan } from "./useProjectGraphBridgePlan";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";
import { XYFLOW_THEME_TOKENS } from "./xyflow-theme";

export function ProjectGraphCanvas({
  view,
  fitPadding,
  onInstance,
  notes,
  addNoteNonce,
  viewport,
  fitNonce,
  edgeCurves,
  bridges,
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
}: {
  view: ProjectGraphView;
  fitPadding: HudFitPadding;
  onInstance: (instance: ReactFlowInstance<ProjectFlowNode, ProjectFlowEdge>) => void;
  notes: readonly GraphNote[];
  addNoteNonce: number;
  viewport: GraphViewport | null;
  fitNonce: number;
  edgeCurves: Readonly<Record<string, GraphCurve>>;
  /** The bridges lens (issue #65): false restores every orthogonal route. */
  bridges: boolean;
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
}) {
  const [instance, setInstance] = useState<ReactFlowInstance<
    ProjectFlowNode,
    ProjectFlowEdge
  > | null>(null);
  // Edge selection is local: it drives only the curve handle, so it never enters the saved
  // layout and cannot fight the parent's `view` round-trip.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const moved = useRef(false);

  // The collapse callback travels through a ref so node data does not depend on the parent's
  // function identity: a parent re-render must not rebuild the cards mid-drag.
  const onToggleCollapseRef = useRef(onToggleCollapse);
  useEffect(() => {
    onToggleCollapseRef.current = onToggleCollapse;
  }, [onToggleCollapse]);
  const toggleCollapse = useCallback((id: string) => {
    onToggleCollapseRef.current(id);
  }, []);
  // Same reasoning for the note actions: the note card holds its editor state, so a changed
  // function identity would rebuild its data and could interrupt a drag or an edit.
  const noteActions = useRef({ onCreateNote, onEditNote, onDeleteNote });
  useEffect(() => {
    noteActions.current = { onCreateNote, onEditNote, onDeleteNote };
  }, [onCreateNote, onEditNote, onDeleteNote]);
  const createNote = useCallback((position: { x: number; y: number }) => {
    noteActions.current.onCreateNote(position);
  }, []);
  const editNote = useCallback((id: string, text: string) => {
    noteActions.current.onEditNote(id, text);
  }, []);
  const deleteNote = useCallback((id: string) => {
    noteActions.current.onDeleteNote(id);
  }, []);

  // The mapping itself lives in project-graph-flow-nodes: this file keeps the React Flow wiring.
  const buildNodes = useCallback(
    (
      next: ProjectGraphView,
      nextNotes: readonly GraphNote[],
      previous: readonly ProjectFlowNode[],
    ): ProjectFlowNode[] =>
      buildProjectGraphFlowNodes({
        view: next,
        notes: nextNotes,
        previous,
        selectedNodeId,
        focus,
        onToggleCollapse: toggleCollapse,
        onEditNote: editNote,
        onDeleteNote: deleteNote,
      }),
    [toggleCollapse, editNote, deleteNote, selectedNodeId, focus],
  );

  const [nodes, setNodes] = useState<ProjectFlowNode[]>(() => buildNodes(view, notes, []));

  // The view is the saved layout plus the analysis; re-sync on every change but keep a drag.
  useEffect(() => {
    setNodes((current) => buildNodes(view, notes, current));
  }, [view, notes, buildNodes]);

  const onNodesChange: OnNodesChange<ProjectFlowNode> = useCallback((changes) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  // The fit button and the initial layout both live above this component; only an explicit
  // request (fitNonce > 0) refits, so a refresh does not throw away a saved viewport.
  useEffect(() => {
    if (instance === null || fitNonce <= 0) return;
    instance.fitView({ padding: toFlowPadding(fitPadding), duration: 200 });
  }, [fitNonce, instance, fitPadding]);

  // A focus request names nodes that must exist in state before fitView can frame them, so the
  // effect waits for React Flow's instance and for the rebuilt node list. The ref keeps a drag
  // from refitting: `nodes` is a dependency only so a request made mid-build lands on a later
  // pass, not on every pointer move.
  const fittedFocus = useRef<ProjectGraphFocusState | null>(null);
  useEffect(() => {
    if (instance === null || focus === null || !focus.zoom) return;
    if (fittedFocus.current === focus) return;
    const targets = nodes
      .filter((node) => focus.nodeIds.has(node.id))
      .map((node) => ({ id: node.id }));
    if (targets.length === 0) return;
    fittedFocus.current = focus;
    void instance.fitView({ nodes: targets, padding: toFlowPadding(fitPadding), duration: 200 });
  }, [focus, instance, nodes, fitPadding]);

  // Adding a note is an event, not state: only a nonce change creates one, so a click made
  // while the canvas is not rendered cannot materialize a note on the next mount. The panel
  // only increments the nonce; the flow position of the viewport centre is computed here.
  const lastAddNonce = useRef(addNoteNonce);
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (addNoteNonce === lastAddNonce.current || instance === null) return;
    const element = wrapper.current;
    if (element === null) return;
    lastAddNonce.current = addNoteNonce;
    const rect = element.getBoundingClientRect();
    createNote(
      instance.screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      }),
    );
  }, [addNoteNonce, instance, createNote]);

  // Hover isolation is canvas state: one raised bridge dims every other (issue #65). It rides
  // on edge data like the focus dimming, so the edge component stays a pure renderer.
  const [hoveredBridgeId, setHoveredBridgeId] = useState<string | null>(null);
  const onBridgeHover = useCallback((edgeId: string | null) => setHoveredBridgeId(edgeId), []);

  // One plan for the whole graph, rebuilt from the live nodes so a drag replans (issue #65).
  const bridgePlan = useProjectGraphBridgePlan(nodes, view.edges, edgeCurves, bridges);

  const edges = useMemo<ProjectFlowEdge[]>(
    () =>
      buildProjectGraphFlowEdges({
        edges: view.edges,
        edgeCurves,
        selectedEdgeId,
        focus,
        bridges: bridgePlan,
        hoveredBridgeId,
        onCurveChange: onEdgeCurveChange,
        onBridgeHover,
      }),
    [
      view.edges,
      edgeCurves,
      selectedEdgeId,
      focus,
      bridgePlan,
      hoveredBridgeId,
      onEdgeCurveChange,
      onBridgeHover,
    ],
  );

  const onEdgeClick: EdgeMouseHandler<ProjectFlowEdge> = (_event, edge) => {
    setSelectedEdgeId(edge.id);
    onSelectNode(null);
  };
  const onNodeClick: NodeMouseHandler<ProjectFlowNode> = (_event, node) => {
    setSelectedEdgeId(null);
    onSelectNode(node.type === NOTE_NODE_TYPE ? null : node.id);
  };
  const onNodeDragStop: OnNodeDrag<ProjectFlowNode> = (_event, node) => {
    const position = { x: node.position.x, y: node.position.y };
    if (node.type === NOTE_NODE_TYPE) onMoveNote(node.id, position);
    else onMoveNode(node.id, position);
  };
  const onNodeDoubleClick: NodeMouseHandler<ProjectFlowNode> = (_event, node) => {
    // A note opens its own editor from the card; it has no source file to open.
    if (node.type === NOTE_NODE_TYPE) return;
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
      // opts back in with select-text.
      style={{ userSelect: "none" }}
      className={"h-full min-h-0 " + XYFLOW_THEME_TOKENS}
    >
      <ReactFlow<ProjectFlowNode, ProjectFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={PROJECT_GRAPH_NODE_TYPES}
        edgeTypes={PROJECT_GRAPH_EDGE_TYPES}
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
