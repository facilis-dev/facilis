// The stats-ribbon filter state (issue #57): the footer's counters became HUD buttons that each
// filter the graph. Pure so the toggle semantics are unit-testable; the panel feeds the result to
// buildProjectGraphView (kinds) and the edge-hide list. This is an explicit user choice, distinct
// from D-179 table visibility — it never rewrites the saved layout.

import type { GraphEdgeKind, GraphNodeKind } from "@facilis.dev/analyze";
import { GRAPH_EDGE_KINDS } from "./graph-types";

export interface GraphStatsFilter {
  /** Node kinds to isolate; empty means "no kind filter" (draw every kind). */
  readonly kinds: readonly GraphNodeKind[];
  /** When true the ribbon's edges counter hides every edge kind. */
  readonly edgesHidden: boolean;
}

export const EMPTY_STATS_FILTER: GraphStatsFilter = { kinds: [], edgesHidden: false };

/** Toggle one kind in the isolation set; toggling the last kind off clears the filter. */
export function toggleKindFilter(filter: GraphStatsFilter, kind: GraphNodeKind): GraphStatsFilter {
  const active = filter.kinds.includes(kind);
  return {
    ...filter,
    kinds: active ? filter.kinds.filter((entry) => entry !== kind) : [...filter.kinds, kind],
  };
}

export function toggleEdgesFilter(filter: GraphStatsFilter): GraphStatsFilter {
  return { ...filter, edgesHidden: !filter.edgesHidden };
}

export function isKindActive(filter: GraphStatsFilter, kind: GraphNodeKind): boolean {
  return filter.kinds.includes(kind);
}

/**
 * The edge kinds the view should hide: the layout's own list, or every kind when the ribbon's
 * edges counter is pressed. The layout list is returned untouched otherwise so a saved layout
 * keeps its hidden edges.
 */
export function effectiveHiddenEdgeKinds(
  filter: GraphStatsFilter,
  layoutHidden: readonly GraphEdgeKind[],
): readonly GraphEdgeKind[] {
  return filter.edgesHidden ? [...GRAPH_EDGE_KINDS] : layoutHidden;
}
