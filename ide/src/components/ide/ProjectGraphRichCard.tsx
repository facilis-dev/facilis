// The on-demand rich card for a graph node (D-219, issue #188). It is the same analyzer facts
// the inspector joins, shown on demand anchored to the node; the shell owns dismissal and the
// kind switch, and every per-kind body is a small module of its own. The card never fits,
// centres or moves the camera or the scene: placement lives in the surface and card-position.ts.

import { useEffect, type RefObject, type ReactNode } from "react";
import X from "~icons/lucide/x";
import { Button } from "@/components/ui/button";
import { t, type MessageKey } from "@/i18n";
import type { NodeDetails } from "@/facilis/graph-details";
import type { ProjectGraphNode } from "@/facilis/graph-model";
import { cn } from "@/lib/utils";
import { ProjectGraphRichCardPage } from "./ProjectGraphRichCardPage";
import { ProjectGraphRichCardRoute } from "./ProjectGraphRichCardRoute";
import { ProjectGraphRichCardTable } from "./ProjectGraphRichCardTable";
import { ProjectGraphRichCardView } from "./ProjectGraphRichCardView";
import { ProjectGraphRichCardWorkflow } from "./ProjectGraphRichCardWorkflow";

export type RichCardLayout = "anchored" | "sheet";

/** What the panel hands the surface: the node to anchor to and the rendered card body. */
export interface RichCardRequest {
  readonly nodeId: string;
  readonly render: (layout: RichCardLayout, cardRef: RefObject<HTMLDivElement | null>) => ReactNode;
}

export interface ProjectGraphRichCardProps {
  node: ProjectGraphNode;
  details: NodeDetails | null;
  nodeLabel: (id: string) => string | null;
  onSelectNode: (id: string) => void;
  onClose: () => void;
  layout: RichCardLayout;
  cardRef: RefObject<HTMLDivElement | null>;
}

export function ProjectGraphRichCard({
  node,
  details,
  nodeLabel,
  onSelectNode,
  onClose,
  layout,
  cardRef,
}: ProjectGraphRichCardProps) {
  // Outside pointer-down closes the top layer; the effect only listens while the card is mounted,
  // so the drawer's own outside handler is unaffected when the card is closed.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const card = cardRef.current;
      if (card !== null && !card.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [cardRef, onClose]);

  return (
    <aside
      ref={cardRef}
      role="dialog"
      aria-label={t("projectGraph.surface.card.label")}
      data-testid="project-graph-rich-card"
      data-layout={layout}
      className={cn(
        "pointer-events-auto absolute z-30 flex flex-col overflow-hidden rounded-lg border bg-card text-xs shadow-xl",
        layout === "sheet" ? "inset-x-2 bottom-2 max-h-[70%]" : "max-h-[calc(100%-1rem)]",
      )}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b bg-muted/30 px-2">
        <span className="shrink-0 rounded border border-border px-1 text-[9px] text-muted-foreground uppercase">
          {t(("projectGraph.node." + node.kind) as MessageKey)}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={node.label}>
          {node.label}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("projectGraph.surface.card.close")}
          title={t("projectGraph.surface.card.close")}
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        {node.data.kind === "page" && (
          <ProjectGraphRichCardPage
            page={node.data}
            details={details?.kind === "page" ? details.page : null}
            nodeLabel={nodeLabel}
            onSelectNode={onSelectNode}
          />
        )}
        {node.data.kind === "route" && (
          <ProjectGraphRichCardRoute
            route={node.data}
            details={details?.kind === "route" ? details.route : null}
            nodeLabel={nodeLabel}
            onSelectNode={onSelectNode}
          />
        )}
        {node.data.kind === "table" && (
          <ProjectGraphRichCardTable
            table={node.data}
            details={details?.kind === "table" ? details.table : null}
            nodeLabel={nodeLabel}
            onSelectNode={onSelectNode}
          />
        )}
        {node.data.kind === "view" && (
          <ProjectGraphRichCardView
            view={node.data}
            nodeLabel={nodeLabel}
            onSelectNode={onSelectNode}
          />
        )}
        {node.data.kind === "workflow" && (
          <ProjectGraphRichCardWorkflow
            workflow={node.data}
            details={details?.kind === "workflow" ? details.workflow : null}
            nodeLabel={nodeLabel}
            onSelectNode={onSelectNode}
          />
        )}
      </div>
    </aside>
  );
}
