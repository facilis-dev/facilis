// The canvas's edge list (issue #65 port): the hub overlay's render edges, the bridge plan
// and the satellite connector in one memo. Hover isolation is canvas state — one raised
// bridge dims every other — and rides on edge data like the focus dimming, so the edge
// component stays a pure renderer. Extracted from ProjectGraphCanvas for the 300-line limit.

import { useCallback, useMemo, useState } from "react";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { GraphHubOverlay, HubIsolation } from "@/facilis/graph-edge-hubs";
import type { GraphReachability } from "@/facilis/graph-reachability";
import type { GraphCurve, ProjectGraphEdge } from "@/facilis/graph-types";
import { detailsLinkEdge, type ProjectCanvasEdge } from "./ProjectGraphDetailsLinkEdge";
import { buildProjectGraphFlowEdges } from "./project-graph-flow-edges";
import type { ProjectFlowDataState, ProjectGraphDrill } from "./project-graph-flow-nodes";
import type { ProjectFlowNode } from "./ProjectGraphNodes";
import { useProjectGraphBridgePlan } from "./useProjectGraphBridgePlan";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

export interface ProjectGraphEdgesInput {
  /** The live combined node list: a drag replans the bridges against the moving cards. */
  readonly nodes: readonly ProjectFlowNode[];
  readonly edges: readonly ProjectGraphEdge[];
  readonly overlay: GraphHubOverlay;
  readonly hubIsolation: HubIsolation | null;
  readonly edgeCurves: Readonly<Record<string, GraphCurve>>;
  readonly selectedEdgeId: string | null;
  readonly focus: ProjectGraphFocusState | null;
  readonly userFocus: GraphReachability | null;
  readonly isolatedEdgeKinds: readonly GraphEdgeKind[];
  /** The data lens's inputs (issue #70): schema strokes and the elevated lock label. */
  readonly data: ProjectFlowDataState;
  readonly drill: ProjectGraphDrill | null;
  /** The bridges lens toggle (issue #65); false restores every orthogonal route. */
  readonly bridges: boolean;
  readonly activeAnchorId: string | null;
  readonly onEdgeCurveChange: (edgeId: string, curve: GraphCurve | null) => void;
}

export function useProjectGraphEdges({
  nodes,
  edges,
  overlay,
  hubIsolation,
  edgeCurves,
  selectedEdgeId,
  focus,
  userFocus,
  isolatedEdgeKinds,
  data,
  drill,
  bridges,
  activeAnchorId,
  onEdgeCurveChange,
}: ProjectGraphEdgesInput): ProjectCanvasEdge[] {
  const [hoveredBridgeId, setHoveredBridgeId] = useState<string | null>(null);
  const onBridgeHover = useCallback((edgeId: string | null) => setHoveredBridgeId(edgeId), []);
  // One plan for the whole graph; the population excludes hub-concentrated and trunk-bundled
  // edges (#64), so bridges compose with the concentration overlay instead of duplicating it.
  const bridgePlan = useProjectGraphBridgePlan(nodes, edges, overlay, edgeCurves, bridges);
  return useMemo<ProjectCanvasEdge[]>(() => {
    const analysis = buildProjectGraphFlowEdges({
      overlay,
      edgeCurves,
      selectedEdgeId,
      focus,
      userFocus,
      isolatedEdgeKinds,
      data,
      drill,
      hubIsolation,
      bridges: bridgePlan,
      hoveredBridgeId,
      onBridgeHover,
      onEdgeCurveChange,
    });
    if (activeAnchorId === null) return analysis;
    return [...analysis, detailsLinkEdge(activeAnchorId)];
  }, [
    overlay,
    hubIsolation,
    edgeCurves,
    selectedEdgeId,
    focus,
    userFocus,
    isolatedEdgeKinds,
    data,
    drill,
    bridgePlan,
    hoveredBridgeId,
    onBridgeHover,
    onEdgeCurveChange,
    activeAnchorId,
  ]);
}
