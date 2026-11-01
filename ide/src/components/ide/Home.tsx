import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import FilePlus from "~icons/lucide/file-plus-2";
import Clock from "~icons/lucide/clock";
import ArrowLeft from "~icons/lucide/arrow-left";
import FolderInput from "~icons/lucide/folder-input";
import RotateCcw from "~icons/lucide/rotate-ccw";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

// Shared directory field with live validation against the VFS + registry.
function useDirValidation(dir: string, enabled: boolean) {
  const { c } = useIde();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !dir.trim()) {
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const err = await c.validateNewDir(dir);
      if (!cancelled) setError(err);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [dir, enabled, c]);
  return error;
}

/**
 * Far above any legitimate create, so that reaching it means the runtime is
 * wedged rather than merely slow.
 *
 * Sized against the one component that is genuinely unbounded. The kernel gives
 * the whole template-lock acquisition a single 8s deadline, but that deadline
 * covers response HEADERS only: `fetchByDeadline` clears its abort timer when the
 * fetch promise settles, so the `await r.text()` after it is unbounded, and an
 * edge that answers 200 and then stalls the body wedges `vv-create-project` with
 * a perfectly healthy worker.
 *
 * An escape hatch, not a cancellation: nothing on this side can cancel a kernel
 * request, so if the wedge later clears, the create still resolves and the project
 * still opens — a while after a toast said it had not.
 */
const CREATE_DEADLINE_MS = 45_000;

/** Reject if `work` has not settled within `ms`. Clears its timer either way. */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`the runtime did not respond within ${Math.round(ms / 1000)}s`)),
      ms,
    );
  });
  // race() attaches handlers to both, so a late rejection from `work` after the
  // deadline has already fired is handled rather than becoming an unhandled one.
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Create-on-submit that tolerates a kernel that has not booted yet.
 *
 * Naming a project is client-side work; it needs no runtime, so the form is live from
 * the first paint and a submit made too early queues (the directory check then runs when
 * the kernel is up). The queue introduces a window that could not exist before —
 * submitted, not yet started — so it has to be closable: `cancel()` is what `guardClose`
 * calls when the dialog closes by any route, and `run` re-checks it after every await.
 *
 * Once `create()` has been entered the dialog stops being dismissable, because from there
 * the create genuinely cannot be undone and the kernel request has no cancellation. The
 * refusal is only defensible while the create is still going to finish, so `run` also
 * guarantees that: a kernel that dies rejects the request, and a wedge is covered by the
 * deadline above; either way the catch clears `busy` and hands every close route back.
 */
function useQueuedCreate(effectiveDir: string) {
  const { c, snap } = useIde();
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [lateError, setLateError] = useState<string | null>(null);
  const aborted = useRef(false);

  // Stable so the dialogs can list them in an effect's deps without the effect
  // re-running (and wiping the form) on every render.
  const reset = useCallback(() => {
    aborted.current = false;
    setBusy(false);
    setQueued(false);
    setLateError(null);
  }, []);
  const cancel = useCallback(() => {
    aborted.current = true;
  }, []);

  const run = async (create: () => Promise<void>) => {
    aborted.current = false;
    setBusy(true);
    setLateError(null);
    if (!snap.kernelReady) {
      setQueued(true);
      await c.whenKernelReady();
      setQueued(false);
      if (aborted.current) {
        setBusy(false);
        return false;
      }
      const err = await c.validateNewDir(effectiveDir);
      if (aborted.current) {
        setBusy(false);
        return false;
      }
      if (err) {
        setLateError(err);
        setBusy(false);
        return false;
      }
    }
    try {
      await withDeadline(create(), CREATE_DEADLINE_MS);
      return true;
    } catch (err) {
      toast.error(t("create.failed", { error: err instanceof Error ? err.message : String(err) }));
      setBusy(false);
      return false;
    }
  };

  // In flight: submitted to the kernel, past the point of cancelling.
  const inFlight = busy && !queued;

  /**
   * Wrap a dialog's `onOpenChange` so every close route obeys one policy:
   * cancellable while queued, refused while the create is in flight.
   */
  const guardClose = (onOpenChange: (o: boolean) => void) => (o: boolean) => {
    if (!o) {
      if (inFlight) return;
      cancel();
    }
    onOpenChange(o);
  };

  const label = queued ? t("create.waiting") : inFlight ? t("create.creating") : t("create.submit");
  return { busy, queued, inFlight, lateError, label, reset, guardClose, run };
}

function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { c, snap } = useIde();
  const [name, setName] = useState("");
  const [dir, setDir] = useState("");
  const [dirTouched, setDirTouched] = useState(false);
  const [runInit, setRunInit] = useState(true);

  const effectiveDir = dirTouched ? dir : name.trim() ? c.defaultDirFor(name) : "";
  const { busy, inFlight, lateError, label, reset, guardClose, run } =
    useQueuedCreate(effectiveDir);
  // Every close route funnels through Dialog's onOpenChange — the Cancel button,
  // Escape and click-outside — so the cancel policy belongs here rather than on
  // the button alone.
  const close = guardClose(onOpenChange);

  useEffect(() => {
    if (open) {
      setName("");
      setDir("");
      setDirTouched(false);
      setRunInit(true);
      reset();
    }
  }, [open, reset]);

  const liveError = useDirValidation(effectiveDir, open && !!name.trim() && snap.kernelReady);
  const dirError = lateError ?? liveError;
  const canCreate = !!name.trim() && !!effectiveDir && !dirError && !busy;

  const submit = async () => {
    if (!canCreate) return;
    if (await run(() => c.createProject({ dir: effectiveDir, runInit }))) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("create.title")}</DialogTitle>
          <DialogDescription>{t("create.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("create.name")}</span>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("create.namePlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("create.directory")}
            </span>
            <Input
              value={effectiveDir}
              onChange={(e) => {
                setDirTouched(true);
                setDir(e.target.value);
              }}
              placeholder={t("create.directoryPlaceholder")}
              aria-invalid={!!dirError}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
            {dirError && <span className="text-xs text-destructive">{dirError}</span>}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={runInit}
              onChange={(e) => setRunInit(e.target.checked)}
              className="size-4 accent-primary"
            />
            <span>
              {t("create.runInit")}{" "}
              <span className="text-muted-foreground">{t("create.runInitHint")}</span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={inFlight}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={!canCreate}>
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
