// The edge geometry resolver, extracted from ProjectGraphEdge.tsx so that file stays under the
// 300-line source limit as lens channels land: a self-edge loops, a bundled member follows its
// shared trunk lane, an obstacle-free pair takes the orthogonal route, and a pair whose cards are
// not measured yet falls back to the plain point-to-point geometry.

import { resolveTrunkGeometry } from "@/facilis/graph-edge-bundles";
import {
  edgeGeometry,
  selfLoopGeometry,
  type EdgeGeometry,
  type Rect,
} from "@/facilis/graph-edge-geometry";
import { routeEdge } from "@/facilis/graph-edge-routing";
import type { GraphCurve } from "@/facilis/graph-types";
import { internalNodeRect, type MeasuredNode } from "./project-graph-edge-rects";

export function resolveGeometry(
  sourceNode: MeasuredNode | undefined,
  targetNode: MeasuredNode | undefined,
  source: string,
  target: string,
  positions: { sourceX: number; sourceY: number; targetX: number; targetY: number },
  curve: GraphCurve | null,
  obstacles: readonly Rect[],
  trunkLane?: number,
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
  if (trunkLane !== undefined) {
    // Re-check the lane against the measured cards (and collapsed cluster frames): a taller
    // card than the layout fallback must never end up under the trunk, so a dirty lane falls
    // back to the normal orthogonal router (issue #64).
    const trunk = resolveTrunkGeometry(sourceRect, targetRect, trunkLane, curve, obstacles);
    if (trunk !== null) return trunk;
  }
  return routeEdge(sourceRect, targetRect, { obstacles, curve });
}
