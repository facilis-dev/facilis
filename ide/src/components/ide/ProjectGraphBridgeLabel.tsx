// The bridge apex label (issue #65): a small floating text at the arc's peak. It is purely
// presentational — the edge path carries the screen-reader announcement — and it never
// renders below the epic's 7 px floor: the caller counter-scales the font when hover/focus
// reveals it at a low zoom. Role tokens only (D-044): foreground text with a background halo.

import type { Point } from "@/facilis/graph-edge-geometry";
import { BRIDGE_DIM_OPACITY } from "./project-graph-edges";

export function ProjectGraphBridgeLabel({
  apex,
  label,
  fontPx,
  visible,
  dimmed,
}: {
  readonly apex: Point;
  readonly label: string;
  readonly fontPx: number;
  readonly visible: boolean;
  readonly dimmed: boolean;
}) {
  if (!visible) return null;
  return (
    <text
      x={apex.x}
      y={apex.y - 6}
      textAnchor="middle"
      aria-hidden="true"
      className="pointer-events-none select-none"
      style={{
        fontSize: fontPx,
        fill: "var(--foreground)",
        opacity: dimmed ? BRIDGE_DIM_OPACITY : 1,
        // A background-coloured halo keeps the label readable over cards and other edges.
        paintOrder: "stroke",
        stroke: "var(--background)",
        strokeWidth: 3,
        strokeLinejoin: "round",
      }}
    >
      {label}
    </text>
  );
}
