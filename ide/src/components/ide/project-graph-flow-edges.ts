// The analysis edges mapped to React Flow (extracted from ProjectGraphCanvas for the 300-line
// limit): style, selection, focus dimming and the saved curve travel as data, so the custom edge
// renders without knowing the view. The satellite connector is added separately by the canvas.
// The edge source is the concentration overlay (issue #64): a concentrated fan-out becomes one
// route->hub edge per real edge plus ONE thick hub->target count edge; below-threshold groups
// carry their shared trunk lane. Hub artefact edges are never selected or bent, so their
// geometry can never reach the saved layout.
// Dimming is data, like a card's: the USER focus (issue #66) faints the edges outside the
// selection's closure to 12%, edge-kind isolation (issue #63) faints every other kind to 10%,
// a hub hover (issue #64) faints every edge the hub does not name to 12%, and the AI focus
// (D-171) outlines the edges it names — opacity and outline are separate channels, never a
// removal, so positions, selection and the graph bounds cannot move.

import { MarkerType } from "@xyflow/react";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { BridgeSpec } from "@/facilis/graph-bridge-geometry";
import type { GraphHubOverlay, HubIsolation } from "@/facilis/graph-edge-hubs";
import type { GraphReachability } from "@/facilis/graph-reachability";
import type { GraphCurve } from "@/facilis/graph-types";
import { LINK_SOURCE_HANDLE_ID, LINK_TARGET_HANDLE_ID } from "./ProjectGraphNodes";
import { PROJECT_GRAPH_EDGE_TYPE, type ProjectFlowEdge } from "./ProjectGraphEdge";
import { edgeStyleFor } from "./project-graph-edges";
import type { ProjectGraphDrill } from "./project-graph-flow-nodes";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

export interface ProjectFlowEdgesInput {
  /** The render overlay: real edges, hub stubs/count edges and the shared trunk lanes (#64). */
  readonly overlay: GraphHubOverlay;
  readonly edgeCurves: Readonly<Record<string, GraphCurve>>;
  readonly selectedEdgeId: string | null;
  /** The active AI focus (D-171): the outline channel, or null when nothing is outlined. */
  readonly focus: ProjectGraphFocusState | null;
  /** The selection's closure (issue #66): the dimming channel, or null when nothing is dimmed. */
  readonly userFocus: GraphReachability | null;
  /** Edge kinds isolated by the chips (issue #63); empty means no isolation. */
  readonly isolatedEdgeKinds: readonly GraphEdgeKind[];
  /** The active drill-down (issue #62), or null when the whole graph is equally bright. */
  readonly drill: ProjectGraphDrill | null;
  /** Hub hover isolation (issue #64), composed with the other dimming channels. */
  readonly hubIsolation: HubIsolation | null;
  /** The bridge plan (issue #65): keyed by real edge id; hub artefacts never bridge. */
  readonly bridges: ReadonlyMap<string, BridgeSpec>;
  /** The raised bridge (hover/keyboard focus); every other bridge dims while it is up. */
  readonly hoveredBridgeId: string | null;
  readonly onBridgeHover: (edgeId: string | null) => void;
  readonly onEdgeCurveChange: (edgeId: string, curve: GraphCurve | null) => void;
}

/** An edge stays bright inside a drill when both ends are members or one is the frame itself. */
function drillBright(edge: { source: string; target: string }, drill: ProjectGraphDrill): boolean {
  const inside = (id: string): boolean => id === drill.clusterId || drill.nodeIds.has(id);
  return inside(edge.source) && inside(edge.target);
}

export function buildProjectGraphFlowEdges({
  overlay,
  edgeCurves,
  selectedEdgeId,
  focus,
  userFocus,
  isolatedEdgeKinds,
  drill,
  hubIsolation,
  bridges,
  hoveredBridgeId,
  onBridgeHover,
  onEdgeCurveChange,
}: ProjectFlowEdgesInput): ProjectFlowEdge[] {
  const isolationActive = isolatedEdgeKinds.length > 0;
  const userEdges = userFocus === null ? null : new Set(userFocus.edgeIds);
  const marker = (stroke: string) => ({
    type: MarkerType.ArrowClosed,
    color: stroke,
    width: 14,
    height: 14,
  });
  // The dimming/outline flags every drawn edge composes, keyed by the id it is drawn under.
  const flags = (id: string, kind: GraphEdgeKind, source: string, target: string) => ({
    ...(userEdges === null ? {} : { userDimmed: !userEdges.has(id) }),
    ...(focus === null ? {} : { aiOutlined: focus.edgeIds.has(id) }),
    ...(isolationActive ? { dimmed: !isolatedEdgeKinds.includes(kind) } : {}),
    ...(drill === null ? {} : { drillDimmed: !drillBright({ source, target }, drill) }),
    ...(hubIsolation === null ? {} : { hubDimmed: !hubIsolation.edgeIds.has(id) }),
  });
  return overlay.edges.map((render) => {
    if (render.type === "hub-target") {
      // The one thick count edge: never selected, never bent — its geometry is the hub's.
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
          ...flags(render.id, render.kind, render.hubId, render.target),
          curve: null,
          hubCount: render.count,
          onCurveChange: onEdgeCurveChange,
        },
        markerEnd: marker(style.stroke),
      };
    }
    const edge = render.edge;
    const style = edgeStyleFor(edge);
    const target = render.type === "hub-source" ? render.hubId : edge.target;
    const lane = render.type === "real" ? overlay.bundleLanes.get(edge.id) : undefined;
    // A trunk member keeps its shared lane; the plan already excluded it (issue #65 composing
    // #64). Hub stubs are the hub's geometry, never bridged.
    const bridge =
      render.type === "real" && lane === undefined ? (bridges.get(edge.id) ?? null) : null;
    return {
      id: edge.id,
      source: edge.source,
      target,
      sourceHandle: LINK_SOURCE_HANDLE_ID,
      targetHandle: LINK_TARGET_HANDLE_ID,
      type: PROJECT_GRAPH_EDGE_TYPE,
      selected: edge.id === selectedEdgeId,
      data: {
        kind: edge.kind,
        ...(edge.access === undefined ? {} : { access: edge.access }),
        // A boundary bundle carries its crossing count (issue #62); absent means one edge.
        ...(edge.count === undefined ? {} : { count: edge.count }),
        ...flags(edge.id, edge.kind, edge.source, target),
        // A shared trunk is straight by definition: bending one member would break it, so a
        // bundled edge ignores its saved curve (and its handle) until the group unbundles.
        curve: lane !== undefined ? null : (edgeCurves[edge.id] ?? null),
        ...(lane !== undefined ? { trunkLane: lane, bundled: true } : {}),
        // Expanded hub edges show their real analyzer label (issue #64).
        ...(render.type === "real" && render.showLabel && edge.label !== null
          ? { label: edge.label }
          : {}),
        bridge,
        // Hover isolation: while one bridge is raised, every other bridge dims (issue #65).
        bridgeDimmed: bridge !== null && hoveredBridgeId !== null && hoveredBridgeId !== edge.id,
        ...(bridge === null ? {} : { onBridgeHover }),
        onCurveChange: onEdgeCurveChange,
      },
      markerEnd: marker(style.stroke),
    };
  });
}
