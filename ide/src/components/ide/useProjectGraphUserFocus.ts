// The selection's derived focus state (issue #66): the isolate filter and the dimming closure
// are pure functions of the visible view plus the addressable state (#58), so a reload or a
// shared URL lands on the same picture without persisting anything derived. Kept out of the
// panel so that file stays under the 300-line source limit.

import { useMemo } from "react";
import type { ProjectGraphView } from "@/facilis/graph-model";
import { reachabilityClosure, type GraphReachability } from "@/facilis/graph-reachability";
import { isolateGraphView } from "@/facilis/graph-user-focus";

export interface ProjectGraphUserFocus {
  /** The view the canvas draws: the closure subgraph while isolated, the full view otherwise. */
  readonly displayView: ProjectGraphView | null;
  /** The selection's closure over the displayed view; null when nothing is selected. */
  readonly userFocus: GraphReachability | null;
}

export function useProjectGraphUserFocus(
  view: ProjectGraphView | null,
  isolatedNode: string | null,
  selectedNodeId: string | null,
): ProjectGraphUserFocus {
  const displayView = useMemo(() => {
    if (view === null || isolatedNode === null) return view;
    const closure = reachabilityClosure(view, isolatedNode);
    // A stale isolate id (an analysis refresh removed the node) degrades to the full graph,
    // never to an empty canvas.
    return closure === null ? view : isolateGraphView(view, closure);
  }, [view, isolatedNode]);
  const userFocus = useMemo(
    () =>
      displayView === null || selectedNodeId === null
        ? null
        : reachabilityClosure(displayView, selectedNodeId),
    [displayView, selectedNodeId],
  );
  return { displayView, userFocus };
}
