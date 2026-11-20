// The analysis edges mapped to React Flow (extracted from ProjectGraphCanvas for the 300-line
// limit): style, selection, focus dimming and the saved curve travel as data, so the custom edge
// renders without knowing the view. The satellite connector is added separately by the canvas.

import { MarkerType } from "@xyflow/react";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { GraphCurve } from "@/facilis/graph-types";
import { LINK_SOURCE_HANDLE_ID, LINK_TARGET_HANDLE_ID } from "./ProjectGraphNodes";
import { PROJECT_GRAPH_EDGE_TYPE, type ProjectFlowEdge } from "./ProjectGraphEdge";
import { edgeStyleFor } from "./project-graph-edges";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

export interface ProjectFlowEdgesInput {
  readonly view: ProjectGraphView;
  readonly edgeCurves: Readonly<Record<string, GraphCurve>>;
  readonly selectedEdgeId: string | null;
  readonly focus: ProjectGraphFocusState | null;
  readonly onEdgeCurveChange: (edgeId: string, curve: GraphCurve | null) => void;
}

export function buildProjectGraphFlowEdges({
  view,
  edgeCurves,
  selectedEdgeId,
  focus,
  onEdgeCurveChange,
}: ProjectFlowEdgesInput): ProjectFlowEdge[] {
  return view.edges.map((edge) => {
    const style = edgeStyleFor(edge);
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: LINK_SOURCE_HANDLE_ID,
      targetHandle: LINK_TARGET_HANDLE_ID,
      type: PROJECT_GRAPH_EDGE_TYPE,
      selected: edge.id === selectedEdgeId,
      data: {
        kind: edge.kind,
        ...(edge.access === undefined ? {} : { access: edge.access }),
        // Dimming is data, like a card's: an edge stays bright only when the focus names it.
        focused: focus === null ? true : focus.edgeIds.has(edge.id),
        curve: edgeCurves[edge.id] ?? null,
        onCurveChange: onEdgeCurveChange,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke, width: 14, height: 14 },
    };
  });
}