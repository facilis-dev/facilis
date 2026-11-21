// The matrix mode's composition root (issue #67): derives the model from the SAME displayView
// the topology canvas draws, and owns the double-click contract — switch back to topology and
// focus the cell's route-table edge through the focus channel the canvas already understands
// (graph-focus.ts): the edge is outlined, its endpoints framed, and the route stays selected so
// its reachability context (issue #66, graph-user-focus.ts) dims the rest. The view-state focus
// ids are carried by #58 but not consumed in this chain; the wired edge-focus channel is this
// one. The details satellite (#59) is a sibling branch: a cell click sets the exact view-state
// selection a topology node click sets, so the satellite will react to it once it merges.

import { useMemo } from "react";
import { notifyGraphFocus } from "@/facilis/graph-focus";
import { buildGraphMatrix, type GraphMatrixCell, type GraphMatrixRow, type GraphMatrixSort } from "@/facilis/graph-matrix";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { GraphReachability } from "@/facilis/graph-reachability";
import { ProjectGraphMatrix } from "./ProjectGraphMatrix";

export function ProjectGraphMatrixSurface({
  view,
  sort,
  onSortChange,
  selectedNodeId,
  onSelectNode,
  onExitMatrix,
  userFocus,
}: {
  view: ProjectGraphView;
  sort: GraphMatrixSort;
  onSortChange: (sort: GraphMatrixSort) => void;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  /** Switches the shared view state back to topology; the selection survives the switch. */
  onExitMatrix: () => void;
  userFocus: GraphReachability | null;
}) {
  const model = useMemo(() => buildGraphMatrix(view, sort), [view, sort]);
  const openEdge = (row: GraphMatrixRow, cell: GraphMatrixCell) => {
    if (cell.edgeIds.length === 0) return;
    onSelectNode(row.routeId);
    onExitMatrix();
    notifyGraphFocus({ nodes: [...cell.pathNodeIds], edges: [...cell.edgeIds], zoom: true });
  };
  return (
    <ProjectGraphMatrix
      model={model}
      sort={sort}
      onSortChange={onSortChange}
      selectedNodeId={selectedNodeId}
      onSelectNode={onSelectNode}
      onOpenEdge={openEdge}
      userFocus={userFocus}
    />
  );
}
