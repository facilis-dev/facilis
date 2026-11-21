// The React side of the semantic zoom (issue #60): a card or edge reads its level of detail
// through a QUANTISED selector over React Flow's store. The selector returns the level string,
// not the raw zoom, so zustand's Object.is bailout re-renders the subscriber only when a zoom
// gesture crosses a threshold — never per frame. The selector is module-level (stable identity)
// for the same reason.

import { useStore, type ReactFlowState } from "@xyflow/react";
import { lodForZoom, type GraphLodLevel } from "@/facilis/graph-lod";

const selectGraphLod = (state: ReactFlowState): GraphLodLevel => lodForZoom(state.transform[2]);

export function useGraphLod(): GraphLodLevel {
  return useStore(selectGraphLod);
}
