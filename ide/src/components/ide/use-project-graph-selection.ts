// The selection's derived facts (extracted from ProjectGraphPanel for the 300-line source
// limit): the selected node and its incident edges, the inspector's detail map, the label
// lookup, and closeDetails (clear the selection and return DOM focus to the card). Everything
// here is derived from the visible view and the Analysis the panel already holds — no IO.

import { useCallback, useMemo } from "react";
import type { Analysis } from "@facilis.dev/analyze";
import { buildGraphDetails, type NodeDetails } from "@/facilis/graph-details";
import type { ProjectGraphView } from "@/facilis/graph-model";
import { focusGraphNode } from "./focus-graph-node";

export interface ProjectGraphSelection {
  readonly selectedNode: ProjectGraphView["nodes"][number] | null;
  readonly selectedEdges: ProjectGraphView["edges"];
  readonly details: ReadonlyMap<string, NodeDetails>;
  readonly nodeLabels: ReadonlyMap<string, string>;
  readonly nodeLabel: (id: string) => string | null;
  readonly closeDetails: () => void;
}

export function useProjectGraphSelection(
  view: ProjectGraphView | null,
  selectedNodeId: string | null,
  analysis: Analysis | null,
  setSelectedNodeId: (id: string | null) => void,
): ProjectGraphSelection {
  const closeDetails = useCallback(() => {
    if (selectedNodeId !== null) focusGraphNode(selectedNodeId);
    setSelectedNodeId(null);
  }, [selectedNodeId, setSelectedNodeId]);
  const selectedNode = view?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  // Incident edges, both directions: page links and the routes that use a view.
  const selectedEdges =
    view?.edges.filter(
      (edge) => edge.source === selectedNodeId || edge.target === selectedNodeId,
    ) ?? [];
  // The inspector's detail facts live on the Analysis the panel already holds, not on the graph.
  const details = useMemo<ReadonlyMap<string, NodeDetails>>(
    () => (analysis === null ? new Map<string, NodeDetails>() : buildGraphDetails(analysis)),
    [analysis],
  );
  const nodeLabels = useMemo(
    () => new Map((view?.nodes ?? []).map((node) => [node.id, node.label] as const)),
    [view],
  );
  const nodeLabel = (id: string): string | null => nodeLabels.get(id) ?? null;
  return { selectedNode, selectedEdges, details, nodeLabels, nodeLabel, closeDetails };
}
