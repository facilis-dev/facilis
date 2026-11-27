import { useEffect, useLayoutEffect, useRef, useState } from "react";
import FilePlus from "~icons/lucide/file-plus-2";
import Clock from "~icons/lucide/clock";
import ArrowLeft from "~icons/lucide/arrow-left";
import FolderInput from "~icons/lucide/folder-input";
import RotateCcw from "~icons/lucide/rotate-ccw";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { useIde } from "./useIde";
import { entriesFromDataTransfer } from "@/vv/controller";
import { RecentProjectsRow } from "./RecentProjectsRow";
import { BootStatus } from "./BootStatus";
import { HomeImportCards } from "./HomeImportCards";
import { NewProjectDialog } from "./NewProjectDialog";
import { useBlockingLayer } from "./use-blocking-layer";
import { lastWorkspaceFocus, restoreWorkspaceFocus } from "./home-focus";
import { resetUi } from "@/vv/reset-ui";

export function HomeView() {
  const { c, snap } = useIde();
  const [newOpen, setNewOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Home covers the workspace, so it marks itself on the shared layer stack (#212, reused
  // by the tour and the boot/share overlays in #217).
  useBlockingLayer("home", true);

  // Focus follows the view, not the click (issue #212): the shell is inert behind Home but
  // the control that opened it kept focus, so Tab walked the covered workspace. Remember
  // the opener, then put focus on Home itself, preferring the user's last project.
  useLayoutEffect(() => {
    const active = document.activeElement;
    // The tracker is the fallback for the inert blur above; activeElement alone is enough
    // only on a browser that clears focus later than this effect.
    openerRef.current =
      active instanceof HTMLElement &&
      active !== document.body &&
      rootRef.current?.contains(active) !== true
        ? active
        : lastWorkspaceFocus();
    const firstRecent = rootRef.current?.querySelector<HTMLElement>("[data-recent-project] button");
    (firstRecent ?? headingRef.current)?.focus();
  }, []);

  // Passive cleanup, so it runs after the frame lost `inert`: focusing a descendant of an
  // inert element is a no-op.
  useEffect(() => () => restoreWorkspaceFocus(openerRef.current), []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const entries = entriesFromDataTransfer(e.dataTransfer);
    if (entries.length) void c.importDropAsProject(entries);
  };

  // The overlay marker is what the shortcut dispatcher reads (shortcut-focus.ts): while Home
  // is up every global chord is dropped, so the covered shell cannot react to keys aimed at
  // Home. The layer hook above is the same fact on the shared stack, for consumers that do
  // not have a DOM node to mark.
  return (
    <div
      ref={rootRef}
      data-blocking-overlay=""
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
      <p role="status" className="sr-only">
        {t("home.viewAnnouncement")}
      </p>
      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-50 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/60 bg-primary/5 text-sm font-medium text-primary">
          <FolderInput className="size-8" />
          {t("home.dropHint")}
        </div>
      )}
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
        <div className="mb-6 flex items-center gap-3">
          <div aria-hidden className="brand-lockup h-7 w-[140px] shrink-0" />
          {snap.workspaceFolders.length > 0 && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => c.showWorkspace()}>
              <ArrowLeft className="size-4" /> {t("home.backToWorkspace")}
            </Button>
          )}
        </div>

        <h1
          ref={headingRef}
          tabIndex={-1}
          className="mb-6 text-2xl font-semibold tracking-tight outline-none"
        >
          {t("home.heading")}
        </h1>

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
              onClick={() => resetUi.open()}
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
    </div>
  );
}
