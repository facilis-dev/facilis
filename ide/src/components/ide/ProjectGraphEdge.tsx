// The project-graph edge: a custom React Flow edge anchored to the cards' nearest ports and
// routed orthogonally around every card (issue #61), whose midpoint handle bends it, and which
// loops back onto its own card for self-edges. The geometry is pure (graph-ports.ts,
// graph-edge-routing.ts); this module is the React part — the internal-node hooks, pointer
// capture and the theme role tokens (D-043/D-044).

import { useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import {
  BaseEdge,
  useInternalNode,
  useStore,
  useStoreApi,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
} from "@xyflow/react";
import type { GraphEdgeKind, GraphNodeKind } from "@facilis.dev/analyze";
import { GRAPH_NODE_SIZES } from "@/facilis/graph-node-size";
import { t } from "@/i18n";
import {
  edgeGeometry,
  nodeRect,
  selfLoopGeometry,
  type EdgeGeometry,
  type Point,
  type Rect,
} from "@/facilis/graph-edge-geometry";
import { routeEdge } from "@/facilis/graph-edge-routing";
import type { GraphCurve } from "@/facilis/graph-types";
import { curveFromPointer, type EdgeCurveDragState } from "./project-graph-edge-drag";
import { edgeStyleFor } from "./project-graph-edges";
import type { ProjectFlowNode } from "./ProjectGraphNodes";
import { useGraphLod } from "./use-graph-lod";

/** The one custom edge type; registered at module scope by the canvas. */
export const PROJECT_GRAPH_EDGE_TYPE = "project-graph-edge";

export type ProjectGraphEdgeData = {
  readonly kind: GraphEdgeKind;
  readonly access?: "elevated";
  /** True when the user focus (issue #66) closes over other edges: drawn at 12%. */
  readonly userDimmed?: boolean;
  /** True when the AI focus (D-171) names this edge: the brand halo channel, never a dim. */
  readonly aiOutlined?: boolean;
  /** True when edge-kind isolation (issue #63) names other kinds: the edge is drawn at 10%. */
  readonly dimmed?: boolean;
  readonly curve: GraphCurve | null;
  readonly onCurveChange: (edgeId: string, curve: GraphCurve | null) => void;
};

export type ProjectFlowEdge = Edge<ProjectGraphEdgeData, typeof PROJECT_GRAPH_EDGE_TYPE>;

/** The structural shape a rect needs: an endpoint hook result or a nodeLookup entry. */
interface MeasuredNode {
  readonly type?: string;
  readonly internals: { readonly positionAbsolute: Point };
  readonly measured?: { readonly width?: number; readonly height?: number };
  readonly width?: number;
  readonly height?: number;
}

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

/** The card rect edges anchor to; shared with the cubic details connector (#59, F.1). */
export function internalNodeRect(node: MeasuredNode | undefined): Rect | null {
  if (node === undefined) return null;
  const fallback = cardFallbackSize(node.type);
  return nodeRect(
    node.internals.positionAbsolute,
    node.measured?.width ?? node.width ?? fallback.width,
    node.measured?.height ?? node.height ?? fallback.height,
  );
}

/**
 * One rect list per nodeLookup identity, shared by every edge: a drag or a viewport tick must
 * not rebuild N rects per edge. The lookup is replaced whenever nodes change, so the cache
 * cannot serve stale geometry. Satellite and pinned details cards are nodes in the lookup too,
 * so analysis edges never route across an open details card.
 */
const obstacleCache = new WeakMap<object, readonly Rect[]>();

function obstacleRects(nodeLookup: ReadonlyMap<string, MeasuredNode>): readonly Rect[] {
  const cached = obstacleCache.get(nodeLookup);
  if (cached !== undefined) return cached;
  const rects: Rect[] = [];
  for (const node of nodeLookup.values()) {
    const rect = internalNodeRect(node);
    if (rect !== null) rects.push(rect);
  }
  obstacleCache.set(nodeLookup, rects);
  return rects;
}

function resolveGeometry(
  sourceNode: MeasuredNode | undefined,
  targetNode: MeasuredNode | undefined,
  source: string,
  target: string,
  positions: { sourceX: number; sourceY: number; targetX: number; targetY: number },
  curve: GraphCurve | null,
  obstacles: readonly Rect[],
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
  return routeEdge(sourceRect, targetRect, { obstacles, curve });
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
  const nodeLookup = useStore((store) => store.nodeLookup);
  // The level, not the raw zoom: a zoom gesture re-renders the edge only at a threshold. The
  // drag math reads the live zoom from the store on demand instead of subscribing per frame.
  const level = useGraphLod();
  const store = useStoreApi();
  const [draft, setDraft] = useState<GraphCurve | null>(null);
  const [hovered, setHovered] = useState(false);
  const drag = useRef<EdgeCurveDragState | null>(null);

  const kind: GraphEdgeKind = data?.kind ?? "relation";
  const curve = draft ?? data?.curve ?? null;
  const geometry = resolveGeometry(
    sourceNode,
    targetNode,
    source,
    target,
    { sourceX, sourceY, targetX, targetY },
    curve,
    obstacleRects(nodeLookup),
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
    // Isolation (issue #63) dims to 10%, the user focus (issue #66) to 12%; the stronger dim
    // wins so the two never stack into an invisible line. Opacity, not colour: the theme still
    // owns the stroke. The AI focus no longer dims — it halos below (aiOutlined).
    ...(data?.dimmed === true
      ? { opacity: 0.1 }
      : data?.userDimmed === true
        ? { opacity: 0.12 }
        : {}),
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
    setDraft(curveFromPointer(event, state, store.getState().transform[2]));
  };
  const onHandlePointerUp = (event: PointerEvent<SVGCircleElement>) => {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    event.stopPropagation();
    drag.current = null;
    data?.onCurveChange(id, curveFromPointer(event, state, store.getState().transform[2]));
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
      {/* The AI focus channel (D-171, issue #66): a brand halo under the kind-coloured stroke,
          visible even when the user focus dims the edge — the two channels compose. */}
      {data?.aiOutlined === true ? (
        <path
          d={geometry.path}
          fill="none"
          stroke="var(--brand)"
          strokeWidth={5}
          strokeLinecap="round"
          opacity={0.45}
          style={{ pointerEvents: "none" }}
        />
      ) : null}
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
