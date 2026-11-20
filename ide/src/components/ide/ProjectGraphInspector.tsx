// The details body (issue #59): the facts for the selected node, rendered inside the in-canvas
// satellite or the bottom sheet — never as a layout sibling. This file is only the frame and the
// kind switch; the facts, the source snippet and the styling primitives live in the per-kind
// section modules, so no one file grows past the limit as sections are added.

import Pin from "~icons/lucide/pin";
import PinOff from "~icons/lucide/pin-off";
import X from "~icons/lucide/x";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { ProjectGraphEdge, ProjectGraphNode } from "@/facilis/graph-model";
import type { NodeDetails } from "@/facilis/graph-details";
import { ProjectGraphPageDetails } from "./ProjectGraphPageDetails";
import { ProjectGraphRouteDetails } from "./ProjectGraphRouteDetails";
import { ProjectGraphTableDetails } from "./ProjectGraphTableDetails";
import { ProjectGraphViewDetails } from "./ProjectGraphViewDetails";
import { ProjectGraphWorkflowDetails } from "./ProjectGraphWorkflowDetails";

export interface ProjectGraphInspectorProps {
  node: ProjectGraphNode;
  edges: readonly ProjectGraphEdge[];
  details: NodeDetails | null;
  sources: ReadonlyMap<string, string>;
  nodeLabel: (id: string) => string | null;
  /** True when this body is a pinned free-floating card: the pin button becomes "unpin". */
  pinned: boolean;
  /** True in the bottom sheet, where the body fills the width instead of the 320px card. */
  fill?: boolean;
  onClose: () => void;
  onTogglePin: () => void;
  onOpenFileAt: (file: string, line: number) => void;
  onOpenPreview: (path: string) => void;
  onSelectNode: (id: string) => void;
}

export function ProjectGraphInspector({
  node,
  edges,
  details,
  sources,
  nodeLabel,
  pinned,
  fill = false,
  onClose,
  onTogglePin,
  onOpenFileAt,
  onOpenPreview,
  onSelectNode,
}: ProjectGraphInspectorProps) {
  const shared = { node, sources, nodeLabel, onOpenFileAt, onSelectNode };
  return (
    <div
      data-testid="project-graph-inspector"
      className={
        (fill ? "w-full" : "w-80") +
        " flex h-full max-w-full flex-col overflow-hidden rounded-lg border border-border bg-sidebar text-xs shadow-lg"
      }
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
        <span className="flex-1 truncate text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {t("projectGraph.details")}
        </span>
        {/* Close stays the first button: keyboard and smoke reach it before the pin. */}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("projectGraph.closeDetails")}
          title={t("projectGraph.closeDetails")}
          onClick={onClose}
        >
          <X />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t(pinned ? "projectGraph.unpinDetails" : "projectGraph.pinDetails")}
          title={t(pinned ? "projectGraph.unpinDetails" : "projectGraph.pinDetails")}
          aria-pressed={pinned}
          onClick={onTogglePin}
        >
          {pinned ? <PinOff /> : <Pin />}
        </Button>
      </div>
      {/* nowheel: the wheel scrolls the details, not the canvas zoom; nodrag keeps a pinned
          card's drag on its header; select-text so ids and snippets can be copied. */}
      <div className="nowheel nodrag min-h-0 flex-1 space-y-2 overflow-auto p-2 select-text">
        {node.data.kind === "route" && (
          <ProjectGraphRouteDetails
            {...shared}
            details={details?.kind === "route" ? details.route : null}
          />
        )}
        {node.data.kind === "table" && (
          <ProjectGraphTableDetails
            {...shared}
            edges={edges}
            details={details?.kind === "table" ? details.table : null}
          />
        )}
        {node.data.kind === "page" && (
          <ProjectGraphPageDetails
            {...shared}
            edges={edges}
            details={details?.kind === "page" ? details.page : null}
            onOpenPreview={onOpenPreview}
          />
        )}
        {node.data.kind === "view" && (
          <ProjectGraphViewDetails
            {...shared}
            details={details?.kind === "view" ? details.view : null}
          />
        )}
        {node.data.kind === "workflow" && (
          <ProjectGraphWorkflowDetails
            {...shared}
            details={details?.kind === "workflow" ? details.workflow : null}
          />
        )}
      </div>
    </div>
  );
}
