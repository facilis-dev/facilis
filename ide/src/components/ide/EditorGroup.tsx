import { useCallback, useEffect, useRef, useState } from "react";
import ChevronRight from "~icons/lucide/chevron-right";
import { cn } from "@/lib/utils";
import { VV_PATH_MIME, entriesFromDataTransfer, type WorkspaceFolder } from "@/vv/controller";
import {
  commitGraphRootOf,
  diffTargetOf,
  isCommitGraphTabId,
  isDataQueryTabId,
  isDiffTabId,
  isProjectGraphTabId,
} from "@/vv/synthetic-tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FileIcon } from "./fileIcon";
import { NotebookView } from "./NotebookView";
import { CommitGraphPanel } from "./CommitGraphPanel";
import { DataQueryPanel } from "./DataQueryPanel";
import { ProjectGraphPanel } from "./ProjectGraphPanel";
import { DiffView, DirectoryView, ImageView } from "./EditorPanes";
import { EditorTabStrip, type TabFocusRequest } from "./EditorTabStrip";
import { focusAfterClose } from "./editor-tabs";
import { setEditorTabCloseHandler } from "./editor-tab-close";
import { useIde } from "./useIde";

const baseName = (rel: string) => rel.split("/").pop() ?? rel;

export function EditorGroup() {
  const { c, snap } = useIde();
  // A queue of tabs still to close, plus the file we're currently prompting to
  // save. Bulk closes (Close Others/Saved/All…) feed the queue; clean tabs close
  // straight away and each dirty one pops a Save/Don't save/Cancel dialog.
  const [queue, setQueue] = useState<string[]>([]);
  const [promptRel, setPromptRel] = useState<string | null>(null);
  // The tab that should take focus after a close, handed to the strip (which owns the
  // tab DOM): closing a tab unmounts the focused element, and focus must never fall to
  // <body>.
  const [focusRequest, setFocusRequest] = useState<TabFocusRequest | null>(null);
  const focusSeq = useRef(0);

  // Monaco is ~960 KB and this component is mounted the whole time, including
  // under the Home overlay (see the comment at AppShell.tsx's `snap.view` check)
  // — so the editor used to download before a project existed, competing with
  // the kernel's own Wasm for a connection nobody had asked it to use.
  //
  // Deferring the CALL rather than the component is what keeps the deliberate
  // "editor and terminals survive a round-trip to Home" property intact: the
  // host div is still here, still keyed the same, and once `mountEditor` has run
  // it never unmounts. Only the first mount waits.
  const onHome = snap.view === "home";
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (onHome) return;
    const el = hostRef.current;
    if (el) void c.mountEditor(el);
  }, [c, onHome]);
  const mountRef = useCallback((el: HTMLDivElement | null) => {
    hostRef.current = el;
  }, []);

  // Drop zone over the whole editor area. We use capture-phase native listeners
  // (not React props) so we intercept the drop before Monaco's own DOM handlers,
  // and read the DataTransfer synchronously (its item list dies after we yield).
  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const [dropActive, setDropActive] = useState(false);
  useEffect(() => {
    const el = dropZoneRef.current;
    if (!el) return;
    const isDrag = (e: DragEvent) =>
      !!e.dataTransfer &&
      (e.dataTransfer.types.includes(VV_PATH_MIME) || e.dataTransfer.types.includes("Files"));
    const onOver = (e: DragEvent) => {
      if (!isDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setDropActive(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!el.contains(e.relatedTarget as Node)) setDropActive(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer || !isDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setDropActive(false);
      const raw = e.dataTransfer.getData(VV_PATH_MIME);
      const paths = raw ? raw.split("\n").filter(Boolean) : [];
      const entries = paths.length ? [] : entriesFromDataTransfer(e.dataTransfer);
      void c.dropOnEditor({ paths, entries });
    };
    el.addEventListener("dragover", onOver, true);
    el.addEventListener("dragleave", onLeave, true);
    el.addEventListener("drop", onDrop, true);
    return () => {
      el.removeEventListener("dragover", onOver, true);
      el.removeEventListener("dragleave", onLeave, true);
      el.removeEventListener("drop", onDrop, true);
    };
  }, [c]);

  const activeKind = snap.activeTab ? (snap.tabKinds[snap.activeTab] ?? "text") : "text";

  const processQueue = (rels: readonly string[]) => {
    let rest = rels;
    while (rest.length) {
      const rel = rest[0] as string;
      if (snap.dirty.includes(rel)) {
        setQueue(rest.slice(1));
        setPromptRel(rel);
        return;
      }
      c.closeTab(rel);
      rest = rest.slice(1);
    }
    setQueue([]);
    setPromptRel(null);
  };

  // Every close starts by naming the tab that should hold focus once the closed ones
  // unmount: the strip focuses it, and an emptied strip focuses its tablist.
  const closeTabs = (ids: readonly string[]) => {
    if (ids.length === 0) return;
    focusSeq.current += 1;
    setFocusRequest({ id: focusAfterClose(snap.openTabs, ids), seq: focusSeq.current });
    processQueue(ids);
  };

  // The palette's tab commands and the window chords cannot call the controller's
  // closeTab (it would discard unsaved edits), so they re-enter the queue above.
  const closeTabsRef = useRef(closeTabs);
  useEffect(() => {
    closeTabsRef.current = closeTabs;
  });
  useEffect(() => setEditorTabCloseHandler((ids) => closeTabsRef.current(ids)), []);

  const cancelClose = () => {
    setPromptRel(null);
    setQueue([]);
  };

  return (
    <div data-testid="editor-group" className="flex h-full flex-col bg-editor">
      <EditorTabStrip
        openTabs={snap.openTabs}
        activeTab={snap.activeTab}
        previewTab={snap.previewTab}
        dirty={snap.dirty}
        tabKinds={snap.tabKinds}
        focusRequest={focusRequest}
        onActivate={(id) => c.openFile(id, { preview: id === snap.previewTab })}
        onPin={(id) => c.pinTab(id)}
        onClose={closeTabs}
        onReorder={(from, to, after) => c.reorderTab(from, to, after)}
      />

      {/* breadcrumb: Workspace-relative path of the active file (or diff target); a
          synthetic tab has no file, so it has no breadcrumb. */}
      {snap.activeTab &&
        !isCommitGraphTabId(snap.activeTab) &&
        !isProjectGraphTabId(snap.activeTab) &&
        !isDataQueryTabId(snap.activeTab) && (
          <Breadcrumb
            abs={isDiffTabId(snap.activeTab) ? diffTargetOf(snap.activeTab) : snap.activeTab}
            folders={snap.workspaceFolders}
          />
        )}

      {/* editor host (Monaco mounts here once) */}
      <div ref={dropZoneRef} className="relative flex-1">
        {/* Monaco stays mounted; it's hidden behind the image/directory panes so
            its models + language services survive tab switches. */}
        <div
          ref={mountRef}
          className={cn("vv-editor-host absolute inset-0", activeKind !== "text" && "invisible")}
        />
        {activeKind === "image" && snap.activeTab && (
          <ImageView key={snap.activeTab} abs={snap.activeTab} />
        )}
        {activeKind === "directory" && snap.activeTab && <DirectoryView />}
        {activeKind === "diff" && snap.activeTab && (
          <DiffView key={snap.activeTab} id={snap.activeTab} />
        )}
        {activeKind === "notebook" && snap.activeTab && (
          <NotebookView key={snap.activeTab} abs={snap.activeTab} />
        )}
        {activeKind === "commit-graph" && snap.activeTab && (
          <CommitGraphPanel key={snap.activeTab} root={commitGraphRootOf(snap.activeTab)} />
        )}
        {activeKind === "project-graph" && <ProjectGraphPanel />}
        {activeKind === "data-query" && <DataQueryPanel />}
        {!snap.activeTab && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {snap.projectTitle ? "Open a file from the Workspace" : "Press Run to start a project"}
          </div>
        )}
        {dropActive && (
          <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-primary/10 text-sm font-medium text-foreground">
            Drop to open in the editor
          </div>
        )}
      </div>

      {/* unsaved-changes prompt on close */}
      <AlertDialog
        open={promptRel != null}
        onOpenChange={(o) => {
          if (!o) cancelClose();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Do you want to save the changes you made to {promptRel ? baseName(promptRel) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Your changes will be lost if you don't save them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="secondary"
              onClick={() => {
                if (promptRel) {
                  c.discardFile(promptRel);
                  c.closeTab(promptRel);
                }
                setPromptRel(null);
                processQueue(queue);
              }}
            >
              Don't Save
            </Button>
            <AlertDialogAction
              onClick={() => {
                if (promptRel) {
                  c.saveFile(promptRel);
                  c.closeTab(promptRel);
                }
                setPromptRel(null);
                processQueue(queue);
              }}
            >
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Split an active file's absolute path into breadcrumb segments, led by a
// literal "Workspace" root and the containing project's name (e.g.
// "Workspace > my-app > src > components > App.tsx"). Files outside any open
// folder fall back to their full path under "Workspace".
function crumbsFor(abs: string, folders: WorkspaceFolder[]): string[] {
  const folder = folders.find((f) => abs === f.rootPath || abs.startsWith(f.rootPath + "/"));
  if (folder) {
    const rel = abs.slice(folder.rootPath.length);
    return ["Workspace", folder.name, ...rel.split("/").filter(Boolean)];
  }
  return ["Workspace", ...abs.split("/").filter(Boolean)];
}

// VS Code-style breadcrumb strip above the editor body.
function Breadcrumb({ abs, folders }: { abs: string; folders: WorkspaceFolder[] }) {
  const crumbs = crumbsFor(abs, folders);
  return (
    <div className="vv-tabs-scroll flex h-6 shrink-0 items-center gap-0.5 overflow-x-auto whitespace-nowrap border-b bg-editor px-3 text-xs text-muted-foreground">
      {crumbs.map((seg, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} className="flex shrink-0 items-center gap-0.5">
            {i > 0 && <ChevronRight className="size-3 opacity-60" />}
            {isLast && crumbs.length > 1 ? (
              <span className="flex items-center gap-1 text-foreground">
                <FileIcon name={seg} className="size-3.5 shrink-0" />
                {seg}
              </span>
            ) : (
              <span>{seg}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}
