// The graph search match pass (issue #186): a pure, incremental computation over the EXISTING
// view-model nodes. It returns the matched ids without rebuilding or mutating any node/edge
// object, so a debounced keystroke costs one predicate sweep — never a model rebuild. Matches
// dim cards on the canvas; they never hide nodes (D-211).

import { matchesNodeQuery } from "./graph-node-data.ts";
import type { ProjectGraphNode } from "./graph-types.ts";

/** One quiet period after the last keystroke before the match pass runs. */
export const GRAPH_SEARCH_DEBOUNCE_MS = 150;

export function normalizeGraphQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * The ids matching the query, in one pass over the cached nodes. A blank query matches every
 * node (the historical behaviour: the toolbar counts all nodes and nothing is dimmed).
 */
export function matchGraphNodes(
  nodes: readonly ProjectGraphNode[],
  query: string,
): ReadonlySet<string> {
  const needle = normalizeGraphQuery(query);
  const matched = new Set<string>();
  for (const node of nodes) {
    if (matchesNodeQuery(node, needle)) matched.add(node.id);
  }
  return matched;
}
