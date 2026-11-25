// The project-graph inspector: the selected node's details panel. This file is only the
// layout and the kind switch; the facts, the source snippet and the styling primitives live in
// the per-kind section modules, so no one file grows past the limit as sections are added.

import Maximize2 from "~icons/lucide/maximize-2";
import X from "~icons/lucide/x";
import type { GraphEdge, PrerenderEligibilityFact } from "@facilis.dev/analyze";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { ProjectGraphEdge, ProjectGraphNode } from "@/facilis/graph-model";
import type { NodeDetails } from "@/facilis/graph-details";
import { prerenderFactForPage, prerenderedPagesForRoute } from "@/facilis/graph-prerender";
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
  onClose: () => void;
  onExpand: () => void;
  onOpenFileAt: (file: string, line: number) => void;
  onOpenPreview: (path: string) => void;
  onSelectNode: (id: string) => void;
  /** The drawn page nodes, for the route satellite's prerendered-page join (D-202). */
  nodes: readonly ProjectGraphNode[];
  prerenderFacts: readonly PrerenderEligibilityFact[];
  /** The unfiltered analyzer edges: hiding an edge kind must not hide prerender callers. */
  graphEdges: readonly GraphEdge[];
  onTogglePrerender: (path: string, enabled: boolean) => Promise<boolean>;
}

export function ProjectGraphInspector({
  node,
  edges,
  details,
  sources,
  nodeLabel,
  onClose,
  onExpand,
  onOpenFileAt,
  onOpenPreview,
  onSelectNode,
  nodes,
  prerenderFacts,
  graphEdges,
  onTogglePrerender,
}: ProjectGraphInspectorProps) {
  const shared = { node, sources, nodeLabel, onOpenFileAt, onSelectNode };
  return (
    <aside
      data-testid="project-graph-inspector"
      className="flex h-full w-full min-h-0 flex-col bg-sidebar text-xs"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
        <span className="flex-1 truncate text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {t("projectGraph.details")}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("projectGraph.surface.card.open")}
          title={t("projectGraph.surface.card.open")}
          onClick={onExpand}
        >
          <Maximize2 />
        </Button>
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
            prerenderedPages={prerenderedPagesForRoute(prerenderFacts, nodes, graphEdges, node.id)}
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
            prerenderFact={prerenderFactForPage(prerenderFacts, node.data.routePaths)}
            onTogglePrerender={onTogglePrerender}
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
