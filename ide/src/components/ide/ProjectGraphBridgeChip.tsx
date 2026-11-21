// The bridges lens chip (issue #65): the first lens chip in the HUD's bottom-left slot, kept
// self-contained so the lens-chip strip (#63) can absorb it later. A plain toggle button:
// keyboard-operable, aria-pressed, role tokens only (D-044), every string via t() (D-043).
// The B shortcut lives in the panel; the chip's title advertises it.

import Spline from "~icons/lucide/spline";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export function ProjectGraphBridgeChip({
  bridges,
  onToggle,
}: {
  readonly bridges: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      data-testid="graph-bridge-chip"
      aria-pressed={bridges}
      aria-label={t("projectGraph.bridges")}
      title={t("projectGraph.bridgesHint")}
      className={bridges ? "bg-accent text-accent-foreground" : "text-muted-foreground"}
      onClick={onToggle}
    >
      <Spline />
      <span className="hidden xl:inline">{t("projectGraph.bridges")}</span>
    </Button>
  );
}
