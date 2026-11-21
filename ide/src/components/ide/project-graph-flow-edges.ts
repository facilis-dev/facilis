// The view -> React Flow edge mapping (extracted from ProjectGraphCanvas.tsx, issue #65):
// one place that attaches curves, focus dimming and the bridge spec plus hover-isolation
// state to each edge, so the canvas file keeps only the React Flow wiring.

import { MarkerType } from "@xyflow/react";
import type { BridgeSpec } from "@/facilis/graph-bridge-geometry";
import type { GraphCurve, ProjectGraphEdge } from "@/facilis/graph-types";
import { edgeStyleFor } from "./project-graph-edges";
import { PROJECT_GRAPH_EDGE_TYPE, type ProjectFlowEdge } from "./ProjectGraphEdge";
import { LINK_SOURCE_HANDLE_ID, LINK_TARGET_HANDLE_ID } from "./ProjectGraphNodes";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

export interface FlowEdgesInput {
  readonly edges: readonly ProjectGraphEdge[];
  readonly edgeCurves: Readonly<Record<string, GraphCurve>>;
  readonly selectedEdgeId: string | null;
  readonly focus: ProjectGraphFocusState | null;
  readonly bridges: ReadonlyMap<string, BridgeSpec>;
  readonly hoveredBridgeId: string | null;
  readonly onCurveChange: (edgeId: string, curve: GraphCurve | null) => void;
  readonly onBridgeHover: (edgeId: string | null) => void;
}

export function buildProjectGraphFlowEdges(input: FlowEdgesInput): ProjectFlowEdge[] {
  return input.edges.map((edge) => {
    const style = edgeStyleFor(edge);
    const bridge = input.bridges.get(edge.id) ?? null;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: LINK_SOURCE_HANDLE_ID,
      targetHandle: LINK_TARGET_HANDLE_ID,
      type: PROJECT_GRAPH_EDGE_TYPE,
      selected: edge.id === input.selectedEdgeId,
      data: {
        kind: edge.kind,
        ...(edge.access === undefined ? {} : { access: edge.access }),
        // Dimming is data, like a card's: an edge stays bright only when the focus names it.
        ...(input.focus === null ? {} : { focused: input.focus.edgeIds.has(edge.id) }),
        curve: input.edgeCurves[edge.id] ?? null,
        onCurveChange: input.onCurveChange,
        bridge,
        // Hover isolation: while one bridge is raised, every other bridge dims (issue #65).
        bridgeDimmed:
          bridge !== null && input.hoveredBridgeId !== null && input.hoveredBridgeId !== edge.id,
        onBridgeHover: input.onBridgeHover,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke, width: 14, height: 14 },
    };
  });
}
