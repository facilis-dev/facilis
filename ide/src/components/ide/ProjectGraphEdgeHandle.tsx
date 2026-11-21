// The edge's bend handle (issue #61), extracted from ProjectGraphEdge when the bridge chrome
// landed (issue #65) so the edge keeps only the rendering decisions under the 300-line limit:
// pointer capture, the draft curve and the grab target. The draft travels up so the edge
// geometry follows the in-progress bend; a released drag saves the curve, which unbundles a
// bridge — explicit user intent wins over the automatic arc.

import { useRef, type MouseEvent, type PointerEvent } from "react";
import { useStoreApi } from "@xyflow/react";
import { t } from "@/i18n";
import type { Point } from "@/facilis/graph-edge-geometry";
import type { GraphCurve } from "@/facilis/graph-types";
import { curveFromPointer, type EdgeCurveDragState } from "./project-graph-edge-drag";

export function ProjectGraphEdgeHandle({
  edgeId,
  midpoint,
  stroke,
  baseCurve,
  onCurveChange,
  onDraft,
}: {
  readonly edgeId: string;
  readonly midpoint: Point;
  readonly stroke: string;
  readonly baseCurve: GraphCurve | null;
  readonly onCurveChange: (edgeId: string, curve: GraphCurve | null) => void;
  readonly onDraft: (curve: GraphCurve | null) => void;
}) {
  const store = useStoreApi();
  const drag = useRef<EdgeCurveDragState | null>(null);

  const onHandlePointerDown = (event: PointerEvent<SVGCircleElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const base = baseCurve ?? { x: 0, y: 0 };
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      base,
    };
    onDraft(base);
  };
  const onHandlePointerMove = (event: PointerEvent<SVGCircleElement>) => {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    event.stopPropagation();
    onDraft(curveFromPointer(event, state, store.getState().transform[2]));
  };
  const onHandlePointerUp = (event: PointerEvent<SVGCircleElement>) => {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    event.stopPropagation();
    drag.current = null;
    onCurveChange(edgeId, curveFromPointer(event, state, store.getState().transform[2]));
    onDraft(null);
  };
  const onHandlePointerCancel = () => {
    drag.current = null;
    onDraft(null);
  };
  const onHandleDoubleClick = (event: MouseEvent<SVGCircleElement>) => {
    event.stopPropagation();
    onCurveChange(edgeId, null);
    onDraft(null);
  };

  return (
    <g className="cursor-grab active:cursor-grabbing">
      <title>{t("projectGraph.curveHint")}</title>
      {/* Invisible hit target: a 5px dot is too small to grab at a fitted zoom. */}
      <circle
        className="nodrag nopan touch-none"
        cx={midpoint.x}
        cy={midpoint.y}
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
        cx={midpoint.x}
        cy={midpoint.y}
        r={5}
        fill="var(--background)"
        stroke={stroke}
        strokeWidth={1.5}
        className="pointer-events-none"
      />
    </g>
  );
}
