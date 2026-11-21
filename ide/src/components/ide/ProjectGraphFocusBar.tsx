// The selection-context line of the HUD (issue #66, epic #56 rule 1): a floating part of the
// top-left cluster, never a side panel. With a selection it reports the reachability closure
// ("N nodes reachable, X pages, Y tables") and offers Isolate; while isolated it becomes the
// breadcrumb back to the full graph. The summary is an aria-live="polite" region whose text is
// derived from the same closure the canvas highlights, so the announcement matches the count
// (criterion 3). Role tokens only (D-044); every string via t() (D-043).

import Focus from "~icons/lucide/focus";
import Undo2 from "~icons/lucide/undo-2";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { GraphClosureSummary } from "@/facilis/graph-user-focus";

export interface ProjectGraphFocusBarProps {
  /** The current selection's closure counts; null when nothing is selected. */
  readonly summary: GraphClosureSummary | null;
  /** The isolated node's label; null when the full graph is drawn. */
  readonly isolatedLabel: string | null;
  readonly onIsolate: () => void;
  readonly onExitIsolate: () => void;
}

/** The non-zero kind counts, in column order, joined into one readable line. */
function summaryText(summary: GraphClosureSummary): string {
  const parts = [t("projectGraph.focus.reachable", { count: summary.total })];
  if (summary.pages > 0) parts.push(t("projectGraph.focus.pages", { count: summary.pages }));
  if (summary.routes > 0) parts.push(t("projectGraph.focus.routes", { count: summary.routes }));
  if (summary.tables > 0) parts.push(t("projectGraph.focus.tables", { count: summary.tables }));
  if (summary.views > 0) parts.push(t("projectGraph.focus.views", { count: summary.views }));
  if (summary.workflows > 0) {
    parts.push(t("projectGraph.focus.workflows", { count: summary.workflows }));
  }
  return parts.join(", ");
}

export function ProjectGraphFocusBar({
  summary,
  isolatedLabel,
  onIsolate,
  onExitIsolate,
}: ProjectGraphFocusBarProps) {
  if (isolatedLabel !== null) {
    return (
      <span
        data-testid="graph-focus-breadcrumb"
        role="group"
        aria-label={t("projectGraph.focus.label")}
        className="flex min-w-0 items-center gap-1"
      >
        <span aria-hidden="true" className="shrink-0 text-xs text-muted-foreground">
          ›
        </span>
        <span className="truncate text-xs font-medium" title={isolatedLabel}>
          {isolatedLabel}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="graph-focus-exit-isolate"
          aria-label={t("projectGraph.focus.exitIsolate")}
          title={t("projectGraph.focus.exitIsolateHint")}
          onClick={onExitIsolate}
        >
          <Undo2 />
        </Button>
      </span>
    );
  }
  if (summary === null) return null;
  return (
    <span
      data-testid="graph-focus-bar"
      role="group"
      aria-label={t("projectGraph.focus.label")}
      className="flex min-w-0 items-center gap-1"
    >
      <span
        aria-live="polite"
        data-testid="graph-focus-summary"
        className="truncate text-[11px] text-muted-foreground"
      >
        {summaryText(summary)}
      </span>
      <Button
        variant="ghost"
        size="xs"
        data-testid="graph-focus-isolate"
        aria-label={t("projectGraph.focus.isolate")}
        title={t("projectGraph.focus.isolateHint")}
        onClick={onIsolate}
      >
        <Focus />
        {t("projectGraph.focus.isolate")}
      </Button>
    </span>
  );
}
