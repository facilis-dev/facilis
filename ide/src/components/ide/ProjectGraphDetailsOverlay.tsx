// The selected node's details overlay (issues #59/#67), extracted from ProjectGraphPanel so the
// composition root stays under the 300-line source limit now that navigation landed. Above the
// sheet breakpoint the details live in the on-canvas satellite (ProjectGraphCanvas); below it —
// and in matrix mode at ALL widths (F.7: matrix has no canvas satellite) — this bottom sheet is
// the surface. It is the same selection contract either way: the sheet closes the shared
// selection and may pin a comparison card. No side panel (epic #56 rule 1).

import type { Diagnostic } from "@facilis.dev/analyze";
import { openPageInPreview } from "@/facilis/graph-open-preview";
import type { IdeController } from "@/vv/controller";
import type { NodeDetails } from "@/facilis/graph-details";
import type { ProjectGraphView } from "@/facilis/graph-model";
import { ProjectGraphDetailsSheet } from "./ProjectGraphDetailsSheet";

export interface ProjectGraphDetailsOverlayProps {
  readonly view: ProjectGraphView | null;
  readonly selectedNodeId: string | null;
  readonly details: ReadonlyMap<string, NodeDetails>;
  readonly diagnostics: ReadonlyMap<string, readonly Diagnostic[]>;
  readonly sources: ReadonlyMap<string, string>;
  readonly nodeLabels: ReadonlyMap<string, string>;
  readonly nodeLabel: (id: string) => string | null;
  readonly height: number;
  readonly pinned: boolean;
  readonly canPin: boolean;
  readonly onHeightChange: (height: number) => void;
  readonly onClose: () => void;
  readonly onPinRequest: (nodeId: string) => void;
  readonly onOpenFileAt: (file: string, line: number) => void;
  readonly onSelectNode: (id: string) => void;
  readonly controller: IdeController;
}

export function ProjectGraphDetailsOverlay({
  view,
  selectedNodeId,
  details,
  diagnostics,
  sources,
  nodeLabels,
  nodeLabel,
  height,
  pinned,
  canPin,
  onHeightChange,
  onClose,
  onPinRequest,
  onOpenFileAt,
  onSelectNode,
  controller,
}: ProjectGraphDetailsOverlayProps) {
  const node = view?.nodes.find((entry) => entry.id === selectedNodeId) ?? null;
  if (node === null) return null;
  const incident =
    view?.edges.filter((edge) => edge.source === node.id || edge.target === node.id) ?? [];
  return (
    <ProjectGraphDetailsSheet
      node={node}
      edges={incident}
      details={details.get(node.id) ?? null}
      diagnostics={diagnostics.get(node.id) ?? []}
      sources={sources}
      nodeLabel={nodeLabel}
      height={height}
      pinned={pinned}
      canPin={canPin}
      onHeightChange={onHeightChange}
      onClose={onClose}
      onTogglePin={() => onPinRequest(node.id)}
      onOpenFileAt={onOpenFileAt}
      onOpenPreview={(path) => openPageInPreview(controller, path)}
      onSelectNode={(id) => {
        // A detail list may name a relation the graph did not draw: ignore unknown ids.
        if (nodeLabels.has(id)) onSelectNode(id);
      }}
    />
  );
}
