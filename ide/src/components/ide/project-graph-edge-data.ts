// The analysis edge's data contract, split from ProjectGraphEdge.tsx when the impact lens
// (issue #74) added its flags: the component stays the React part (hooks, pointer capture,
// role tokens) under the 300-line source limit, while every lens's channel is declared here.
// All of it is presentation DATA, never state: dimming/outline/style compose, nothing removes.

import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { BridgeSpec } from "@/facilis/graph-bridge-geometry";
import type { GraphCurve } from "@/facilis/graph-types";

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
  /** True when the impact simulation (issue #74) would break this edge: the danger dash. */
  readonly impactBroken?: boolean;
  /** True when the impact simulation dims this edge (not broken): drawn at 12%. */
  readonly impactDimmed?: boolean;
  /** True when the impact lens is secondary: its danger stroke recedes to 30% (rule 3). */
  readonly impactSecondary?: boolean;
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
