// The project-graph panel's view of an AI focus request (D-171): subscribe for the panel's
// lifetime and translate the raw request into the read-only sets the canvas dims by.
//
// Nothing is persisted. The request module keeps at most one pending request for the next
// mount; this hook only mirrors what it delivers, so closing the tab, saving the layout or a
// refresh cannot leave a stale focus behind.

import { useEffect, useState } from "react";
import { subscribeGraphFocus, type GraphFocusRequest } from "@/facilis/graph-focus";

/** What the canvas focuses: the ids to keep bright, plus whether to move the viewport to them. */
export interface ProjectGraphFocusState {
  readonly nodeIds: ReadonlySet<string>;
  readonly edgeIds: ReadonlySet<string>;
  readonly zoom: boolean;
}

/**
 * Map a raw request to the canvas state. Both lists empty is how a tool clears its own focus:
 * it resolves to null so the canvas shows everything again instead of an empty focus that dims
 * the whole graph.
 */
export function focusStateFrom(request: GraphFocusRequest): ProjectGraphFocusState | null {
  if (request.nodes.length === 0 && request.edges.length === 0) return null;
  return {
    nodeIds: new Set(request.nodes),
    edgeIds: new Set(request.edges),
    zoom: request.zoom,
  };
}

/** The active focus, or null when the canvas is not focusing anything. */
export function useProjectGraphFocus(): ProjectGraphFocusState | null {
  const [focus, setFocus] = useState<ProjectGraphFocusState | null>(null);
  // The subscribe call returns the unsubscribe: the panel owns the listener for its lifetime.
  useEffect(() => subscribeGraphFocus((request) => setFocus(focusStateFrom(request))), []);
  return focus;
}
