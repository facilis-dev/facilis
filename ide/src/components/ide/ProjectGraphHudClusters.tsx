// The HUD's cluster controls (issue #62), filling the top-left breadcrumb slot of issue #57:
// the drill-down breadcrumb (root button goes up one level, Esc does the same) and the
// group-by lens toggle. Floating HUD only — no side panel (epic #56 rule 1); role tokens and
// t() throughout (D-043/D-044). Below xl the toggle collapses to its icon like its neighbours.

import Boxes from "~icons/lucide/boxes";
import ChevronRight from "~icons/lucide/chevron-right";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { OTHER_CLUSTER_KEY } from "@/facilis/graph-clusters";

export interface ProjectGraphHudClustersProps {
  /** The effective lens state (auto resolves against the node count above this component). */
  enabled: boolean;
  /** The key of the drilled-into cluster, or null at the root level. */
  drillKey: string | null;
  onToggleGroupBy: () => void;
  onDrillUp: () => void;
}

export function ProjectGraphHudClusters({
  enabled,
  drillKey,
  onToggleGroupBy,
  onDrillUp,
}: ProjectGraphHudClustersProps) {
  const drillLabel =
    drillKey === null
      ? null
      : drillKey === OTHER_CLUSTER_KEY
        ? t("projectGraph.cluster.other")
        : drillKey;
  return (
    <>
      {drillLabel === null ? (
        <span className="truncate text-xs font-medium">{t("projectGraph.title")}</span>
      ) : (
        <span
          data-testid="graph-hud-breadcrumb"
          className="flex min-w-0 items-center gap-1 text-xs"
        >
          <button
            type="button"
            className="shrink-0 rounded px-1 font-medium hover:bg-accent"
            aria-label={t("projectGraph.cluster.drillUp")}
            title={t("projectGraph.cluster.drillUp")}
            onClick={onDrillUp}
          >
            {t("projectGraph.title")}
          </button>
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono font-medium">{drillLabel}</span>
        </span>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        data-testid="graph-hud-group-by"
        aria-pressed={enabled}
        aria-label={t("projectGraph.cluster.toggle")}
        title={t("projectGraph.cluster.toggleHint")}
        onClick={onToggleGroupBy}
      >
        <Boxes className={enabled ? "text-brand" : undefined} />
      </Button>
    </>
  );
}
