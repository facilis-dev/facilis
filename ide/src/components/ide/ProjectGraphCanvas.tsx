// The project-graph canvas: React Flow over the pure view model. Cards, cluster frames, notes,
// edges and their geometry live in ProjectGraphNodes/ClusterNode/Note/Edge.tsx and the
// graph-edge modules, so this file only maps the view to the library and wires the interactions
// (drag, note placement, double-click source/drill, viewport, fit, edge curves). Nodes are
// controlled locally so a drag follows the pointer; the position commits to the saved layout
// only on drag stop, so the parent cannot reset a drag. Cluster children drag in frame-relative
// coordinates (parentId + extent) and commit absolute ones. fitView padding comes from the
// measured HUD (issue #57); chrome and edges use role tokens (D-043/D-044).

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
import { CLUSTER_NODE_TYPE } from "./ProjectGraphClusterNode";
import { PROJECT_GRAPH_NODE_TYPES, type ProjectFlowNode } from "./ProjectGraphNodes";
import { NOTE_NODE_TYPE } from "./ProjectGraphNote";
import { buildProjectGraphFlowEdges } from "./project-graph-flow-edges";
import { buildProjectGraphFlowNodes, type ProjectGraphDrill } from "./project-graph-flow-nodes";
import { useGraphFitEffects } from "./useGraphFitEffects";
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
  focus,
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
}: {
  view: ProjectGraphView;
  fitPadding: HudFitPadding;
  onInstance: (instance: ReactFlowInstance<ProjectFlowNode, ProjectFlowEdge>) => void;
  notes: readonly GraphNote[];
  addNoteNonce: number;
  viewport: GraphViewport | null;
  fitNonce: number;
  edgeCurves: Readonly<Record<string, GraphCurve>>;
  focus: ProjectGraphFocusState | null;
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
  // function identity: a parent re-render must not rebuild the cards mid-drag. The cluster
  // actions (issue #62) and the note actions follow the same rule.
  const actions = useRef({ onToggleCollapse, onToggleClusterCollapse, onDrillCluster, onCreateNote, onEditNote, onDeleteNote });
  useEffect(() => {
    actions.current = { onToggleCollapse, onToggleClusterCollapse, onDrillCluster, onCreateNote, onEditNote, onDeleteNote };
  }, [onToggleCollapse, onToggleClusterCollapse, onDrillCluster, onCreateNote, onEditNote, onDeleteNote]);
  const toggleCollapse = useCallback((id: string) => actions.current.onToggleCollapse(id), []);
  const toggleClusterCollapse = useCallback((id: string) => actions.current.onToggleClusterCollapse(id), []);
  const drillCluster = useCallback((id: string) => actions.current.onDrillCluster(id), []);
  const createNote = useCallback((position: { x: number; y: number }) => actions.current.onCreateNote(position), []);
  const editNote = useCallback((id: string, text: string) => actions.current.onEditNote(id, text), []);
  const deleteNote = useCallback((id: string) => actions.current.onDeleteNote(id), []);

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
        drill,
        onToggleCollapse: toggleCollapse,
        onToggleClusterCollapse: toggleClusterCollapse,
        onDrillCluster: drillCluster,
        onEditNote: editNote,
        onDeleteNote: deleteNote,
      }),
    [toggleCollapse, toggleClusterCollapse, drillCluster, editNote, deleteNote, selectedNodeId, focus, drill],
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

  useGraphFitEffects(instance, nodes, focus, drill, fitPadding);

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

  const edges = useMemo<ProjectFlowEdge[]>(
    () =>
      buildProjectGraphFlowEdges({
        view,
        edgeCurves,
        selectedEdgeId,
        focus,
        drill,
        onEdgeCurveChange,
      }),
    [view, edgeCurves, selectedEdgeId, focus, drill, onEdgeCurveChange],
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
    if (node.type === NOTE_NODE_TYPE) {
      onMoveNote(node.id, { x: node.position.x, y: node.position.y });
      return;
    }
    // A cluster child drags frame-relative but commits absolute: the saved layout (v3) keeps
    // one coordinate space whether or not grouping is on.
    const frame = view.clusters.find((cluster) => cluster.id === node.parentId);
    const position =
      frame === undefined
        ? { x: node.position.x, y: node.position.y }
        : { x: frame.position.x + node.position.x, y: frame.position.y + node.position.y };
    onMoveNode(node.id, position);
  };
  const onNodeDoubleClick: NodeMouseHandler<ProjectFlowNode> = (_event, node) => {
    // A note opens its own editor from the card; a cluster drills down (issue #62); any other
    // card opens its source file.
    if (node.type === NOTE_NODE_TYPE) return;
    if (node.type === CLUSTER_NODE_TYPE) {
      drillCluster(node.id);
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
