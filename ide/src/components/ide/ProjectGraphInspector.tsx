// The project-graph inspector: the selected node's details panel. This file is only the
// layout and the kind switch; the facts, the source snippet and the styling primitives live in
// the per-kind section modules, so no one file grows past the limit as sections are added.

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
  locales: Readonly<Record<string, Readonly<Record<string, string>>>>;
  defaultLocale: string | null;
  nodeLabel: (id: string) => string | null;
  onClose: () => void;
  onOpenFileAt: (file: string, line: number) => void;
  onOpenPreview: (path: string) => void;
  onSelectNode: (id: string) => void;
}

export function ProjectGraphInspector({
  node,
  edges,
  details,
  sources,
  locales,
  defaultLocale,
  nodeLabel,
  onClose,
  onOpenFileAt,
  onOpenPreview,
  onSelectNode,
}: ProjectGraphInspectorProps) {
  const shared = { node, sources, nodeLabel, onOpenFileAt, onSelectNode };
  return (
    <aside
      data-testid="project-graph-inspector"
      className="flex w-80 shrink-0 flex-col border-l bg-sidebar text-xs"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
        <span className="flex-1 truncate text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {t("projectGraph.details")}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("projectGraph.closeDetails")}
          title={t("projectGraph.closeDetails")}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
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
            locales={locales}
            defaultLocale={defaultLocale}
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
    </aside>
  );
}
