// The canvas bridge plan (issue #65): one memo over the live controlled nodes, so a drag
// replans against the moving cards and every edge reads the same corridor staggering. The
// planner itself is pure (graph-edge-bridges.ts) and shared with the screenshot scene.

import { useMemo } from "react";
import { planGraphBridges } from "@/facilis/graph-edge-bridges";
import type { BridgeSpec } from "@/facilis/graph-bridge-geometry";
import type { GraphCurve, ProjectGraphEdge } from "@/facilis/graph-types";
import { flowNodeRects } from "./project-graph-edge-rects";
import type { ProjectFlowNode } from "./ProjectGraphNodes";

export function useProjectGraphBridgePlan(
  nodes: readonly ProjectFlowNode[],
  edges: readonly ProjectGraphEdge[],
  edgeCurves: Readonly<Record<string, GraphCurve>>,
  enabled: boolean,
): ReadonlyMap<string, BridgeSpec> {
  return useMemo(
    () => planGraphBridges({ edges, rects: flowNodeRects(nodes), curves: edgeCurves, enabled }),
    [edges, nodes, edgeCurves, enabled],
  );
}
