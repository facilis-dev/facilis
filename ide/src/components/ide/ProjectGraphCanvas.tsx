// The project-graph canvas: React Flow over the pure view model. The node cards live in
// ProjectGraphNodes.tsx, the note cards in ProjectGraphNote.tsx, the edges and their pointer
// handling in ProjectGraphEdge.tsx and the geometry in graph-edge-geometry.ts, so this file
// only maps the view to the library and wires the interactions (reactive drag, note placement,
// double-click source, viewport, fit, edge curves).
//
// Nodes are controlled locally so a drag follows the pointer on every move; the final position
// is committed to the saved layout only on drag stop, so the parent cannot reset a drag.
//
// The chrome follows the theme through XYFLOW_THEME_TOKENS (D-044); edge colours are role
// tokens too, never raw palette values (D-043).

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
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
import type { GraphViewport } from "@/facilis/graph-layout";
import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import type { GraphCurve, GraphNote } from "@/facilis/graph-types";
import {
  PROJECT_GRAPH_EDGE_TYPE,
  PROJECT_GRAPH_EDGE_TYPES,
  type ProjectFlowEdge,
} from "./ProjectGraphEdge";
import {
  LINK_SOURCE_HANDLE_ID,
  LINK_TARGET_HANDLE_ID,
  PROJECT_GRAPH_NODE_TYPES,
  type ProjectAnalysisFlowNode,
  type ProjectFlowNode,
} from "./ProjectGraphNodes";
import { NOTE_NODE_TYPE, type ProjectNoteFlowNode } from "./ProjectGraphNote";
import { edgeStyleFor } from "./project-graph-edges";
import { XYFLOW_THEME_TOKENS } from "./xyflow-theme";

export function ProjectGraphCanvas({
  view,
  notes,
  addNoteNonce,
  viewport,
  fitNonce,
  edgeCurves,
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
  notes: readonly GraphNote[];
  addNoteNonce: number;
  viewport: GraphViewport | null;
  fitNonce: number;
  edgeCurves: Readonly<Record<string, GraphCurve>>;
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

  const buildNodes = useCallback(
    (
      next: ProjectGraphView,
      nextNotes: readonly GraphNote[],
      previous: readonly ProjectFlowNode[],
    ): ProjectFlowNode[] => {
      const existing = new Map(previous.map((node) => [node.id, node]));
      const analysis = next.nodes.map((node) => {
        const current = existing.get(node.id);
        const base: ProjectAnalysisFlowNode = {
          id: node.id,
          type: node.kind,
          position: { x: node.position.x, y: node.position.y },
          data: { node, collapsed: node.collapsed, onToggleCollapse: toggleCollapse },
          draggable: true,
          selected: node.id === selectedNodeId,
        };
        if (current === undefined || current.type === NOTE_NODE_TYPE) return base;
        // A drag in flight wins over the saved layout: only the stop commits the position.
        return {
          ...current,
          ...base,
          position: current.dragging === true ? current.position : base.position,
        };
      });
      // Notes are never filtered by the search: an annotation stays put when the analysis is
      // narrowed. They carry no handles, so no edge can end on one.
      const noteNodes = nextNotes.map((note) => {
        const current = existing.get(note.id);
        const base: ProjectNoteFlowNode = {
          id: note.id,
          type: NOTE_NODE_TYPE,
          position: { x: note.x, y: note.y },
          data: { note, onEditNote: editNote, onDeleteNote: deleteNote },
          draggable: true,
        };
        if (current === undefined || current.type !== NOTE_NODE_TYPE) return base;
        return {
          ...current,
          ...base,
          position: current.dragging === true ? current.position : base.position,
        };
      });
      return [...analysis, ...noteNodes];
    },
    [toggleCollapse, editNote, deleteNote, selectedNodeId],
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
    instance.fitView({ padding: 0.15, duration: 200 });
  }, [fitNonce, instance]);

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
      view.edges.map((edge) => {
        const style = edgeStyleFor(edge);
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: LINK_SOURCE_HANDLE_ID,
          targetHandle: LINK_TARGET_HANDLE_ID,
          type: PROJECT_GRAPH_EDGE_TYPE,
          selected: edge.id === selectedEdgeId,
          data: {
            kind: edge.kind,
            ...(edge.access === undefined ? {} : { access: edge.access }),
            curve: edgeCurves[edge.id] ?? null,
            onCurveChange: onEdgeCurveChange,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke, width: 14, height: 14 },
        };
      }),
    [view, edgeCurves, selectedEdgeId, onEdgeCurveChange],
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
  const onMoveStart: OnMoveStart = () => {
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
        onInit={setInstance}
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
        fitViewOptions={{ padding: 0.15 }}
        defaultViewport={viewport === null ? { x: 0, y: 0, zoom: 1 } : viewport}
        nodesConnectable={false}
        zoomOnDoubleClick={false}
        onlyRenderVisibleElements
        minZoom={0.05}
        maxZoom={2}
      >
        <Background color="var(--border)" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
