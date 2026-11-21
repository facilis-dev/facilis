// The canvas's edge list: the view's edges mapped to React Flow edges. Extracted from
// ProjectGraphCanvas so that file keeps only the library wiring (the 300-line source limit).
// Dimming is data, like a card's: an AI focus (D-171) faints the edges it does not name, and
// edge-kind isolation (issue #63) faints every other kind to 10% — opacity only, never a
// removal, so positions, selection and the graph bounds cannot move.
//
// The turn-diff overlay (issue #73) adds a stroke style, never a removal: an edge touching a
// changed/added endpoint reads "changed"; an edge touching a tombstone reads "broken", and the
// base edges a deletion severed stay drawn (broken, no arrow, not bendable — bending one would
// write a curve for an edge the analysis no longer has).

import { MarkerType } from "@xyflow/react";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { GraphCurve } from "@/facilis/graph-types";
import type { TurnOverlay } from "@/facilis/graph-turn-diff";
import { edgeStyleFor } from "./project-graph-edges";
import { PROJECT_GRAPH_EDGE_TYPE, type ProjectFlowEdge } from "./ProjectGraphEdge";
import { LINK_SOURCE_HANDLE_ID, LINK_TARGET_HANDLE_ID } from "./ProjectGraphNodes";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

export interface ProjectFlowEdgesInput {
  readonly view: ProjectGraphView;
  readonly edgeCurves: Readonly<Record<string, GraphCurve>>;
  readonly selectedEdgeId: string | null;
  /** The active AI focus (D-171), or null when every edge is equally bright. */
  readonly focus: ProjectGraphFocusState | null;
  /** Edge kinds isolated by the chips (issue #63); empty means no isolation. */
  readonly isolatedEdgeKinds: readonly GraphEdgeKind[];
  /** The agent lens overlay (issue #73); absent/null/inactive draws the graph as without it. */
  readonly turn?: TurnOverlay | null;
  readonly onEdgeCurveChange: (edgeId: string, curve: GraphCurve | null) => void;
}

export function buildProjectGraphFlowEdges({
  view,
  edgeCurves,
  selectedEdgeId,
  focus,
  isolatedEdgeKinds,
  turn = null,
  onEdgeCurveChange,
}: ProjectFlowEdgesInput): ProjectFlowEdge[] {
  const turnDiff = turn?.diff ?? null;
  const turnSecondary = turn?.secondary ?? false;
  const isolationActive = isolatedEdgeKinds.length > 0;
  const turnActive = turnDiff !== null && turnDiff.active;
  const turnOf = (edgeId: string): "changed" | "broken" | undefined => {
    if (!turnActive) return undefined;
    if (turnDiff.brokenEdgeIds.has(edgeId)) return "broken";
    if (turnDiff.changedEdgeIds.has(edgeId)) return "changed";
    return undefined;
  };
  const edges = view.edges.map((edge): ProjectFlowEdge => {
    const style = edgeStyleFor(edge);
    const turn = turnOf(edge.id);
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
        // An edge stays bright only when the focus names it.
        ...(focus === null ? {} : { focused: focus.edgeIds.has(edge.id) }),
        ...(isolationActive ? { dimmed: !isolatedEdgeKinds.includes(edge.kind) } : {}),
        ...(turn === undefined ? {} : { turn, turnSecondary }),
        curve: edgeCurves[edge.id] ?? null,
        onCurveChange: onEdgeCurveChange,
      },
      // A broken edge has no arrowhead: the connection is severed, not pointing anywhere.
      ...(turn === "broken"
        ? {}
        : {
            markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke, width: 14, height: 14 },
          }),
    };
  });
  if (!turnActive || turnDiff.severedEdges.length === 0) return edges;
  const severed = turnDiff.severedEdges.map((edge): ProjectFlowEdge => {
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: LINK_SOURCE_HANDLE_ID,
      targetHandle: LINK_TARGET_HANDLE_ID,
      type: PROJECT_GRAPH_EDGE_TYPE,
      // Not selectable: the curve handle must never appear on a lens-only edge, so the lens
      // cannot write a curve into the saved layout (it never writes git or .facilis).
      selectable: false,
      data: {
        kind: edge.kind,
        ...(edge.access === undefined ? {} : { access: edge.access }),
        ...(focus === null ? {} : { focused: focus.edgeIds.has(edge.id) }),
        ...(isolationActive ? { dimmed: !isolatedEdgeKinds.includes(edge.kind) } : {}),
        turn: "broken",
        turnSecondary,
        curve: null,
        onCurveChange: onEdgeCurveChange,
      },
    };
  });
  return [...edges, ...severed];
}
