// The details body (issue #59): the facts for the selected node, rendered inside the in-canvas
// satellite or the bottom sheet — never as a layout sibling. This file is only the frame and the
// kind switch; the facts, the source snippet and the styling primitives live in the per-kind
// section modules, so no one file grows past the limit as sections are added.

import { useContext } from "react";
import type { Diagnostic } from "@facilis.dev/analyze";
import Pin from "~icons/lucide/pin";
import PinOff from "~icons/lucide/pin-off";
import X from "~icons/lucide/x";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { ProjectGraphEdge, ProjectGraphNode } from "@/facilis/graph-model";
import type { NodeDetails } from "@/facilis/graph-details";
import { ProjectGraphDiagnosticsSection } from "./ProjectGraphDiagnosticsSection";
import { ProjectGraphPageDetails } from "./ProjectGraphPageDetails";
import { ProjectGraphRouteDetails } from "./ProjectGraphRouteDetails";
import { ProjectGraphRuntimeSection } from "./ProjectGraphRuntimeSection";
import { RuntimeLensContext } from "./ProjectGraphRuntimeMarks";
import { ProjectGraphTableDetails } from "./ProjectGraphTableDetails";
import { ProjectGraphViewDetails } from "./ProjectGraphViewDetails";
import { ProjectGraphWorkflowDetails } from "./ProjectGraphWorkflowDetails";

export interface ProjectGraphInspectorProps {
  node: ProjectGraphNode;
  edges: readonly ProjectGraphEdge[];
  details: NodeDetails | null;
  /** Analyzer errors/warnings attached to this node (issue #69), in analysis order. */
  diagnostics: readonly Diagnostic[];
  sources: ReadonlyMap<string, string>;
  nodeLabel: (id: string) => string | null;
  /** True when this body is a pinned free-floating card: the pin button becomes "unpin". */
  pinned: boolean;
  /** True in the bottom sheet, where the body fills the width instead of the 320px card. */
  fill?: boolean;
  /** False in matrix mode (issue #67, F.7): pinning places a CANVAS card, and there is no canvas. */
  canPin?: boolean;
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
  diagnostics,
  sources,
  nodeLabel,
  pinned,
  fill = false,
  canPin = true,
  onClose,
  onTogglePin,
  onOpenFileAt,
  onOpenPreview,
  onSelectNode,
}: ProjectGraphInspectorProps) {
  // The runtime lens (issue #72) travels through context, so the section renders in the
  // satellite, the pinned cards AND the bottom sheet without threading a prop through each.
  const runtime = useContext(RuntimeLensContext);
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
        {canPin && (
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
        )}
      </div>
      {/* nowheel: the wheel scrolls the details, not the canvas zoom; nodrag keeps a pinned
          card's drag on its header; select-text so ids and snippets can be copied. */}
      <div className="nowheel nodrag min-h-0 flex-1 space-y-2 overflow-auto p-2 select-text">
        {/* Diagnostics first (issue #69): the messages behind the card's ring, on the existing
            floating details surface — no new panel (epic rule 1). In matrix mode the sheet is
            this same body (F.7), so the lens surfaces there too. */}
        <ProjectGraphDiagnosticsSection diagnostics={diagnostics} onOpenFileAt={onOpenFileAt} />
        {node.data.kind === "route" && (
          <>
            {/* The runtime section (issue #72) leads the route details while the lens is active. */}
            {runtime !== null && (
              <ProjectGraphRuntimeSection route={node.data} window={runtime.window} />
            )}
            <ProjectGraphRouteDetails
              {...shared}
              details={details?.kind === "route" ? details.route : null}
            />
          </>
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
