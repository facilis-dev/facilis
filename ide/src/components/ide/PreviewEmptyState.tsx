import { useEffect, useState } from "react";
import Loader from "~icons/lucide/loader-circle";
import Play from "~icons/lucide/play";
import Plus from "~icons/lucide/plus";
import TriangleAlert from "~icons/lucide/triangle-alert";
import { t } from "@/i18n";
import { phaseLabel, type RunPhase } from "@/vv/run-phase";
import { useIde } from "./useIde";

const BUTTON =
  "flex items-center gap-1.5 rounded border px-2 py-1 text-xs hover:bg-accent hover:text-foreground";

/** An active tab with no port yet: an empty address the user can type into. */
export function PreviewEmptyTab() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-sidebar px-6 text-center text-sm text-muted-foreground">
      {t("preview.emptyTab")}
    </div>
  );
}

/** What the preview shows while it has no tab: the run's progress, why the run did
 *  not start, or the ways to get a frame. "New project" lands here, so the Run CTA
 *  lives here as well — the status bar chip is the other door (D-124). */
export function PreviewEmptyState() {
  const { c, snap } = useIde();

  if (snap.runPhase) return <RunProgress phase={snap.runPhase} />;

  if (snap.runFailed) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-sidebar px-6 text-center">
        <div className="flex items-center gap-2 text-sm font-medium text-warning">
          <TriangleAlert className="size-4" />
          {t("preview.startFailed")}
        </div>
        <p className="max-w-xs text-xs text-muted-foreground">{t("run.failedHint")}</p>
        <div className="flex items-center gap-2">
          <button className={BUTTON} onClick={() => c.terminals.setPanelTab("terminal")}>
            {t("run.showTerminal")}
          </button>
          <button className={BUTTON} onClick={() => c.runActiveFolder()}>
            <Play className="size-3.5" /> {t("preview.retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-sidebar text-sm text-muted-foreground">
      <span>{t("preview.empty")}</span>
      {snap.workspaceFolders.length > 0 && (
        <button className={BUTTON} onClick={() => c.runActiveFolder()}>
          <Play className="size-3.5" /> {t("preview.runProject")}
        </button>
      )}
      <button className={BUTTON} onClick={() => c.preview.addPreviewTab()}>
        <Plus className="size-3.5" /> {t("preview.newTab")}
      </button>
    </div>
  );
}

// What the panel says between "Create" and the first frame — up to half a minute
// on a cold install, during which it used to say "No preview open.", i.e. read
// as *nothing is happening*, the exact opposite of the truth.
//
// Deliberately not a bare spinner. The phase says which of two very differently
// priced things is running (a snapshot restore or a real install), the counts
// let the user judge whether it is moving, and the elapsed clock lets them
// decide it is not. None of it is a forecast: nothing here knows a total, and a
// fake progress bar that stalls at 90% is worse than an honest counter.
function RunProgress({ phase }: { phase: RunPhase }) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - phase.startedAt) / 1000));
  useEffect(() => {
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - phase.startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [phase.startedAt]);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-sidebar px-6 text-center">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Loader className="size-4 animate-spin text-primary" />
        {phaseLabel(phase.phase)}
      </div>
      <div className="text-xs text-muted-foreground">
        {phase.name}
        {phase.detail ? " · " + phase.detail : ""}
        {elapsed >= 3 ? " · " + elapsed + "s" : ""}
      </div>
      <div className="max-w-xs text-xs text-muted-foreground">{t("preview.progressHint")}</div>
    </div>
  );
}
