// The edge-concentration threshold chip (issue #64): off / 4 / 8, wired to the addressable
// view state (#58). A named, keyboard-reachable toolbar like every HUD control; below xl the
// "off" label collapses to its icon while the numeric thresholds stay visible (they are
// language-neutral). Role tokens only (D-044); every string via t() (D-043).

import GitBranch from "~icons/lucide/git-branch";
import GitMerge from "~icons/lucide/git-merge";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { EDGE_CONCENTRATIONS, type GraphEdgeConcentration } from "@/facilis/graph-view-state";

export function ProjectGraphConcentrationChip({
  concentration,
  onChange,
}: {
  concentration: GraphEdgeConcentration;
  onChange: (value: GraphEdgeConcentration) => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label={t("projectGraph.hud.concentration")}
      data-testid="graph-hud-concentration"
      className="flex items-center gap-0.5"
    >
      {EDGE_CONCENTRATIONS.map((value) => {
        const active = value === concentration;
        const aria =
          value === "off"
            ? t("projectGraph.concentration.setOff")
            : t("projectGraph.concentration.setThreshold", { count: value });
        return (
          <Button
            key={String(value)}
            variant="ghost"
            size="xs"
            data-testid={"graph-concentration-" + String(value)}
            aria-pressed={active}
            aria-label={aria}
            title={t("projectGraph.concentration.hint")}
            className={active ? "bg-accent text-accent-foreground" : "text-muted-foreground"}
            onClick={() => onChange(value)}
          >
            {value === "off" ? <GitBranch /> : <GitMerge />}
            <span className={value === "off" ? "hidden xl:inline" : "tabular-nums"}>
              {value === "off" ? t("projectGraph.concentration.off") : String(value)}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
