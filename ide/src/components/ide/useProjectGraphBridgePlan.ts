// The canvas's bridge plan (issue #65): one memoized plan over the live node list, so a drag
// replans against the moving cards. The population consumes #64's hub-exclusion semantics:
// an edge concentrated into a hub chip belongs to the hub's geometry, and a trunk-bundled
// member shares its group's straight lane — neither is bridged (compose, never duplicate).

import { useMemo } from "react";
import { planGraphBridges, type BridgeEdgeInput } from "@/facilis/graph-edge-bridges";
import type { BridgeSpec } from "@/facilis/graph-bridge-geometry";
import type { GraphHubOverlay } from "@/facilis/graph-edge-hubs";
import type { GraphCurve, ProjectGraphEdge } from "@/facilis/graph-types";
import { flowNodeRects } from "./project-graph-edge-rects";
import type { ProjectFlowNode } from "./ProjectGraphNodes";

/** The edges the bridge lens may draw: not concentrated into a hub, not trunk-bundled (#64). */
export function bridgePopulation(
  edges: readonly ProjectGraphEdge[],
  overlay: GraphHubOverlay,
): BridgeEdgeInput[] {
  return edges.filter(
    (edge) => !overlay.concentratedEdgeIds.has(edge.id) && !overlay.bundleLanes.has(edge.id),
  );
}

export function useProjectGraphBridgePlan(
  nodes: readonly ProjectFlowNode[],
  edges: readonly ProjectGraphEdge[],
  overlay: GraphHubOverlay,
  edgeCurves: Readonly<Record<string, GraphCurve>>,
  enabled: boolean,
): ReadonlyMap<string, BridgeSpec> {
  return useMemo(
    () =>
      planGraphBridges({
        edges: bridgePopulation(edges, overlay),
        rects: flowNodeRects(nodes),
        curves: edgeCurves,
        enabled,
      }),
    [edges, overlay, nodes, edgeCurves, enabled],
  );
}
