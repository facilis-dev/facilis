// The selected-node inspector's composition (issue #68 extraction): the detail facts, the
// label lookup and the source/preview actions the floating inspector needs, split from
// ProjectGraphPanel so the composition root stays under the 300-line limit. Behaviour is
// unchanged: the inspector opens on the shared view-state selection — the same selection a
// canvas click, the matrix cell or the palette's zoom-to-node sets. Sibling #59 (PR #118)
// replaces this overlay with the on-canvas satellite reacting to that same selection.

import { useMemo } from "react";
import { buildGraphDetails, type NodeDetails } from "@/facilis/graph-details";
import { sourcePathFor } from "@/facilis/graph-model";
import { openPageInPreview } from "@/facilis/graph-open-preview";
import type { Analysis } from "@facilis.dev/analyze";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { IdeController } from "@/vv/controller";
import { ProjectGraphInspector } from "./ProjectGraphInspector";

export function ProjectGraphInspectorSlot({
  analysis,
  view,
  selectedNodeId,
  onSelectNode,
  root,
  controller,
  sources,
}: {
  analysis: Analysis | null;
  view: ProjectGraphView | null;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  root: string | null;
  controller: IdeController;
  sources: ReadonlyMap<string, string>;
}) {
  const selectedNode = view?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  // Incident edges, both directions: the page inspector lists page links and the view
  // inspector reads the routes that use it (incoming route-view edges).
  const selectedEdges =
    view?.edges.filter(
      (edge) => edge.source === selectedNodeId || edge.target === selectedNodeId,
    ) ?? [];
  // The inspector's detail facts live on the Analysis the panel already holds, not the graph.
  const details = useMemo<ReadonlyMap<string, NodeDetails>>(
    () => (analysis === null ? new Map() : buildGraphDetails(analysis)),
    [analysis],
  );
  const nodeLabels = useMemo(
    () => new Map((view?.nodes ?? []).map((node) => [node.id, node.label] as const)),
    [view],
  );
  const nodeLabel = (id: string): string | null => nodeLabels.get(id) ?? null;
  const openFileAt = (file: string, line: number) => {
    const path = sourcePathFor(root, file);
    if (path !== null) void controller.openFileAt(path, line);
  };
  // A detail list may name a relation the graph did not draw: selecting an id that has no
  // node would close the inspector for no reason.
  const selectNode = (id: string) => {
    if (nodeLabels.has(id)) onSelectNode(id);
  };
  if (selectedNode === null) return null;
  return (
    <ProjectGraphInspector
      node={selectedNode}
      edges={selectedEdges}
      details={details.get(selectedNode.id) ?? null}
      sources={sources}
      nodeLabel={nodeLabel}
      onClose={() => onSelectNode(null)}
      onOpenFileAt={openFileAt}
      onOpenPreview={(path) => openPageInPreview(controller, path)}
      onSelectNode={selectNode}
    />
  );
}
