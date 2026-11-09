// The status bar's runtime controls (D-124).
//
// The bottom panel (Console / Terminal / Ports) is closed by default and no longer
// carries a tab strip, so these chips are its only door: each opens the panel on one
// surface, and clicking the active one closes it again. The same row carries the
// project's Run/Stop control, because starting the app must not require opening a
// terminal any more.

import Circle from "~icons/lucide/circle";
import Loader from "~icons/lucide/loader-circle";
import Play from "~icons/lucide/play";
import Plug from "~icons/lucide/plug";
import ScrollText from "~icons/lucide/scroll-text";
import Square from "~icons/lucide/square";
import SquareTerminal from "~icons/lucide/square-terminal";
import TriangleAlert from "~icons/lucide/triangle-alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { phaseLabel } from "@/vv/run-phase";
import { useIde } from "./useIde";

type PanelTab = "console" | "terminal" | "ports";

/** One status-bar control: a button with VS Code's hover highlight and a tooltip
 *  (the bar is too short to explain itself). "pressed" renders the panel toggles'
 *  active state. */
function StatusChip({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={onClick}
        aria-label={label}
        aria-pressed={pressed}
        className={cn(
          "flex h-6 min-w-0 items-center gap-1 whitespace-nowrap px-2 transition-colors hover:bg-brand-foreground/20",
          pressed && "bg-brand-foreground/20",
        )}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Play / progress / Stop for the active folder — the only start control that is
 *  always on screen. Every state is a readout of the snapshot; the run itself lives
 *  in the controller. */
export function StatusBarRun() {
  const { c, snap } = useIde();
  // Home covers the workspace, and without a folder there is nothing to run.
  if (snap.workspaceFolders.length === 0) return null;

  const showTerminal = () => c.terminals.setPanelTab("terminal");
  const stop = (
    <StatusChip label={t("run.stopHint")} onClick={() => c.stopRun()}>
      <Square className="size-3.5" />
    </StatusChip>
  );

  // A run that died before its server bound a port: the terminal that explains why
  // is closed by default, so the chip is what says so (and opens it on click).
  if (snap.runFailed) {
    return (
      <StatusChip label={t("run.failedHint")} onClick={showTerminal}>
        <TriangleAlert className="size-3.5" />
        {t("run.failed")}
      </StatusChip>
    );
  }
  if (snap.runPhase) {
    return (
      <>
        <StatusChip label={t("run.showTerminal")} onClick={showTerminal}>
          <Loader className="size-3.5 shrink-0 animate-spin" />
          <span className="min-w-0 truncate">
            {phaseLabel(snap.runPhase.phase)} · {snap.runPhase.name}
          </span>
        </StatusChip>
        {snap.runTerminalId && stop}
      </>
    );
  }
  // The server is up (the phase ends when the preview paints): offer the app, not
  // the log — and keep the ability to stop it, which the hidden terminal took away.
  if (snap.runTerminalId) {
    return (
      <>
        <StatusChip label={t("run.runningHint")} onClick={() => c.togglePreview(false)}>
          <Circle className="size-2.5 fill-current" />
          {t("run.running")}
        </StatusChip>
        {stop}
      </>
    );
  }
  return (
    <StatusChip label={t("run.startHint")} onClick={() => c.runActiveFolder()}>
      <Play className="size-3.5" />
      {t("run.start")}
    </StatusChip>
  );
}

/** Console / Terminal / Ports, at the far right of the status bar. Console is
 *  icon-only: it is the kernel log, the one surface an app user never needs. */
export function StatusBarPanels() {
  const { c, snap } = useIde();
  // Nothing to show on Home, and no panel to open without a folder.
  if (snap.workspaceFolders.length === 0) return null;

  const open = !snap.panelCollapsed;
  const active = (tab: PanelTab) => open && snap.panelTab === tab;
  const select = (tab: PanelTab) => {
    if (active(tab)) c.togglePanel(false);
    else c.terminals.setPanelTab(tab);
  };

  return (
    <div className="flex items-center">
      <span aria-hidden className="mx-1 h-3.5 w-px shrink-0 bg-brand-foreground/25" />
      <StatusChip
        label={t("panel.openConsole")}
        pressed={active("console")}
        onClick={() => select("console")}
      >
        <ScrollText className="size-3.5" />
      </StatusChip>
      <StatusChip
        label={t("panel.openTerminal")}
        pressed={active("terminal")}
        onClick={() => select("terminal")}
      >
        <SquareTerminal className="size-3.5" />
        <span className="hidden lg:inline">{t("panel.terminal")}</span>
      </StatusChip>
      <StatusChip
        label={t("panel.openPorts")}
        pressed={active("ports")}
        onClick={() => select("ports")}
      >
        <Plug className="size-3.5" />
        {/* Labels collapse on narrow windows: three chips always fit, and the
            tooltip still names each one. */}
        <span className="hidden lg:inline">{t("panel.ports")}</span>
        {snap.ports.length > 0 && (
          <span className="rounded bg-brand-foreground/20 px-1 text-[10px] leading-4">
            {snap.ports.length}
          </span>
        )}
      </StatusChip>
    </div>
  );
}
