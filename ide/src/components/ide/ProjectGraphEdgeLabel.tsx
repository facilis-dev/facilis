// The edge label chip (issue #64): expanded hub edges show their real label, the thick
// hub->target edge shows the route count. Rendered through EdgeLabelRenderer so it pans and
// zooms with the flow; offset above the midpoint so it never sits on the curve handle.
// Role tokens only (D-044); the text is an analyzer fact or a t() string from the caller.

import { EdgeLabelRenderer } from "@xyflow/react";
import type { Point } from "@/facilis/graph-edge-geometry";

export function ProjectGraphEdgeLabel({ midpoint, text }: { midpoint: Point; text: string }) {
  return (
    <EdgeLabelRenderer>
      <div
        style={{
          position: "absolute",
          transform:
            "translate(-50%, -50%) translate(" +
            midpoint.x +
            "px, " +
            (midpoint.y - 12) +
            "px)",
        }}
        className="nodrag nopan pointer-events-none rounded border border-border bg-card px-1 text-[10px] leading-4 font-medium text-card-foreground"
      >
        {text}
      </div>
    </EdgeLabelRenderer>
  );
}
