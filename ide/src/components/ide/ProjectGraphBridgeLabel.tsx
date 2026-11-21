// The bridge apex label (issue #65): a small text at the arc's peak, counter-scaled through
// lodScreenPx like the cluster bundle count (issue #62) and the hub count (issue #64) so it
// never drops below the epic's 7 px floor (rule 4) — including the hover/focus reveal at chip
// zoom. Purely presentational: the edge path carries the screen-reader announcement. Role
// tokens only (D-044): foreground text with a background halo.

import { lodScreenPx } from "@/facilis/graph-lod";
import type { Point } from "@/facilis/graph-edge-geometry";
import { BRIDGE_DIM_OPACITY } from "./project-graph-edges";

export function ProjectGraphBridgeLabel({
  apex,
  label,
  visible,
  dimmed,
}: {
  readonly apex: Point;
  readonly label: string;
  /** False at chip zoom unless hover/focus reveals the label (the LOD label rule). */
  readonly visible: boolean;
  readonly dimmed: boolean;
}) {
  if (!visible) return null;
  return (
    <text
      x={apex.x}
      y={apex.y}
      // A font-relative lift keeps a constant SCREEN gap above the apex at every zoom, so a
      // boundary bundle's count (drawn on the apex, issue #62) never collides with the label.
      dy="-1.3em"
      textAnchor="middle"
      dominantBaseline="middle"
      aria-hidden="true"
      className="pointer-events-none select-none"
      style={{
        fontSize: lodScreenPx(10),
        fill: "var(--foreground)",
        opacity: dimmed ? BRIDGE_DIM_OPACITY : 1,
        // A background-coloured halo keeps the label readable over cards and other edges.
        paintOrder: "stroke",
        stroke: "var(--background)",
        strokeWidth: lodScreenPx(3),
        strokeLinejoin: "round",
      }}
    >
      {label}
    </text>
  );
}
