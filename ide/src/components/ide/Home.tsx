import { useEffect, useState } from "react";
import FilePlus from "~icons/lucide/file-plus-2";
import Clock from "~icons/lucide/clock";
import ArrowLeft from "~icons/lucide/arrow-left";
import FolderInput from "~icons/lucide/folder-input";
import RotateCcw from "~icons/lucide/rotate-ccw";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { useIde } from "./useIde";
import { entriesFromDataTransfer } from "@/vv/controller";
import { RecentProjectsRow } from "./RecentProjectsRow";
import { BootStatus } from "./BootStatus";
import { HomeImportCards } from "./HomeImportCards";
import { NewProjectDialog } from "./NewProjectDialog";

export function HomeView() {
  const { c, snap } = useIde();
  const [newOpen, setNewOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const entries = entriesFromDataTransfer(e.dataTransfer);
    if (entries.length) void c.importDropAsProject(entries);
  };

  return (
    <div
      className="absolute inset-0 z-40 overflow-auto bg-background"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-50 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/60 bg-primary/5 text-sm font-medium text-primary">
          <FolderInput className="size-8" />
          {t("home.dropHint")}
        </div>
      )}
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
        <div className="mb-8 flex items-center gap-3">
          <h1 aria-label="facilis.dev" className="brand-lockup h-7 w-[140px] shrink-0" />
          {snap.workspaceFolders.length > 0 && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => c.showWorkspace()}>
              <ArrowLeft className="size-4" /> {t("home.backToWorkspace")}
            </Button>
          )}
        </div>

        {/* Boot banner: kept mounted and collapsed smoothly (height + opacity)
            once the kernel is ready, so the action grid glides into place instead
            of jumping when it disappears. */}
        <div
          className={cn(
            "grid transition-all duration-500 ease-out",
            snap.kernelReady
              ? "mb-0 grid-rows-[0fr] opacity-0"
              : "mb-6 grid-rows-[1fr] opacity-100",
          )}
        >
          <div className="overflow-hidden">
            <BootStatus />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <button
            onClick={() => setNewOpen(true)}
            className="group flex flex-col items-start gap-3 rounded-xl border bg-card p-5 text-left transition-colors hover:border-primary/60 hover:bg-accent/40"
          >
            <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FilePlus className="size-6" />
            </div>
            <div>
              <div className="font-medium">{t("home.newProject")}</div>
              <div className="text-sm text-muted-foreground">{t("home.newProjectDesc")}</div>
            </div>
          </button>
          <HomeImportCards />
        </div>

        <div className="mt-10">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Clock className="size-3.5" /> {t("home.recent")}
            </div>
            <button
              onClick={() => setResetOpen(true)}
              className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-destructive"
            >
              <RotateCcw className="size-3.5" /> {t("home.reset")}
            </button>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">{t("home.recentHint")}</p>
          {snap.recentProjects.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t("home.noProjects")}
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {snap.recentProjects.map((p) => (
                <RecentProjectsRow key={p.rootPath} project={p} />
              ))}
            </ul>
          )}
        </div>
      </div>

      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} />
      <ResetEverythingDialog open={resetOpen} onOpenChange={setResetOpen} />
    </div>
  );
}

function ResetEverythingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { c } = useIde();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setBusy(false);
  }, [open]);

  const confirmReset = async () => {
    setBusy(true);
    // resetEverything() tears down the worker, wipes OPFS, and reloads the page,
    // so control does not return here on success.
    await c.resetEverything();
  };

  return (
    // While the reset is running, lock the dialog: ignore open-state changes and
    // disable backdrop/Escape dismissal + the X so the destructive op can't be
    // interrupted mid-flight (the page reloads on success).
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!busy) onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{t("reset.title")}</DialogTitle>
          <DialogDescription>{t("reset.body")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={() => void confirmReset()} disabled={busy}>
            {busy ? t("reset.busy") : t("reset.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
