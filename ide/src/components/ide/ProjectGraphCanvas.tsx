// The project-graph canvas: React Flow over the pure view model. The node cards live in
// ProjectGraphNodes.tsx and the geometry in graph-model.ts, so this file only maps the view
// to the library and wires the interactions (drag, double-click source, viewport, fit).
//
// The chrome follows the theme through XYFLOW_THEME_TOKENS (D-044); edge colours are role
// tokens too, never raw palette values (D-043).

import "@xyflow/react/dist/style.css";
import { useEffect, useRef, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type NodeMouseHandler,
  type OnMoveEnd,
  type OnMoveStart,
  type OnNodeDrag,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import type { GraphViewport } from "@/facilis/graph-layout";
import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import { PROJECT_GRAPH_NODE_TYPES, type ProjectFlowNode } from "./ProjectGraphNodes";
import { GRAPH_EDGE_STYLES } from "./project-graph-edges";
import { XYFLOW_THEME_TOKENS } from "./xyflow-theme";

export function ProjectGraphCanvas({
  view,
  viewport,
  fitNonce,
  onMoveNode,
  onToggleCollapse,
  onOpenNode,
  onViewportChange,
}: {
  view: ProjectGraphView;
  viewport: GraphViewport | null;
  fitNonce: number;
  onMoveNode: (id: string, position: { x: number; y: number }) => void;
  onToggleCollapse: (id: string) => void;
  onOpenNode: (node: ProjectGraphNode) => void;
  onViewportChange: (viewport: GraphViewport) => void;
}) {
  const [instance, setInstance] = useState<ReactFlowInstance<ProjectFlowNode, Edge> | null>(null);
  const moved = useRef(false);

  // The fit button and the initial layout both live above this component; only an explicit
  // request (fitNonce > 0) refits, so a refresh does not throw away a saved viewport.
  useEffect(() => {
    if (instance === null || fitNonce <= 0) return;
    instance.fitView({ padding: 0.15, duration: 200 });
  }, [fitNonce, instance]);

  const nodes: ProjectFlowNode[] = view.nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: node.position,
    data: { node, collapsed: node.collapsed, onToggleCollapse },
    draggable: true,
  }));

  const edges: Edge[] = view.edges.map((edge) => {
    const style = GRAPH_EDGE_STYLES[edge.kind];
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      style: {
        stroke: style.stroke,
        strokeWidth: 1.5,
        ...(style.dashed ? { strokeDasharray: "5 3" } : {}),
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke, width: 14, height: 14 },
    };
  });

  const onNodeDragStop: OnNodeDrag<ProjectFlowNode> = (_event, node) => {
    onMoveNode(node.id, { x: node.position.x, y: node.position.y });
  };
  const onNodeDoubleClick: NodeMouseHandler<ProjectFlowNode> = (_event, node) => {
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
    <div data-testid="project-graph-canvas" className={"h-full min-h-0 " + XYFLOW_THEME_TOKENS}>
      <ReactFlow<ProjectFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={PROJECT_GRAPH_NODE_TYPES}
        onInit={setInstance}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={onNodeDoubleClick}
        onMoveStart={onMoveStart}
        onMoveEnd={onMoveEnd}
        fitView={viewport === null}
        fitViewOptions={{ padding: 0.15 }}
        defaultViewport={viewport === null ? { x: 0, y: 0, zoom: 1 } : viewport}
        nodesConnectable={false}
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
