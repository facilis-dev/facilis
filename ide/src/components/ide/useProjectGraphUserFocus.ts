// The selection's derived focus state (issue #66): the dimming closure is a pure function of
// the visible view plus the addressable state (#58), so a reload or a shared URL lands on the
// same picture without persisting anything derived. Isolate is dim-only (F.5): the canvas
// always draws the FULL view — the isolate closure composes with the selection's through
// composeUserFocus, never a removal. Kept out of the panel so that file stays under the
// 300-line source limit.

import { useMemo } from "react";
import type { ProjectGraphView } from "@/facilis/graph-model";
import { reachabilityClosure, type GraphReachability } from "@/facilis/graph-reachability";
import {
  closureSummary,
  composeUserFocus,
  type GraphClosureSummary,
} from "@/facilis/graph-user-focus";

export interface ProjectGraphUserFocus {
  /** The closure the canvas dims by; null when nothing is selected or isolated. */
  readonly userFocus: GraphReachability | null;
  /** The HUD's closure line, derived from the same set the canvas highlights (criterion 3). */
  readonly focusSummary: GraphClosureSummary | null;
}

export function useProjectGraphUserFocus(
  view: ProjectGraphView | null,
  isolatedNode: string | null,
  selectedNodeId: string | null,
  /**
   * The data lens's stricter FK closure (issue #70), substituted for the selection's own closure
   * in the same dimming channel; null keeps #66's behaviour. Isolate still composes with it.
   */
  selectionOverride: GraphReachability | null = null,
): ProjectGraphUserFocus {
  // A stale id (an analysis refresh removed the node) degrades to "no closure", never to a
  // dim against a ghost: reachabilityClosure returns null for ids outside the visible view.
  const isolateClosure = useMemo(
    () => (view === null || isolatedNode === null ? null : reachabilityClosure(view, isolatedNode)),
    [view, isolatedNode],
  );
  const selectionClosure = useMemo(
    () =>
      view === null || selectedNodeId === null ? null : reachabilityClosure(view, selectedNodeId),
    [view, selectedNodeId],
  );
  const userFocus = useMemo(
    () => composeUserFocus(isolateClosure, selectionOverride ?? selectionClosure),
    [isolateClosure, selectionClosure, selectionOverride],
  );
  const focusSummary = useMemo(
    () => (view === null || userFocus === null ? null : closureSummary(view, userFocus)),
    [view, userFocus],
  );
  return { userFocus, focusSummary };
}
