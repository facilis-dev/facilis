// The details satellite (issue #59): a React Flow node anchored beside the selected card, so
// pan, zoom and card drags keep it attached without any layout recompute. Its content is the
// existing inspector body — reuse, not duplication. The card is screen-constant: the outer box
// is sized in flow units (screen size / zoom) and the body counter-scales, so its text never
// shrinks below the readable threshold (epic #56 design rule 4). A pinned card is the same node
// type, detached from the anchor and draggable; its position lives in session state only.

import { useRef } from "react";
import { useViewport, type Node, type NodeProps } from "@xyflow/react";
import type { Diagnostic } from "@facilis.dev/analyze";
import { t } from "@/i18n";
import type { ProjectGraphEdge, ProjectGraphNode } from "@/facilis/graph-model";
import type { NodeDetails } from "@/facilis/graph-details";
import { SATELLITE_HEIGHT, SATELLITE_WIDTH } from "@/facilis/graph-satellite";
import { LinkHandles } from "./ProjectGraphNodeChrome";
import { ProjectGraphInspector } from "./ProjectGraphInspector";
import { useDetailsDialog } from "./use-details-dialog";

/** The React Flow node type for the satellite; registered in PROJECT_GRAPH_NODE_TYPES. */
export const DETAILS_NODE_TYPE = "details";

export type ProjectDetailsFlowData = {
  readonly node: ProjectGraphNode;
  readonly edges: readonly ProjectGraphEdge[];
  readonly details: NodeDetails | null;
  /** Analyzer errors/warnings attached to this node (issue #69), in analysis order. */
  readonly diagnostics: readonly Diagnostic[];
  readonly sources: ReadonlyMap<string, string>;
  readonly nodeLabel: (id: string) => string | null;
  readonly pinned: boolean;
  readonly onClose: () => void;
  readonly onTogglePin: () => void;
  readonly onOpenFileAt: (file: string, line: number) => void;
  readonly onOpenPreview: (path: string) => void;
  readonly onSelectNode: (id: string) => void;
};

export type ProjectDetailsFlowNode = Node<ProjectDetailsFlowData, typeof DETAILS_NODE_TYPE>;

export function ProjectGraphDetailsNode({ data }: NodeProps<ProjectDetailsFlowNode>) {
  const { zoom } = useViewport();
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = useDetailsDialog(ref, data.onClose);
  const scale = zoom > 0 ? 1 / zoom : 1;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t("projectGraph.details")}
      data-testid={data.pinned ? "project-graph-details-pinned" : "project-graph-details"}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      // A pinned card drags by its header (the body is nodrag); the satellite never drags.
      className={data.pinned ? "cursor-grab" : "nodrag cursor-default"}
      style={{ width: SATELLITE_WIDTH * scale, height: SATELLITE_HEIGHT * scale }}
    >
      <div
        style={{
          width: SATELLITE_WIDTH,
          height: SATELLITE_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <ProjectGraphInspector
          node={data.node}
          edges={data.edges}
          details={data.details}
          diagnostics={data.diagnostics}
          sources={data.sources}
          nodeLabel={data.nodeLabel}
          pinned={data.pinned}
          onClose={data.onClose}
          onTogglePin={data.onTogglePin}
          onOpenFileAt={data.onOpenFileAt}
          onOpenPreview={data.onOpenPreview}
          onSelectNode={data.onSelectNode}
        />
      </div>
      {/* Hidden anchors for the dashed connector; the floating edge ignores their sides. */}
      <LinkHandles />
    </div>
  );
}
