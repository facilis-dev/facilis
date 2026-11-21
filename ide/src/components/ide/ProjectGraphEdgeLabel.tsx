// The edge label (issue #64): expanded hub edges show their real analyzer label, the thick
// hub->target edge shows the route count. Drawn as SVG text inside the edge so it pans and
// zooms with the flow, counter-scaled through lodScreenPx like the cluster bundle count
// (issue #62) so it never drops below the 7 px floor (epic rule 4). The halo keeps it readable
// over any stroke; role tokens only (D-044).

import { lodScreenPx } from "@/facilis/graph-lod";
import type { Point } from "@/facilis/graph-edge-geometry";

export function ProjectGraphEdgeLabel({
  midpoint,
  text,
  above = false,
}: {
  midpoint: Point;
  text: string;
  /** Lift the label off the midpoint so it never sits on the curve handle. */
  above?: boolean;
}) {
  return (
    <text
      x={midpoint.x}
      y={above ? midpoint.y - 12 : midpoint.y}
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
      {text}
    </text>
  );
}
