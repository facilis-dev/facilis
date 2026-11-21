// The impact-simulation line of the HUD (issue #74, epic #56 rule 1): a floating part of the
// top-left cluster, never a side panel. While the lens simulates a removal it reports the
// dependents ("N routes, M views") as an aria-live region derived from the same cascade the
// canvas highlights; with nothing suitable selected it shows the hint instead, and an
// unanalysed column says so honestly. Role tokens only (D-044); every string via t() (D-043).

import Undo2 from "~icons/lucide/undo-2";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { ImpactHud } from "./useProjectGraphImpact";

export interface ProjectGraphImpactBarProps {
  readonly hud: ImpactHud;
  readonly onExit: () => void;
}

export function ProjectGraphImpactBar({ hud, onExit }: ProjectGraphImpactBarProps) {
  if (!hud.active) return null;
  const text =
    hud.counts !== null
      ? t("projectGraph.impact.counts", { routes: hud.counts.routes, views: hud.counts.views })
      : hud.columnNotAnalysed
        ? t("projectGraph.impact.columnNotAnalysed")
        : t("projectGraph.impact.hint");
  return (
    <span
      data-testid="graph-impact-bar"
      role="group"
      aria-label={t("projectGraph.impact.label")}
      className="flex min-w-0 items-center gap-1"
    >
      <span aria-hidden="true" className="shrink-0 text-xs text-muted-foreground">
        ›
      </span>
      <span
        aria-live="polite"
        data-testid="graph-impact-summary"
        className={
          "truncate text-[11px] " +
          (hud.counts !== null ? "text-destructive" : "text-muted-foreground")
        }
      >
        {text}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        data-testid="graph-impact-exit"
        aria-label={t("projectGraph.impact.exit")}
        title={t("projectGraph.impact.exitHint")}
        onClick={onExit}
      >
        <Undo2 />
      </Button>
    </span>
  );
}
