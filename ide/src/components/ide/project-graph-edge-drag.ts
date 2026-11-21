// The bend handle's pointer math (extracted from ProjectGraphEdge.tsx for the 300-line source
// limit): a drag's screen delta becomes a flow-coordinate curve offset by dividing out the live
// zoom, so the bend follows the pointer at every LOD level. Pure — the React pointer capture
// stays in the edge component.

import type { Point } from "@/facilis/graph-edge-geometry";
import type { GraphCurve } from "@/facilis/graph-types";

export interface EdgeCurveDragState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly base: Point;
}

export function curveFromPointer(
  event: { readonly clientX: number; readonly clientY: number },
  state: EdgeCurveDragState,
  zoom: number,
): GraphCurve {
  const scale = zoom === 0 ? 1 : zoom;
  return {
    x: state.base.x + (event.clientX - state.startX) / scale,
    y: state.base.y + (event.clientY - state.startY) / scale,
  };
}
