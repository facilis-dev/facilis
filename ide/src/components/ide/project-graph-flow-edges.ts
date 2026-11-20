// The canvas's edge list (extracted from ProjectGraphCanvas for the 300-line limit): the view
// edges mapped to the custom React Flow edge, with the focus/drill dimming decided here as
// data. A collapsed cluster's boundary bundle carries its count (issue #62); the edge paints
// it at the midpoint so N crossings read as one labelled connection.

import { MarkerType } from "@xyflow/react";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { GraphCurve } from "@/facilis/graph-types";
import { PROJECT_GRAPH_EDGE_TYPE, type ProjectFlowEdge } from "./ProjectGraphEdge";
import { LINK_SOURCE_HANDLE_ID, LINK_TARGET_HANDLE_ID } from "./ProjectGraphNodes";
import { edgeStyleFor } from "./project-graph-edges";
import type { ProjectGraphDrill } from "./project-graph-flow-nodes";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

export interface ProjectFlowEdgesInput {
  readonly view: ProjectGraphView;
  readonly edgeCurves: Readonly<Record<string, GraphCurve>>;
  readonly selectedEdgeId: string | null;
  readonly focus: ProjectGraphFocusState | null;
  readonly drill: ProjectGraphDrill | null;
  readonly onEdgeCurveChange: (edgeId: string, curve: GraphCurve | null) => void;
}

/** An edge stays bright inside a drill when both ends are members or one is the frame itself. */
function drillBright(edge: { source: string; target: string }, drill: ProjectGraphDrill): boolean {
  const inside = (id: string): boolean => id === drill.clusterId || drill.nodeIds.has(id);
  return inside(edge.source) && inside(edge.target);
}

export function buildProjectGraphFlowEdges({
  view,
  edgeCurves,
  selectedEdgeId,
  focus,
  drill,
  onEdgeCurveChange,
}: ProjectFlowEdgesInput): ProjectFlowEdge[] {
  return view.edges.map((edge) => {
    const style = edgeStyleFor(edge);
    const bright =
      (focus === null || focus.edgeIds.has(edge.id)) && (drill === null || drillBright(edge, drill));
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
        ...(edge.count === undefined ? {} : { count: edge.count }),
        // Dimming is data, like a card's: an edge stays bright only when the requests name it.
        ...(focus === null && drill === null ? {} : { focused: bright }),
        curve: edgeCurves[edge.id] ?? null,
        onCurveChange: onEdgeCurveChange,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke, width: 14, height: 14 },
    };
  });
}
