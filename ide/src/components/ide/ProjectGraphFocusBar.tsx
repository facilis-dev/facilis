// The selection-context line of the HUD (issue #66, epic #56 rule 1): a floating part of the
// top-left cluster, never a side panel. With a selection it reports the reachability closure
// ("N nodes reachable, X pages, Y tables") and offers Isolate; while isolated the same line
// offers the one-step exit. Isolation is DIM-ONLY (F.5): the full graph stays on screen, so
// there is no breadcrumb — the bar is a mode indicator, not a navigation back from a removed
// subgraph. The summary is an aria-live="polite" region whose text is derived from the same
// closure the canvas highlights, so the announcement matches the count (criterion 3). Role
// tokens only (D-044); every string via t() (D-043).

import Focus from "~icons/lucide/focus";
import Undo2 from "~icons/lucide/undo-2";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { GraphClosureSummary } from "@/facilis/graph-user-focus";

export interface ProjectGraphFocusBarProps {
  /** The current closure counts; null when nothing is highlighted. */
  readonly summary: GraphClosureSummary | null;
  /** True while the dim-only isolate mode is active (issue #66, F.5). */
  readonly isolated: boolean;
  readonly selectedNodeId: string | null;
  /** Sets the isolate id (Enter's action) or null to exit; the panel's URL-persisted setter. */
  readonly onIsolateChange: (id: string | null) => void;
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
  isolated,
  selectedNodeId,
  onIsolateChange,
}: ProjectGraphFocusBarProps) {
  // A stale isolate id can leave the mode on with no closure: the exit affordance still shows.
  if (summary === null && !isolated) return null;
  return (
    <span
      data-testid="graph-focus-bar"
      role="group"
      aria-label={t("projectGraph.focus.label")}
      className="flex min-w-0 items-center gap-1"
    >
      {summary !== null ? (
        <span
          aria-live="polite"
          data-testid="graph-focus-summary"
          className="truncate text-[11px] text-muted-foreground"
        >
          {summaryText(summary)}
        </span>
      ) : null}
      {isolated ? (
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="graph-focus-exit-isolate"
          aria-label={t("projectGraph.focus.exitIsolate")}
          title={t("projectGraph.focus.exitIsolateHint")}
          onClick={() => onIsolateChange(null)}
        >
          <Undo2 />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          data-testid="graph-focus-isolate"
          aria-label={t("projectGraph.focus.isolate")}
          title={t("projectGraph.focus.isolateHint")}
          onClick={() => {
            if (selectedNodeId !== null) onIsolateChange(selectedNodeId);
          }}
        >
          <Focus />
          {t("projectGraph.focus.isolate")}
        </Button>
      )}
    </span>
  );
}
