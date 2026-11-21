// The project-graph edge: a custom React Flow edge whose endpoints float on the node cards'
// borders in every direction, whose midpoint handle bends it, and which loops back onto its own
// card for self-edges. The geometry is pure (graph-edge-geometry.ts); this module is the React
// part — the internal-node hooks, pointer capture and the theme role tokens (D-043/D-044).

import { useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import {
  BaseEdge,
  useInternalNode,
  useStoreApi,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type InternalNode,
} from "@xyflow/react";
import type { GraphEdgeKind, GraphNodeKind } from "@facilis.dev/analyze";
import { GRAPH_NODE_SIZES } from "@/facilis/graph-node-size";
import { t } from "@/i18n";
import {
  EDGE_ENDPOINT_GAP,
  edgeGeometry,
  floatingAnchors,
  nodeRect,
  selfLoopGeometry,
  type EdgeGeometry,
  type Point,
  type Rect,
} from "@/facilis/graph-edge-geometry";
import type { GraphCurve } from "@/facilis/graph-types";
import { edgeStyleFor } from "./project-graph-edges";
import type { ProjectFlowNode } from "./ProjectGraphNodes";
import { useGraphLod } from "./use-graph-lod";

/** The one custom edge type; registered at module scope by the canvas. */
export const PROJECT_GRAPH_EDGE_TYPE = "project-graph-edge";

export type ProjectGraphEdgeData = {
  readonly kind: GraphEdgeKind;
  readonly access?: "elevated";
  /** False when an AI focus request (D-171) names other edges: the edge is drawn faint. */
  readonly focused?: boolean;
  readonly curve: GraphCurve | null;
  readonly onCurveChange: (edgeId: string, curve: GraphCurve | null) => void;
};

export type ProjectFlowEdge = Edge<ProjectGraphEdgeData, typeof PROJECT_GRAPH_EDGE_TYPE>;

type InternalProjectNode = InternalNode<ProjectFlowNode>;

/** The shared full-card footprints (graph-node-size.ts), used before React Flow measures. */
const DEFAULT_SIZE = { width: 220, height: 48 };

/** Card sizes before measurement; shared with the satellite placement (issue #59). */
export function cardFallbackSize(type: string | undefined): {
  readonly width: number;
  readonly height: number;
} {
  // The node type is the kind string for analysis cards; notes fall back to the default.
  if (type !== undefined && type in GRAPH_NODE_SIZES)
    return GRAPH_NODE_SIZES[type as GraphNodeKind];
  return DEFAULT_SIZE;
}

/** The card rect the floating edges anchor to; shared with the details connector (#59). */
export function internalNodeRect(node: InternalProjectNode | undefined): Rect | null {
  if (node === undefined) return null;
  const fallback = cardFallbackSize(node.type);
  return nodeRect(
    node.internals.positionAbsolute,
    node.measured.width ?? node.width ?? fallback.width,
    node.measured.height ?? node.height ?? fallback.height,
  );
}

function resolveGeometry(
  sourceNode: InternalProjectNode | undefined,
  targetNode: InternalProjectNode | undefined,
  source: string,
  target: string,
  positions: { sourceX: number; sourceY: number; targetX: number; targetY: number },
  curve: GraphCurve | null,
): EdgeGeometry {
  const fallback: EdgeGeometry = edgeGeometry(
    {
      source: { x: positions.sourceX, y: positions.sourceY },
      target: { x: positions.targetX, y: positions.targetY },
    },
    curve,
  );
  const sourceRect = internalNodeRect(sourceNode);
  if (sourceRect === null) return fallback;
  if (source === target) return selfLoopGeometry(sourceRect, curve);
  const targetRect = internalNodeRect(targetNode);
  if (targetRect === null) return fallback;
  return edgeGeometry(floatingAnchors(sourceRect, targetRect, EDGE_ENDPOINT_GAP), curve);
}

interface DragState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly base: Point;
}

function pointFromEvent(
  event: PointerEvent<SVGCircleElement>,
  state: DragState,
  zoom: number,
): GraphCurve {
  const scale = zoom === 0 ? 1 : zoom;
  return {
    x: state.base.x + (event.clientX - state.startX) / scale,
    y: state.base.y + (event.clientY - state.startY) / scale,
  };
}

export function ProjectGraphEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  selected,
  markerEnd,
  data,
}: EdgeProps<ProjectFlowEdge>) {
  const sourceNode = useInternalNode<ProjectFlowNode>(source);
  const targetNode = useInternalNode<ProjectFlowNode>(target);
  // The level, not the raw zoom: a zoom gesture re-renders the edge only at a threshold. The
  // drag math reads the live zoom from the store on demand instead of subscribing per frame.
  const level = useGraphLod();
  const store = useStoreApi();
  const [draft, setDraft] = useState<GraphCurve | null>(null);
  const [hovered, setHovered] = useState(false);
  const drag = useRef<DragState | null>(null);

  const kind: GraphEdgeKind = data?.kind ?? "relation";
  const curve = draft ?? data?.curve ?? null;
  const geometry = resolveGeometry(
    sourceNode,
    targetNode,
    source,
    target,
    { sourceX, sourceY, targetX, targetY },
    curve,
  );
  const edgeStyle = edgeStyleFor({
    kind,
    ...(data?.access === undefined ? {} : { access: data.access }),
  });
  const highlighted = selected === true || hovered;
  const pathStyle: CSSProperties = {
    stroke: edgeStyle.stroke,
    // Chip simplification (issue #60): thinner strokes; labels are never drawn on the canvas
    // (the model's edge label lives in the inspector) and bend handles are suppressed below.
    strokeWidth: level === "chip" ? 1 : highlighted ? 2.5 : 1.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    // Focus dims the edges it does not name with opacity, not a colour: the theme still owns
    // the stroke (D-043).
    ...(data?.focused === false ? { opacity: 0.25 } : {}),
    ...(edgeStyle.dashed ? { strokeDasharray: "5 3" } : {}),
  };

  const onHandlePointerDown = (event: PointerEvent<SVGCircleElement>) => {
    if (data === undefined) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const base = data.curve ?? { x: 0, y: 0 };
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      base,
    };
    setDraft(base);
  };
  const onHandlePointerMove = (event: PointerEvent<SVGCircleElement>) => {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    event.stopPropagation();
    setDraft(pointFromEvent(event, state, store.getState().transform[2]));
  };
  const onHandlePointerUp = (event: PointerEvent<SVGCircleElement>) => {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    event.stopPropagation();
    drag.current = null;
    data?.onCurveChange(id, pointFromEvent(event, state, store.getState().transform[2]));
    setDraft(null);
  };
  const onHandlePointerCancel = () => {
    drag.current = null;
    setDraft(null);
  };
  const onHandleDoubleClick = (event: MouseEvent<SVGCircleElement>) => {
    event.stopPropagation();
    data?.onCurveChange(id, null);
    setDraft(null);
  };

  return (
    <g
      data-lod={level}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <BaseEdge
        path={geometry.path}
        markerEnd={markerEnd}
        style={pathStyle}
        interactionWidth={24}
      />
      {/* No bend handles at chip (criterion 5): the edge stays clickable, just not bendable. */}
      {level !== "chip" && selected === true && data !== undefined ? (
        <g className="cursor-grab active:cursor-grabbing">
          <title>{t("projectGraph.curveHint")}</title>
          {/* Invisible hit target: a 5px dot is too small to grab at a fitted zoom. */}
          <circle
            className="nodrag nopan touch-none"
            cx={geometry.midpoint.x}
            cy={geometry.midpoint.y}
            r={14}
            fill="transparent"
            stroke="none"
            style={{ pointerEvents: "all" }}
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerCancel}
            onDoubleClick={onHandleDoubleClick}
          />
          <circle
            cx={geometry.midpoint.x}
            cy={geometry.midpoint.y}
            r={5}
            fill="var(--background)"
            stroke={edgeStyle.stroke}
            strokeWidth={1.5}
            className="pointer-events-none"
          />
        </g>
      ) : null}
    </g>
  );
}

export const PROJECT_GRAPH_EDGE_TYPES: EdgeTypes = {
  "project-graph-edge": ProjectGraphEdge,
};
