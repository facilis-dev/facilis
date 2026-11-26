// The selected node and its incident edges, split from the panel (D-219, #187; #189 trim) so
// the drawer's inputs stay a pure read of the current view model.

import type { ProjectGraphEdge, ProjectGraphNode, ProjectGraphView } from "./graph-types.ts";

export interface GraphSelection {
  readonly node: ProjectGraphNode | null;
  readonly edges: readonly ProjectGraphEdge[];
}

export function selectGraphSelection(
  view: ProjectGraphView | null,
  selectedNodeId: string | null,
): GraphSelection {
  if (view === null || selectedNodeId === null) return { node: null, edges: [] };
  const node = view.nodes.find((entry) => entry.id === selectedNodeId) ?? null;
  const edges = view.edges.filter(
    (edge) => edge.source === selectedNodeId || edge.target === selectedNodeId,
  );
  return { node, edges };
}
