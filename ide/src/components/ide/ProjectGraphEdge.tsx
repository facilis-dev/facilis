// The project-graph edge: a custom React Flow edge anchored to the cards' nearest ports and
// routed orthogonally around every card (issue #61), whose midpoint handle bends it, and which
// loops back onto its own card for self-edges. Long edges arrive as a bridge spec (issue #65)
// and arc above/below the band with a labelled apex; hover/focus raises one bridge and dims the
// rest. The geometry is pure (graph-ports.ts, graph-edge-routing.ts, graph-edge-bridges.ts);
// this module is the React part — hooks, pointer capture and role tokens (D-043/D-044).

import { useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import {
  BaseEdge,
  useInternalNode,
  useStore,
  useViewport,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
} from "@xyflow/react";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import { t } from "@/i18n";
import {
  bridgeGeometry,
  bridgeLabelFontPx,
  bridgeLabelVisible,
  type BridgeSpec,
} from "@/facilis/graph-bridge-geometry";
import {
  edgeGeometry,
  selfLoopGeometry,
  type EdgeGeometry,
  type Point,
  type Rect,
} from "@/facilis/graph-edge-geometry";
import { bridgeApexLabel, bridgeAriaLabel } from "@/facilis/graph-edge-labels";
import { routeEdge } from "@/facilis/graph-edge-routing";
import type { GraphCurve } from "@/facilis/graph-types";
import { ProjectGraphBridgeLabel } from "./ProjectGraphBridgeLabel";
import { obstacleRects, rectFor, type MeasuredNode } from "./project-graph-edge-rects";
import { BRIDGE_DIM_OPACITY, edgeStyleFor } from "./project-graph-edges";
import type { ProjectFlowNode } from "./ProjectGraphNodes";

/** The one custom edge type; registered at module scope by the canvas. */
export const PROJECT_GRAPH_EDGE_TYPE = "project-graph-edge";

export type ProjectGraphEdgeData = {
  readonly kind: GraphEdgeKind;
  readonly access?: "elevated";
  /** False when an AI focus request (D-171) names other edges: the edge is drawn faint. */
  readonly focused?: boolean;
  readonly curve: GraphCurve | null;
  readonly onCurveChange: (edgeId: string, curve: GraphCurve | null) => void;
  /** The bridge spec when this edge arcs over the band (issue #65); absent = orthogonal. */
  readonly bridge?: BridgeSpec | null;
  /** True while another bridge is hovered/focused: this one dims (hover isolation). */
  readonly bridgeDimmed?: boolean;
  readonly onBridgeHover?: (edgeId: string | null) => void;
};

export type ProjectFlowEdge = Edge<ProjectGraphEdgeData, typeof PROJECT_GRAPH_EDGE_TYPE>;

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
  const sourceRect = rectFor(sourceNode);
  if (sourceRect === null) return fallback;
  if (source === target) return selfLoopGeometry(sourceRect, curve);
  const targetRect = rectFor(targetNode);
  if (targetRect === null) return fallback;
  return routeEdge(sourceRect, targetRect, { obstacles, curve });
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
  const nodeLookup = useStore((store) => store.nodeLookup);
  const { zoom } = useViewport();
  const [draft, setDraft] = useState<GraphCurve | null>(null);
  const [hovered, setHovered] = useState(false);
  const drag = useRef<DragState | null>(null);

  const kind: GraphEdgeKind = data?.kind ?? "relation";
  const curve = draft ?? data?.curve ?? null;
  // A saved or in-progress curve unbundles the edge: explicit user intent wins (issue #65).
  const bridge = curve === null ? (data?.bridge ?? null) : null;
  const geometry =
    bridge !== null
      ? bridgeGeometry(bridge)
      : resolveGeometry(
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
  const dimmed = bridge !== null && data?.bridgeDimmed === true;
  const apexLabel = bridge !== null ? bridgeApexLabel({ label: bridge.label, kind }) : null;
  const pathStyle: CSSProperties = {
    stroke: edgeStyle.stroke,
    strokeWidth: highlighted ? 2.5 : 1.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    // Focus and bridge isolation dim with opacity, not a colour: the theme still owns the
    // stroke (D-043).
    ...(data?.focused === false || dimmed ? { opacity: BRIDGE_DIM_OPACITY } : {}),
    ...(edgeStyle.dashed ? { strokeDasharray: "5 3" } : {}),
  };
  // Hover and keyboard focus do the same thing: raise this bridge, dim the rest (issue #65).
  const raiseBridge = () => {
    setHovered(true);
    if (bridge !== null) data?.onBridgeHover?.(id);
  };
  const lowerBridge = () => {
    setHovered(false);
    if (bridge !== null) data?.onBridgeHover?.(null);
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
    setDraft(pointFromEvent(event, state, zoom));
  };
  const onHandlePointerUp = (event: PointerEvent<SVGCircleElement>) => {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    event.stopPropagation();
    drag.current = null;
    data?.onCurveChange(id, pointFromEvent(event, state, zoom));
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
    <g onMouseEnter={raiseBridge} onMouseLeave={lowerBridge}>
      <BaseEdge
        path={geometry.path}
        markerEnd={markerEnd}
        style={pathStyle}
        interactionWidth={24}
        {...(bridge !== null && apexLabel !== null
          ? {
              // The path itself is the focusable, announced mark: the apex text is decorative.
              tabIndex: 0,
              role: "img",
              "aria-label": bridgeAriaLabel(apexLabel),
              className: "outline-none",
              onFocus: raiseBridge,
              onBlur: lowerBridge,
            }
          : {})}
      />
      {bridge !== null && apexLabel !== null ? (
        <ProjectGraphBridgeLabel
          apex={bridge.apex}
          label={apexLabel}
          fontPx={bridgeLabelFontPx(zoom, highlighted)}
          visible={bridgeLabelVisible(zoom) || highlighted}
          dimmed={dimmed}
        />
      ) : null}
      {selected === true && data !== undefined ? (
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
