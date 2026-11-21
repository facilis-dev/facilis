// The runtime lens's floating control strip (issue #72): the 1/5/15-minute window segmented
// control and the live toggle, docked in the HUD's bottom-left cluster beside the lens chips
// (the #69 audit-ribbon slot pattern). Both options ride the gv URL state, so the whole view
// round-trips (epic rule 6); every button is named and keyboard-reachable, aria-pressed carries
// the state. Live off reads the last snapshot instead of pushing updates.

import Activity from "~icons/lucide/activity";
import { Button } from "@/components/ui/button";
import { t, type MessageKey } from "@/i18n";
import { RUNTIME_WINDOW_IDS, type RuntimeWindow } from "@/facilis/graph-runtime";

export function ProjectGraphRuntimeControls({
  window: currentWindow,
  live,
  onWindowChange,
  onLiveChange,
}: {
  window: RuntimeWindow;
  live: boolean;
  onWindowChange: (window: RuntimeWindow) => void;
  onLiveChange: (live: boolean) => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label={t("projectGraph.runtime.controls")}
      data-testid="graph-runtime-controls"
      className="ml-0.5 flex items-center gap-0.5 border-l border-border pl-1"
    >
      {RUNTIME_WINDOW_IDS.map((id) => {
        const label = t(("projectGraph.runtime.window." + id) as MessageKey);
        const active = id === currentWindow;
        return (
          <Button
            key={id}
            variant="ghost"
            size="xs"
            data-testid={"graph-runtime-window-" + id}
            aria-pressed={active}
            aria-label={t("projectGraph.runtime.windowHint", { label })}
            title={t("projectGraph.runtime.windowHint", { label })}
            className={active ? "bg-accent text-accent-foreground" : "text-muted-foreground"}
            onClick={() => onWindowChange(id)}
          >
            <span className="tabular-nums">{label}</span>
          </Button>
        );
      })}
      <Button
        variant="ghost"
        size="xs"
        data-testid="graph-runtime-live"
        aria-pressed={live}
        aria-label={t("projectGraph.runtime.liveHint")}
        title={t("projectGraph.runtime.liveHint")}
        className={live ? "bg-accent text-accent-foreground" : "text-muted-foreground"}
        onClick={() => onLiveChange(!live)}
      >
        <Activity />
        <span className="hidden xl:inline">{t("projectGraph.runtime.live")}</span>
      </Button>
    </div>
  );
}
