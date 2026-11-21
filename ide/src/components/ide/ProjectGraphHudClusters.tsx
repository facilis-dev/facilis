// The HUD's cluster controls (issue #62), in the top-left breadcrumb slot of issue #57: the
// group-by mode toggle, beside the #128 breadcrumb trail that now owns the project → cluster →
// node levels (the drill-up affordance is the trail's project root plus the Esc ladder, so the
// two cannot show two competing trails). Floating HUD only — no side panel (epic #56 rule 1);
// role tokens and t() throughout (D-043/D-044).

import Boxes from "~icons/lucide/boxes";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export interface ProjectGraphHudClustersProps {
  /** The effective mode state (auto resolves against the node count above this component). */
  enabled: boolean;
  onToggleGroupBy: () => void;
}

export function ProjectGraphHudClusters({
  enabled,
  onToggleGroupBy,
}: ProjectGraphHudClustersProps) {
  return (
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
  );
}
