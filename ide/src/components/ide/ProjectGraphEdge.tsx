// The project-graph edge: a custom React Flow edge anchored to the cards' nearest ports and
// routed orthogonally around every card (issue #61), whose midpoint handle bends it, and which
// loops back onto its own card for self-edges. Long edges arrive as a bridge spec (issue #65)
// and arc above/below the band with a labelled apex; hover/focus raises one bridge and dims the
// rest. The geometry is pure (graph-ports.ts, graph-edge-routing.ts, graph-edge-bridges.ts);
// this module is the React part — hooks, pointer capture and role tokens (D-043/D-044).

import { useState, type CSSProperties } from "react";
import {
  BaseEdge,
  useInternalNode,
  useStore,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
} from "@xyflow/react";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import { t } from "@/i18n";
import { bridgeGeometry, type BridgeSpec } from "@/facilis/graph-bridge-geometry";
import { bridgeApexLabel, bridgeAriaLabel } from "@/facilis/graph-edge-labels";
import { lodScreenPx } from "@/facilis/graph-lod";
import type { GraphCurve } from "@/facilis/graph-types";
import { ProjectGraphBridgeLabel } from "./ProjectGraphBridgeLabel";
import { ElevatedEdgeLabel } from "./ProjectGraphDataMarks";
import { ProjectGraphEdgeHandle } from "./ProjectGraphEdgeHandle";
import { obstacleRects } from "./project-graph-edge-rects";
import { resolveGeometry } from "./project-graph-edge-resolve";
import { ProjectGraphEdgeLabel } from "./ProjectGraphEdgeLabel";
import {
  BRIDGE_DIM_OPACITY,
  TURN_EDGE_STYLES,
  dataEdgeStyleFor,
  edgeStyleFor,
} from "./project-graph-edges";
import type { ProjectFlowNode } from "./ProjectGraphNodes";
import { useGraphLod } from "./use-graph-lod";

// Re-exported so the satellite connector and the canvas effects keep one import path.
export { cardFallbackSize, internalNodeRect } from "./project-graph-edge-rects";

/** The one custom edge type; registered at module scope by the canvas. */
export const PROJECT_GRAPH_EDGE_TYPE = "project-graph-edge";

export type ProjectGraphEdgeData = {
  readonly kind: GraphEdgeKind;
  readonly access?: "elevated";
  /** True when the user focus (issue #66) closes over other edges: drawn at 12%. */
  readonly userDimmed?: boolean;
  /** True when the AI focus (D-171) names this edge: the brand halo channel, never a dim. */
  readonly aiOutlined?: boolean;
  /** True when edge-kind isolation (issue #63) names other kinds: the edge is drawn at 10%. */
  readonly dimmed?: boolean;
  /** True when a drill-down (issue #62) names other nodes: drawn at 12%, like the user focus. */
  readonly drillDimmed?: boolean;
  /** True when a hub hover (issue #64) names other edges: drawn at 12%, like the user focus. */
  readonly hubDimmed?: boolean;
  /** The turn-diff stroke (issue #73): a changed endpoint, or a severed (broken) connection. */
  readonly turn?: "changed" | "broken";
  /** True when the agent lens is secondary: its stroke renders at ~30% (epic rule 3). */
  readonly turnSecondary?: boolean;
  /** The data lens's role (issue #70); absent or null keeps the base stroke. */
  readonly dataRole?: "dominant" | "secondary" | null;
  /** Compact data LOD (issue #70): the elevated label keeps only its lock glyph. */
  readonly compactData?: boolean;
  /** How many crossings this boundary bundle stands for (issue #62); absent means one. */
  readonly count?: number;
  /** Shared trunk lane (issue #64): the edge splits from the group only at its ends. */
  readonly trunkLane?: number;
  /** Bundled edges hide the curve handle: bending one member would break the trunk. */
  readonly bundled?: boolean;
  /** A label at the midpoint: expanded hub edges show their real analyzer label. */
  readonly label?: string | null;
  /** The thick hub->target edge (issue #64): its label is the route count. */
  readonly hubCount?: number;
  /** The bridge spec when this edge arcs over the band (issue #65); absent = orthogonal. */
  readonly bridge?: BridgeSpec | null;
  /** True while another bridge is hovered/focused: this one dims (hover isolation). */
  readonly bridgeDimmed?: boolean;
  readonly onBridgeHover?: (edgeId: string | null) => void;
  readonly curve: GraphCurve | null;
  readonly onCurveChange: (edgeId: string, curve: GraphCurve | null) => void;
};

export type ProjectFlowEdge = Edge<ProjectGraphEdgeData, typeof PROJECT_GRAPH_EDGE_TYPE>;

export function ProjectGraphEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  selected,
  markerEnd,
  data,
}: EdgeProps<ProjectFlowEdge>) {
  const sourceNode = useInternalNode<ProjectFlowNode>(source);
  const targetNode = useInternalNode<ProjectFlowNode>(target);
  const nodeLookup = useStore((store) => store.nodeLookup);
  // The level, not the raw zoom: a zoom gesture re-renders the edge only at a threshold. The
  // drag math reads the live zoom from the store on demand instead of subscribing per frame.
  const level = useGraphLod();
  const [draft, setDraft] = useState<GraphCurve | null>(null);
  const [hovered, setHovered] = useState(false);

  const kind: GraphEdgeKind = data?.kind ?? "relation";
  const curve = draft ?? data?.curve ?? null;
  // A saved or in-progress curve unbundles the edge: explicit user intent wins (issue #65).
  const bridge = curve === null ? (data?.bridge ?? null) : null;
  const geometry =
    bridge !== null
      ? bridgeGeometry(bridge)
      : resolveGeometry(
          sourceNode,
          targetNode,
          source,
          target,
          { sourceX, sourceY, targetX, targetY },
          curve,
          obstacleRects(nodeLookup),
          data?.trunkLane,
        );
  const edgeInput = { kind, ...(data?.access === undefined ? {} : { access: data.access }) };
  const edgeStyle = edgeStyleFor(edgeInput);
  // The data lens (issue #70) overrides width and dash, never the stroke colour: the arrowhead
  // keeps the base style in project-graph-flow-edges, so the two must agree.
  const dataActive = data?.dataRole === "dominant" || data?.dataRole === "secondary";
  const dataStyle = dataActive ? dataEdgeStyleFor(edgeInput) : null;
  const highlighted = selected === true || hovered;
  // The turn-diff stroke (issue #73) replaces the kind colour and dash with a status encoding,
  // but never the opacity channels: isolation, focus and a secondary lens compose as dims, so
  // the AI outline halo still reads on top (compose, never override).
  const turn = data?.turn;
  const turnStyle = turn === undefined ? null : TURN_EDGE_STYLES[turn];
  const stroke = turnStyle === null ? edgeStyle.stroke : turnStyle.stroke;
  const dash =
    turnStyle !== null
      ? turnStyle.dash
      : dataStyle !== null
        ? dataStyle.dash
        : edgeStyle.dashed
          ? "5 3"
          : null;
  const baseWidth = highlighted ? 2.5 : 1.5;
  const strokeWidth =
    turnStyle !== null
      ? highlighted
        ? turnStyle.width + 0.5
        : turnStyle.width
      : dataStyle === null
        ? baseWidth
        : highlighted
          ? dataStyle.width + 0.5
          : dataStyle.width;
  const bridgeDimmed = bridge !== null && data?.bridgeDimmed === true;
  const apexLabel = bridge !== null ? bridgeApexLabel({ label: bridge.label, kind }) : null;
  // The hub's count edge is the one thick stroke on the canvas (issue #64); the expanded
  // members show their real label, the count edge its route count (counter-scaled, rule 4).
  // A bridged edge carries its label at the apex instead — never twice (issue #65).
  const label =
    data?.hubCount !== undefined
      ? t("projectGraph.hub.countLabel", { count: data.hubCount })
      : bridge === null && level !== "chip"
        ? (data?.label ?? null)
        : null;
  // Isolation (issue #63) dims to 10%, the user focus (issue #66) to 12%; the stronger dim
  // wins so the channels never stack into an invisible line. Bridge hover isolation (issue #65)
  // is the weakest channel at 25%. Opacity, not colour: the theme still owns the stroke. The AI
  // focus never dims — it halos below (aiOutlined). A secondary agent lens (issue #73) caps the
  // turn stroke at 30% without touching any other channel.
  const dimOpacity =
    data?.dimmed === true
      ? 0.1
      : data?.userDimmed === true || data?.drillDimmed === true || data?.hubDimmed === true
        ? 0.12
        : bridgeDimmed
          ? BRIDGE_DIM_OPACITY
          : 1;
  const opacity =
    turn !== undefined && data?.turnSecondary === true ? Math.min(dimOpacity, 0.3) : dimOpacity;
  const pathStyle: CSSProperties = {
    stroke,
    // Chip simplification (issue #60): thinner strokes and no member labels (the model's edge
    // label lives in the inspector); bend handles are suppressed below.
    strokeWidth: data?.hubCount !== undefined ? 3 : level === "chip" ? 1 : strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    ...(opacity < 1 ? { opacity } : {}),
    ...(dash === null ? {} : { strokeDasharray: dash }),
  };
  // Hover and keyboard focus do the same thing: raise this bridge, dim the rest (issue #65).
  const raiseBridge = () => {
    setHovered(true);
    if (bridge !== null) data?.onBridgeHover?.(id);
  };
  const lowerBridge = () => {
    setHovered(false);
    if (bridge !== null) data?.onBridgeHover?.(null);
  };

  return (
    <g data-lod={level} onMouseEnter={raiseBridge} onMouseLeave={lowerBridge}>
      {/* The AI focus channel (D-171, issue #66): a brand halo under the kind-coloured stroke,
          visible even when the user focus dims the edge — the two channels compose. */}
      {data?.aiOutlined === true ? (
        <path
          d={geometry.path}
          fill="none"
          stroke="var(--brand)"
          strokeWidth={5}
          strokeLinecap="round"
          opacity={0.45}
          style={{ pointerEvents: "none" }}
        />
      ) : null}
      <BaseEdge
        path={geometry.path}
        markerEnd={markerEnd}
        style={pathStyle}
        interactionWidth={24}
        {...(bridge !== null && apexLabel !== null
          ? {
              // The path itself is the focusable, announced mark: the apex text is decorative.
              tabIndex: 0,
              role: "img",
              "aria-label": bridgeAriaLabel(apexLabel),
              className: "outline-none",
              onFocus: raiseBridge,
              onBlur: lowerBridge,
            }
          : {})}
      />
      {bridge !== null && apexLabel !== null ? (
        <ProjectGraphBridgeLabel
          apex={bridge.apex}
          label={apexLabel}
          visible={level !== "chip" || highlighted}
          dimmed={bridgeDimmed}
        />
      ) : null}
      {(data?.count ?? 1) > 1 ? (
        // The boundary bundle's count (issue #62): a halo keeps it readable over any edge, and
        // the counter-scaled size keeps it above the 7 px floor at every zoom (epic rule 4).
        <text
          x={geometry.midpoint.x}
          y={geometry.midpoint.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--muted-foreground)"
          stroke="var(--background)"
          paintOrder="stroke"
          className="pointer-events-none"
          style={{
            fontSize: lodScreenPx(9),
            strokeWidth: lodScreenPx(3),
          }}
        >
          {t("projectGraph.cluster.edgeCount", { count: data?.count ?? 1 })}
        </text>
      ) : null}
      {label !== null ? (
        <ProjectGraphEdgeLabel
          midpoint={geometry.midpoint}
          text={label}
          above={data?.hubCount === undefined}
        />
      ) : null}
      {/* The elevated lock label (issue #70): above the midpoint so the curve handle stays
          grabbable; the glyph survives every zoom, the word compacts away (criterion 1). */}
      {dataActive && data?.access === "elevated" ? (
        <ElevatedEdgeLabel
          x={geometry.midpoint.x}
          y={geometry.midpoint.y - 12}
          compact={data.compactData === true}
          secondary={data.dataRole === "secondary"}
        />
      ) : null}
      {/* No bend handles at chip (criterion 5) or on a bundled member (issue #64): the edge
          stays clickable, just not bendable. On a bridge the handle sits at the apex; dragging
          it saves a curve and restores the orthogonal rendering (issue #65). */}
      {level !== "chip" && selected === true && data !== undefined && data.bundled !== true ? (
        <ProjectGraphEdgeHandle
          edgeId={id}
          midpoint={geometry.midpoint}
          stroke={stroke}
          baseCurve={data.curve}
          onCurveChange={data.onCurveChange}
          onDraft={setDraft}
        />
      ) : null}
    </g>
  );
}

export const PROJECT_GRAPH_EDGE_TYPES: EdgeTypes = {
  "project-graph-edge": ProjectGraphEdge,
};
