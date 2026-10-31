// Cold-boot progress for the in-browser runtime.
//
// Home shows it while the kernel + VFS start, and the project-boot overlay shows the
// same card when a tab reloads straight into a project (see ProjectBootOverlay). One
// component, so the two surfaces cannot drift: restoring a large saved project from
// OPFS takes seconds, and a silent spinner reads as a hang.
import Loader from "~icons/lucide/loader-circle";
import TriangleAlert from "~icons/lucide/triangle-alert";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { useIde } from "./useIde";

function bootPhaseLabel(phase: string): string {
  switch (phase) {
    case "restore":
      return t("boot.restoring");
    case "finalize":
      return t("boot.finalizing");
    default:
      return t("boot.starting");
  }
}

export function BootStatus() {
  const { snap } = useIde();
  // A runtime that is never coming up must not keep animating a progress bar:
  // the two states were indistinguishable, so a dead kernel worker read as a slow
  // one for as long as the user was willing to wait.
  if (snap.bootError) {
    return (
      <div className="mb-6 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-sm font-medium">{t("boot.failed")}</div>
            <div className="break-words text-xs text-muted-foreground">{snap.bootError}</div>
            <div className="text-xs text-muted-foreground">{t("boot.failedHint")}</div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => location.reload()}
          >
            {t("boot.reload")}
          </Button>
        </div>
      </div>
    );
  }
  const determinate = snap.bootPhase === "restore" && snap.bootTotal > 0;
  const pct = determinate ? Math.min(100, Math.round((snap.bootDone / snap.bootTotal) * 100)) : 0;
  return (
    <div className="mb-6 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <Loader className="mt-0.5 size-5 shrink-0 animate-spin text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">{bootPhaseLabel(snap.bootPhase)}…</span>
            {determinate && (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {t("boot.progress", {
                  done: snap.bootDone.toLocaleString(),
                  total: snap.bootTotal.toLocaleString(),
                  pct,
                })}
              </span>
            )}
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-accent">
            {determinate ? (
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${pct}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/70" />
            )}
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground">{t("boot.settingUp")}</div>
        </div>
      </div>
    </div>
  );
}
