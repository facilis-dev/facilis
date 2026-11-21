// The canvas's edge list: the view's edges mapped to React Flow edges. Extracted from
// ProjectGraphCanvas so that file keeps only the library wiring (the 300-line source limit).
// Dimming is data, like a card's: the USER focus (issue #66) faints the edges outside the
// selection's closure to 12%, edge-kind isolation (issue #63) faints every other kind to 10%,
// and the AI focus (D-171) outlines the edges it names — opacity and outline are separate
// channels, never a removal, so positions, selection and the graph bounds cannot move.

import { MarkerType } from "@xyflow/react";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { ImpactOverlay } from "@/facilis/graph-impact";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { GraphReachability } from "@/facilis/graph-reachability";
import type { GraphCurve } from "@/facilis/graph-types";
import { IMPACT_BROKEN_EDGE_STYLE, edgeStyleFor } from "./project-graph-edges";
import { PROJECT_GRAPH_EDGE_TYPE, type ProjectFlowEdge } from "./ProjectGraphEdge";
import { LINK_SOURCE_HANDLE_ID, LINK_TARGET_HANDLE_ID } from "./ProjectGraphNodes";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

export interface ProjectFlowEdgesInput {
  readonly view: ProjectGraphView;
  readonly edgeCurves: Readonly<Record<string, GraphCurve>>;
  readonly selectedEdgeId: string | null;
  /** The active AI focus (D-171): the outline channel, or null when nothing is outlined. */
  readonly focus: ProjectGraphFocusState | null;
  /** The selection's closure (issue #66): the dimming channel, or null when nothing is dimmed. */
  readonly userFocus: GraphReachability | null;
  /** Edge kinds isolated by the chips (issue #63); empty means no isolation. */
  readonly isolatedEdgeKinds: readonly GraphEdgeKind[];
  /** The impact simulation overlay (issue #74); null/absent means the lens is inactive. */
  readonly impact?: ImpactOverlay | null;
  readonly onEdgeCurveChange: (edgeId: string, curve: GraphCurve | null) => void;
}

export function buildProjectGraphFlowEdges({
  view,
  edgeCurves,
  selectedEdgeId,
  focus,
  userFocus,
  isolatedEdgeKinds,
  impact = null,
  onEdgeCurveChange,
}: ProjectFlowEdgesInput): ProjectFlowEdge[] {
  const isolationActive = isolatedEdgeKinds.length > 0;
  const userEdges = userFocus === null ? null : new Set(userFocus.edgeIds);
  const impactDimming = impact !== null && impact.targetId !== null;
  return view.edges.map((edge) => {
    const broken = impact?.brokenEdgeIds.has(edge.id) ?? false;
    const style = broken ? IMPACT_BROKEN_EDGE_STYLE : edgeStyleFor(edge);
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
        // An edge outside the user's closure recedes; the AI outline is independent of it.
        ...(userEdges === null ? {} : { userDimmed: !userEdges.has(edge.id) }),
        ...(focus === null ? {} : { aiOutlined: focus.edgeIds.has(edge.id) }),
        ...(isolationActive ? { dimmed: !isolatedEdgeKinds.includes(edge.kind) } : {}),
        ...(broken ? { impactBroken: true } : {}),
        ...(impactDimming && !broken ? { impactDimmed: true } : {}),
        curve: edgeCurves[edge.id] ?? null,
        onCurveChange: onEdgeCurveChange,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke, width: 14, height: 14 },
    };
  });
}
