// Rich-card state for the project graph panel (issue #188). The card is view state only: it
// closes when the selection leaves its node, so the Esc ladder and any selection change keep the
// layers in sync without the panel threading a close call through every handler.

import { useCallback, useEffect, useState } from "react";
import type { NodeDetails } from "@/facilis/graph-details";
import type { ProjectGraphView } from "@/facilis/graph-model";
import { ProjectGraphRichCard, type RichCardRequest } from "./ProjectGraphRichCard";

export function useProjectGraphRichCard({
  selectedNodeId,
  view,
  details,
  nodeLabel,
  onSelectNode,
}: {
  selectedNodeId: string | null;
  view: ProjectGraphView | null;
  details: ReadonlyMap<string, NodeDetails>;
  nodeLabel: (id: string) => string | null;
  onSelectNode: (id: string) => void;
}): { card: RichCardRequest | null; open: (id: string) => void; close: () => void } {
  const [nodeId, setNodeId] = useState<string | null>(null);
  const node = nodeId === null ? null : (view?.nodes.find((entry) => entry.id === nodeId) ?? null);

  // A selection change means the inspector moved on: the card anchored to the old node closes.
  useEffect(() => {
    if (nodeId !== null && nodeId !== selectedNodeId) setNodeId(null);
  }, [nodeId, selectedNodeId]);

  const open = useCallback((id: string) => setNodeId(id), []);
  const close = useCallback(() => setNodeId(null), []);
  const card: RichCardRequest | null =
    node === null
      ? null
      : {
          nodeId: node.id,
          render: (layout, cardRef) => (
            <ProjectGraphRichCard
              node={node}
              details={details.get(node.id) ?? null}
              nodeLabel={nodeLabel}
              onSelectNode={onSelectNode}
              onClose={close}
              layout={layout}
              cardRef={cardRef}
            />
          ),
        };
  return { card, open, close };
}
