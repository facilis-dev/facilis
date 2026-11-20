// The canvas's edge list: the concentration overlay's render edges mapped to React Flow
// edges (issue #64). Extracted from ProjectGraphCanvas so that file keeps only the library
// wiring. Real edges keep their id, curve and label; a concentrated fan-out becomes one
// route->hub edge per real edge plus ONE thick hub->target count edge; below-threshold
// groups carry their shared trunk lane. Hub artefact edges are never selected or bent, so
// their geometry can never reach the saved layout.

import { MarkerType } from "@xyflow/react";
import type { GraphHubOverlay, HubIsolation } from "@/facilis/graph-edge-hubs";
import type { GraphCurve } from "@/facilis/graph-types";
import { PROJECT_GRAPH_EDGE_TYPE, type ProjectFlowEdge } from "./ProjectGraphEdge";
import { LINK_SOURCE_HANDLE_ID, LINK_TARGET_HANDLE_ID } from "./ProjectGraphNodes";
import { edgeStyleFor } from "./project-graph-edges";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

export interface ProjectFlowEdgesInput {
  readonly overlay: GraphHubOverlay;
  readonly edgeCurves: Readonly<Record<string, GraphCurve>>;
  readonly selectedEdgeId: string | null;
  readonly focus: ProjectGraphFocusState | null;
  /** Hub hover isolation (issue #64), composed with the AI focus dimming. */
  readonly isolation: HubIsolation | null;
  readonly onCurveChange: (edgeId: string, curve: GraphCurve | null) => void;
}

export function buildProjectGraphFlowEdges({
  overlay,
  edgeCurves,
  selectedEdgeId,
  focus,
  isolation,
  onCurveChange,
}: ProjectFlowEdgesInput): ProjectFlowEdge[] {
  // Dimming is data: an edge stays bright only when every active isolation names it.
  const focusedFlag = (id: string): { focused?: boolean } => {
    if (focus === null && isolation === null) return {};
    const bright =
      (focus === null || focus.edgeIds.has(id)) && (isolation === null || isolation.edgeIds.has(id));
    return { focused: bright };
  };
  const marker = (stroke: string) => ({
    type: MarkerType.ArrowClosed,
    color: stroke,
    width: 14,
    height: 14,
  });
  return overlay.edges.map((render) => {
    if (render.type === "hub-target") {
      const style = edgeStyleFor({ kind: render.kind });
      return {
        id: render.id,
        source: render.hubId,
        target: render.target,
        sourceHandle: LINK_SOURCE_HANDLE_ID,
        targetHandle: LINK_TARGET_HANDLE_ID,
        type: PROJECT_GRAPH_EDGE_TYPE,
        selected: false,
        data: {
          kind: render.kind,
          ...focusedFlag(render.id),
          curve: null,
          hubCount: render.count,
          onCurveChange,
        },
        markerEnd: marker(style.stroke),
      };
    }
    const edge = render.edge;
    const style = edgeStyleFor(edge);
    const lane = render.type === "real" ? overlay.bundleLanes.get(edge.id) : undefined;
    return {
      id: edge.id,
      source: edge.source,
      target: render.type === "hub-source" ? render.hubId : edge.target,
      sourceHandle: LINK_SOURCE_HANDLE_ID,
      targetHandle: LINK_TARGET_HANDLE_ID,
      type: PROJECT_GRAPH_EDGE_TYPE,
      selected: edge.id === selectedEdgeId,
      data: {
        kind: edge.kind,
        ...(edge.access === undefined ? {} : { access: edge.access }),
        ...focusedFlag(edge.id),
        // A shared trunk is straight by definition: bending one member would break it, so a
        // bundled edge ignores its saved curve (and its handle) until the group unbundles.
        curve: lane !== undefined ? null : (edgeCurves[edge.id] ?? null),
        ...(lane !== undefined ? { trunkLane: lane, bundled: true } : {}),
        ...(render.type === "real" && render.showLabel && edge.label !== null
          ? { label: edge.label }
          : {}),
        onCurveChange,
      },
      markerEnd: marker(style.stroke),
    };
  });
}
