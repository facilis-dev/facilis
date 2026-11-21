// The dashed connector between a card and its details satellite (issue #59). It reuses the
// floating-border geometry of the analysis edges, so it leaves the card towards the satellite
// on whichever side the satellite sits; it carries no kind, no arrow and no curve handle.

import { BaseEdge, useInternalNode, type Edge, type EdgeProps } from "@xyflow/react";
import { EDGE_ENDPOINT_GAP, edgeGeometry, floatingAnchors } from "@/facilis/graph-edge-geometry";
import { detailsLinkEdgeId, satelliteNodeId } from "@/facilis/graph-satellite";
import { internalNodeRect, type ProjectFlowEdge } from "./ProjectGraphEdge";
import { LINK_SOURCE_HANDLE_ID, LINK_TARGET_HANDLE_ID, type ProjectFlowNode } from "./ProjectGraphNodes";

export const DETAILS_LINK_EDGE_TYPE = "details-link";

export type DetailsLinkFlowEdge = Edge<Record<string, unknown>, typeof DETAILS_LINK_EDGE_TYPE>;

/** The canvas's edge union: the analysis edges plus the satellite connector. */
export type ProjectCanvasEdge = ProjectFlowEdge | DetailsLinkFlowEdge;

/** The connector edge for a card's active details anchor; never focusable or selectable. */
export function detailsLinkEdge(anchorId: string): DetailsLinkFlowEdge {
  return {
    id: detailsLinkEdgeId(anchorId),
    source: anchorId,
    target: satelliteNodeId(anchorId),
    sourceHandle: LINK_SOURCE_HANDLE_ID,
    targetHandle: LINK_TARGET_HANDLE_ID,
    type: DETAILS_LINK_EDGE_TYPE,
    data: {},
    focusable: false,
    selectable: false,
  };
}

export function ProjectGraphDetailsLinkEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
}: EdgeProps<DetailsLinkFlowEdge>) {
  const sourceNode = useInternalNode<ProjectFlowNode>(source);
  const targetNode = useInternalNode<ProjectFlowNode>(target);
  const sourceRect = internalNodeRect(sourceNode);
  const targetRect = internalNodeRect(targetNode);
  const path =
    sourceRect !== null && targetRect !== null
      ? edgeGeometry(floatingAnchors(sourceRect, targetRect, EDGE_ENDPOINT_GAP), null).path
      : `M ${sourceX},${sourceY} L ${targetX},${targetY}`;
  return (
    <g data-testid="project-graph-details-link">
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: "var(--muted-foreground)",
          strokeWidth: 1.5,
          strokeDasharray: "4 3",
          strokeLinecap: "round",
        }}
      />
    </g>
  );
}
