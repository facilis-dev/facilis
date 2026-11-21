// The data lens's wiring (issue #70): the ribbon counters, the canvas's data inputs and the
// FK-neighbourhood focus, memoised against the drawn view and the addressable state. Extracted
// from ProjectGraphPanel so the composition root stays under the 300-line source limit — the
// same pattern as the contract lens's useProjectGraphAudit (#69). Nothing here adds view state:
// the lens rides activeLenses and the selection, which already round-trip through gv (epic rule 6).

import { useMemo } from "react";
import {
  countDataLens,
  dataLod,
  fkNeighbourhood,
  type DataCounts,
} from "@/facilis/graph-data-lens";
import { lensRole } from "@/facilis/graph-lens-state";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { GraphReachability } from "@/facilis/graph-reachability";
import type { GraphViewState } from "@/facilis/graph-view-state";
import type { ProjectFlowDataState } from "./project-graph-flow-nodes";

export interface ProjectGraphDataLens {
  readonly counts: DataCounts;
  readonly data: ProjectFlowDataState;
  /**
   * The table selection's FK neighbourhood, or null when the lens is inactive, nothing is
   * selected or the selection is not a table. The panel substitutes it for the full closure in
   * the SAME dimming channel (#66): a stricter highlight, never a removal, never a move.
   */
  readonly fkFocus: GraphReachability | null;
  readonly role: "dominant" | "secondary" | null;
}

export function useProjectGraphDataLens(
  view: ProjectGraphView | null,
  state: GraphViewState,
  zoom: number,
): ProjectGraphDataLens {
  // The counters scan the drawn nodes and edges, so they always equal what the canvas shows
  // (criterion 4) — the same visible view stats.elevatedEdges is computed over.
  const counts = useMemo(() => countDataLens(view?.nodes ?? [], view?.edges ?? []), [view]);
  const role = lensRole(state.activeLenses, "data");
  const fkFocus = useMemo(() => {
    if (view === null || role === null || state.selection === null) return null;
    const selected = view.nodes.find((node) => node.id === state.selection);
    // Only a table selection highlights its FK mesh; other kinds keep the full closure (#66).
    if (selected === undefined || selected.kind !== "table") return null;
    return fkNeighbourhood(view, state.selection);
  }, [view, role, state.selection]);
  const data = useMemo<ProjectFlowDataState>(
    () => ({ activeLenses: state.activeLenses, compactData: dataLod(zoom) === "compact" }),
    [state.activeLenses, zoom],
  );
  return { counts, data, fkFocus, role };
}
