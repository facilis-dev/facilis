import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChevronDown from "~icons/lucide/chevron-down";
import ChevronRight from "~icons/lucide/chevron-right";
import ChevronsDownUp from "~icons/lucide/chevrons-down-up";
import FilePlus from "~icons/lucide/file-plus";
import FolderPlus from "~icons/lucide/folder-plus";
import RefreshCw from "~icons/lucide/refresh-cw";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { FileIcon, FolderIcon } from "./fileIcon";
import { useIde } from "./useIde";
import { VV_PATH_MIME, entriesFromDataTransfer } from "@/vv/controller";
import { isIgnoredPath } from "@/vv/workspace-index";
import {
  flattenTreeRows,
  treeFocusIntent,
  treeItemAttributes,
  type TreeRow,
} from "./explorer-tree-model";
import { ROW_H, revealRow, stickyStyle } from "./explorer-tree-layout";
import { ExplorerNameInput } from "./explorer-name-input";
import { ExplorerRowMenu } from "./explorer-row-menu";

interface Entry {
  name: string;
  dir: boolean;
}

const baseName = (abs: string) => abs.split("/").filter(Boolean).pop() ?? abs;
const parentDir = (abs: string) => abs.slice(0, abs.lastIndexOf("/")) || "/";
const modKey = (e: React.KeyboardEvent) => e.metaKey || e.ctrlKey;

// VCS internals only; git-ignored entries stay listed but dimmed (D-054).
const HIDDEN_IN_TREE = new Set([".git"]);

// A pending inline "new file" / "new folder" input.
interface Creating {
  dir: string;
  kind: "file" | "folder";
}

export function Explorer() {
  const { c, snap } = useIde();
  const ignored = (abs: string) => isIgnoredPath(snap.ignoredFiles, snap.ignoredDirs, abs);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Record<string, Entry[]>>({});
  // Multi-selection: the set of selected absolute paths + the range "anchor"
  // (last plain/Cmd-clicked row) that Shift-click extends from.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  // The row the keyboard last moved to. It is the tree's single tab stop; derived
  // against the visible rows below so a row that disappears (collapse, rename,
  // delete) can never leave the tree unfocusable.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // Which row's context menu is open, and whether it was opened from the keyboard
  // (in which case it must be anchored on the row, not on a pointer at 0/0).
  const [rowMenu, setRowMenu] = useState<{ id: string; atRow: boolean } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [creating, setCreating] = useState<Creating | null>(null);
  const [createValue, setCreateValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const loading = useRef<Set<string>>(new Set());
  // The mounted row elements, so a key can move focus without a DOM query.
  const rowEls = useRef(new Map<string, HTMLElement>());
  // The row of the currently-active editor file, so we can scroll it into view
  // when the active tab changes; `scrolledFor` dedupes so we only scroll once
  // per tab (not on every unrelated tree re-render).
  const activeRowRef = useRef<HTMLDivElement>(null);
  // Its tree depth, recorded when the ref attaches — `revealRow` needs it to know how
  // much of the scrollport the row's parked ancestors are occupying.
  const activeRowDepth = useRef(0);
  const scrolledFor = useRef<string | null>(null);

  // ── drag & drop ────────────────────────────────────────────────────────────
  // Make a row a drag source. Dragging a row that's part of a multi-selection
  // carries the whole selection (newline-joined) in the VV_PATH_MIME slot.
  const dragProps = (abs: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.stopPropagation(); // don't let an ancestor row overwrite the payload
      const paths = selection.has(abs) && selection.size > 1 ? [...selection] : [abs];
      const payload = paths.join("\n");
      e.dataTransfer.setData(VV_PATH_MIME, payload);
      e.dataTransfer.setData("text/plain", payload);
      e.dataTransfer.effectAllowed = "copyMove";
    },
    onDragEnd: () => setDragOver(null),
  });

  // Make a row/area a drop target that reorganizes (internal) or imports (OS).
  // `destDir` receives the drop; `key` drives the hover highlight.
  const dropProps = (destDir: string | null, key: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!destDir) return;
      e.preventDefault();
      e.stopPropagation();
      const internal = e.dataTransfer.types.includes(VV_PATH_MIME);
      e.dataTransfer.dropEffect = internal ? (e.ctrlKey || e.metaKey ? "copy" : "move") : "copy";
      if (dragOver !== key) setDragOver(key);
    },
    onDragLeave: () => setDragOver((cur) => (cur === key ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      if (!destDir) return;
      e.preventDefault();
      e.stopPropagation();
      setDragOver(null);
      const raw = e.dataTransfer.getData(VV_PATH_MIME);
      if (raw) {
        const paths = raw.split("\n").filter(Boolean);
        if (e.ctrlKey || e.metaKey) void c.copyEntriesTo(paths, destDir);
        else void c.moveEntries(paths, destDir);
        return;
      }
      const entries = entriesFromDataTransfer(e.dataTransfer);
      if (entries.length) void c.importInto(destDir, entries);
    },
  });

  // Load a directory's children from the live VFS (once, unless refreshed).
  const load = useCallback(
    async (dir: string) => {
      if (loading.current.has(dir)) return;
      loading.current.add(dir);
      // Hide VCS internals from the tree (like VS Code's default files.exclude).
      // This is display-only: `ls` in the terminal still shows .git.
      const entries = (await c.readdir(dir)).filter((e) => !HIDDEN_IN_TREE.has(e.name));
      loading.current.delete(dir);
      entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
      setChildren((prev) => ({ ...prev, [dir]: entries }));
    },
    [c],
  );

  // Auto-expand roots as they open.
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const f of snap.workspaceFolders) next.add(f.rootPath);
      return next;
    });
  }, [snap.workspaceFolders]);

  // Fetch the children of every expanded dir that we haven't loaded yet.
  useEffect(() => {
    for (const dir of expanded) if (!(dir in children)) void load(dir);
  }, [expanded, children, load]);

  // Reveal the active editor file in the tree whenever the active tab changes
  // (tab click, open, or close→next). Expands its ancestor folders so the row is
  // rendered, and makes it the SOLE selection — clearing any stale highlight in
  // another project (fixes two files appearing highlighted across roots).
  useEffect(() => {
    const abs = snap.activeTab;
    if (!abs) {
      setSelection(new Set());
      return;
    }
    const folder = snap.workspaceFolders.find(
      (f) => abs === f.rootPath || abs.startsWith(f.rootPath + "/"),
    );
    if (!folder) return;
    // Every ancestor dir from the owning root down to the file's parent.
    const ancestors: string[] = [];
    for (let cur = parentDir(abs); cur.startsWith(folder.rootPath); cur = parentDir(cur)) {
      ancestors.push(cur);
      if (cur === folder.rootPath) break;
    }
    setExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const d of ancestors)
        if (!next.has(d)) {
          next.add(d);
          changed = true;
          if (!(d in children)) void load(d);
        }
      return changed ? next : prev;
    });
    setSelection(new Set([abs]));
    setAnchor(abs);
    c.setActiveFolder(folder.id);
    // Deliberately keyed only on the active tab: expanding/selecting should
    // follow the editor, not re-run when children load or folders change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.activeTab]);

  // A VFS change (file op / install / create) bumps treeVersion → re-read every
  // directory we currently have loaded, so the tree reflects reality.
  useEffect(() => {
    if (!snap.treeVersion) return;
    for (const dir of Object.keys(children)) void load(dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.treeVersion]);

  const toggle = (dir: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else {
        next.add(dir);
        if (!(dir in children)) void load(dir);
      }
      return next;
    });

  const startRename = (abs: string) => {
    setCreating(null);
    setRenaming(abs);
    setRenameValue(baseName(abs));
  };
  const commitRename = () => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (name && name !== baseName(renaming)) c.renameEntry(renaming, name);
    setRenaming(null);
  };

  const startCreate = (dir: string, kind: "file" | "folder") => {
    setRenaming(null);
    if (!expanded.has(dir)) toggle(dir);
    setCreating({ dir, kind });
    setCreateValue("");
  };
  const commitCreate = () => {
    if (!creating) return;
    const name = createValue.trim();
    if (name) {
      if (creating.kind === "file") void c.newFile(creating.dir, name);
      else void c.newFolder(creating.dir, name);
    }
    setCreating(null);
  };

  // The rows currently visible (roots included), in render order: the data the
  // roving focus and the arrow keys walk.
  const treeRows = useMemo(
    () => flattenTreeRows(snap.workspaceFolders, children, expanded),
    [children, expanded, snap.workspaceFolders],
  );
  // Selection, Shift-ranges and Select All address ENTRIES only: a workspace root is
  // focusable, but putting it in the selection would aim Delete/Backspace at the folder.
  const flatVisible = useMemo(
    () => treeRows.filter((row) => !row.root).map((row) => ({ abs: row.id, isDir: row.isDir })),
    [treeRows],
  );
  const isDirOf = (abs: string) => flatVisible.find((r) => r.abs === abs)?.isDir ?? false;
  // The row holding the tab stop: the last one the keyboard moved to, else the active
  // editor file, else the first row.
  const focusedRow =
    treeRows.find((row) => row.id === focusedId) ??
    treeRows.find((row) => row.id === snap.activeTab) ??
    treeRows[0] ??
    null;

  // Once the active file's row is mounted (after any ancestor folders finish
  // loading and `flatVisible` updates), scroll it into view — once per tab.
  useEffect(() => {
    if (!snap.activeTab || scrolledFor.current === snap.activeTab) return;
    if (activeRowRef.current) {
      revealRow(activeRowRef.current, activeRowDepth.current);
      scrolledFor.current = snap.activeTab;
    }
  }, [snap.activeTab, flatVisible]);

  // Apply a click to the selection: Shift extends a range from the anchor,
  // Cmd/Ctrl toggles one row, a plain click selects just that row.
  const applySelect = (e: React.MouseEvent, abs: string) => {
    if (e.shiftKey && anchor) {
      const ai = flatVisible.findIndex((r) => r.abs === anchor);
      const bi = flatVisible.findIndex((r) => r.abs === abs);
      if (ai !== -1 && bi !== -1) {
        const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai];
        setSelection(new Set(flatVisible.slice(lo, hi + 1).map((r) => r.abs)));
        return;
      }
      setSelection(new Set([abs]));
      setAnchor(abs);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      setSelection((prev) => {
        const next = new Set(prev);
        if (next.has(abs)) next.delete(abs);
        else next.add(abs);
        return next;
      });
      setAnchor(abs);
      return;
    }
    setSelection(new Set([abs]));
    setAnchor(abs);
  };

  // A row was clicked: update selection, and (only for a plain click) open a
  // file or toggle a folder. Modifier-clicks just change the selection.
  const handleRowClick = (
    e: React.MouseEvent<HTMLDivElement>,
    abs: string,
    isDir: boolean,
    folderId: string,
  ) => {
    // Focus the ROW, never the tree container: the tree has one roving tab stop, and
    // focusing the container painted a ring around a box that belonged to no row.
    e.currentTarget.focus({ preventScroll: true });
    setFocusedId(abs);
    c.setActiveFolder(folderId);
    applySelect(e, abs);
    if (e.shiftKey || e.metaKey || e.ctrlKey) return;
    if (isDir) toggle(abs);
    else void c.openEntry(abs, { preview: true, focus: false }); // keep focus in the tree
  };

  const setRowEl = (id: string, el: HTMLDivElement | null) => {
    if (el) rowEls.current.set(id, el);
    else rowEls.current.delete(id);
  };

  // When a context menu opens on an unselected row, make it the sole selection
  // (so menu actions target it); keep an existing multi-selection intact.
  const selectForContext = (abs: string) => {
    if (!selection.has(abs)) {
      setSelection(new Set([abs]));
      setAnchor(abs);
    }
  };
  // The paths a context-menu action should affect: the whole selection if the
  // clicked row is part of it, else just that row.
  const effective = (abs: string) =>
    selection.has(abs) && selection.size > 1 ? [...selection] : [abs];

  // Where a paste lands: into the anchor if it's a folder, else its parent.
  const pasteDest = () => {
    if (anchor) return isDirOf(anchor) ? anchor : parentDir(anchor);
    return c.activeFolder?.rootPath ?? "/";
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (renaming || creating) return;
    const k = e.key.toLowerCase();
    if (e.key === "Escape") {
      setSelection(new Set());
      setAnchor(null);
      return;
    }
    if (modKey(e) && k === "a") {
      e.preventDefault();
      setSelection(new Set(flatVisible.map((r) => r.abs)));
      return;
    }
    const sel = [...selection];
    if (!sel.length) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      setConfirmDelete(sel);
    } else if (modKey(e) && k === "c") {
      e.preventDefault();
      c.copyEntries(sel);
    } else if (modKey(e) && k === "x") {
      e.preventDefault();
      c.cutEntries(sel);
    } else if (modKey(e) && k === "v") {
      e.preventDefault();
      void c.pasteInto(pasteDest());
    }
  };

  // Move the roving focus (and, for an entry, the selection) to a row — what an arrow
  // key does. A root only becomes the active folder: it is never a deletable selection.
  const moveFocus = (row: TreeRow) => {
    setFocusedId(row.id);
    c.setActiveFolder(row.rootId);
    // A root is not a file selection: it takes the focus and the active folder, and
    // the file selection is cleared so `aria-selected` names exactly one row.
    setSelection(row.root ? new Set() : new Set([row.id]));
    setAnchor(row.root ? null : row.id);
    const el = rowEls.current.get(row.id);
    el?.focus({ preventScroll: true });
    revealRow(el ?? null, row.level - 1, "nearest");
  };

  const openRowMenu = (row: TreeRow) => {
    c.setActiveFolder(row.rootId);
    if (!row.root) selectForContext(row.id);
    setRowMenu({ id: row.id, atRow: true });
  };

  // Tree keyboard: arrows/Home/End move the roving focus, Left/Right fold, Enter opens,
  // F2 renames, Shift+F10 (or the menu key) opens the row menu. Scoped to the tree so
  // the header buttons keep their own key handling; Delete/Backspace stay on the
  // sidebar handler with the selection semantics they always had.
  const onTreeKeyDown = (e: React.KeyboardEvent) => {
    if (!focusedRow || renaming || creating) return;
    const intent = treeFocusIntent(treeRows, focusedRow.id, e.key);
    if (intent) {
      e.preventDefault();
      if (intent.expand) toggle(intent.expand);
      if (intent.collapse) toggle(intent.collapse);
      moveFocus(treeRows.find((row) => row.id === intent.focus) ?? focusedRow);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (focusedRow.isDir) toggle(focusedRow.id);
      else void c.openEntry(focusedRow.id, { preview: false, focus: false });
      return;
    }
    if (e.key === "F2") {
      e.preventDefault();
      if (!focusedRow.root) startRename(focusedRow.id);
      return;
    }
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      openRowMenu(focusedRow);
    }
  };

  // The controlled open state of a row's context menu. A stale close from another
  // row's menu must not clear the menu that just opened.
  const rowMenuProps = (id: string) => ({
    open: rowMenu?.id === id,
    anchorAtRow: rowMenu?.id === id && rowMenu.atRow,
    onOpenChange: (open: boolean) =>
      setRowMenu((prev) => (open ? { id, atRow: false } : prev?.id === id ? null : prev)),
  });

  // Render the children of `dir` (must be expanded). `folderId` = owning root.
  const renderChildren = (dir: string, depth: number, folderId: string): React.ReactNode => {
    const entries = children[dir];
    return (
      <>
        {creating?.dir === dir && (
          <div
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={false}
            tabIndex={-1}
            className="flex items-center gap-1.5 py-0.5"
            style={{ paddingLeft: 8 + depth * 12 + 4 }}
          >
            {creating.kind === "folder" ? (
              <FolderIcon open={false} className="size-4 shrink-0" />
            ) : (
              <FileIcon name={createValue || "x"} className="size-4 shrink-0" />
            )}
            <ExplorerNameInput
              value={createValue}
              onChange={setCreateValue}
              commit={commitCreate}
              cancel={() => setCreating(null)}
              depth={depth}
            />
          </div>
        )}
        {entries === undefined ? (
          // Presentational: a loading ellipsis is not a tree item, and hiding it keeps
          // the group's required children to treeitems only.
          <div
            role="none"
            aria-hidden="true"
            className="py-0.5 text-xs text-muted-foreground"
            style={{ paddingLeft: 8 + depth * 12 + 16 }}
          >
            …
          </div>
        ) : entries.length === 0 && creating?.dir !== dir ? null : (
          entries.map((e) => {
            const abs = dir + "/" + e.name;
            return e.dir
              ? renderDir(abs, e.name, depth, folderId)
              : renderFile(abs, e.name, depth, folderId);
          })
        )}
      </>
    );
  };

  const renderDir = (
    abs: string,
    name: string,
    depth: number,
    folderId: string,
  ): React.ReactNode => {
    const open = expanded.has(abs);
    const isRenaming = renaming === abs;
    return (
      <div key={abs} role="none">
        <ExplorerRowMenu
          abs={abs}
          isDir
          destDir={abs}
          c={c}
          canPaste={snap.clipboard != null}
          {...rowMenuProps(abs)}
          onContextMenuOpen={() => {
            c.setActiveFolder(folderId);
            selectForContext(abs);
          }}
          onCopy={() => c.copyEntries(effective(abs))}
          onCut={() => c.cutEntries(effective(abs))}
          onOpen={() => toggle(abs)}
          onRename={() => startRename(abs)}
          onDelete={() => setConfirmDelete(effective(abs))}
          onNewFile={() => startCreate(abs, "file")}
          onNewFolder={() => startCreate(abs, "folder")}
          trigger={
            <div
              ref={(el) => setRowEl(abs, el)}
              // Rows truncate with an ellipsis and the tree does not scroll sideways, so
              // without the title a long name — or any name at depth, where the indent
              // eats the width — cannot be read at all.
              title={name}
              data-git-ignored={ignored(abs) || undefined}
              {...dragProps(abs)}
              {...dropProps(abs, abs)}
              {...treeItemAttributes({
                focused: focusedRow?.id === abs,
                selected: selection.has(abs),
                level: depth + 1,
                expanded: open,
              })}
              className={cn(
                "sticky flex w-full cursor-pointer items-center gap-1 bg-sidebar text-left text-sm outline-none",
                "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                dragOver === abs
                  ? "bg-accent/80 text-foreground ring-1 ring-inset ring-primary"
                  : selection.has(abs)
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
              style={{ height: ROW_H, paddingLeft: 8 + depth * 12, ...stickyStyle(depth) }}
              onClick={(e) => handleRowClick(e, abs, true, folderId)}
            >
              {open ? (
                <ChevronDown className="size-3.5 shrink-0" />
              ) : (
                <ChevronRight className="size-3.5 shrink-0" />
              )}
              <FolderIcon name={name} open={open} className="size-4 shrink-0" />
              {isRenaming ? (
                <ExplorerNameInput
                  value={renameValue}
                  onChange={setRenameValue}
                  commit={commitRename}
                  cancel={() => setRenaming(null)}
                  depth={depth}
                />
              ) : (
                <span className="truncate">{name}</span>
              )}
            </div>
          }
        />
        {open && <div role="group">{renderChildren(abs, depth + 1, folderId)}</div>}
      </div>
    );
  };

  const renderFile = (
    abs: string,
    name: string,
    depth: number,
    folderId: string,
  ): React.ReactNode => {
    const isRenaming = renaming === abs;
    return (
      <div key={abs} role="none">
        <ExplorerRowMenu
          abs={abs}
          isDir={false}
          destDir={parentDir(abs)}
          c={c}
          canPaste={snap.clipboard != null}
          {...rowMenuProps(abs)}
          onContextMenuOpen={() => {
            c.setActiveFolder(folderId);
            selectForContext(abs);
          }}
          onCopy={() => c.copyEntries(effective(abs))}
          onCut={() => c.cutEntries(effective(abs))}
          onOpen={() => c.openEntry(abs, { preview: false })}
          onRename={() => startRename(abs)}
          onDelete={() => setConfirmDelete(effective(abs))}
          onNewFile={() => startCreate(parentDir(abs), "file")}
          onNewFolder={() => startCreate(parentDir(abs), "folder")}
          trigger={
            <div
              ref={(el) => {
                setRowEl(abs, el);
                if (snap.activeTab === abs) {
                  activeRowRef.current = el;
                  activeRowDepth.current = depth;
                }
              }}
              title={name}
              data-git-ignored={ignored(abs) || undefined}
              {...dragProps(abs)}
              {...dropProps(parentDir(abs), abs)}
              {...treeItemAttributes({
                focused: focusedRow?.id === abs,
                selected: selection.has(abs) || snap.activeTab === abs,
                level: depth + 1,
              })}
              className={cn(
                "flex w-full cursor-pointer items-center gap-1.5 py-0.5 text-left text-sm outline-none",
                "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                dragOver === abs
                  ? "bg-accent/80 text-foreground ring-1 ring-inset ring-primary"
                  : selection.has(abs) || snap.activeTab === abs
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50",
              )}
              style={{ paddingLeft: 8 + depth * 12 + 16 }}
              onClick={(e) => handleRowClick(e, abs, false, folderId)}
              onDoubleClick={() => void c.openEntry(abs, { preview: false })}
            >
              <FileIcon name={name} className="size-4 shrink-0" />
              {isRenaming ? (
                <ExplorerNameInput
                  value={renameValue}
                  onChange={setRenameValue}
                  commit={commitRename}
                  cancel={() => setRenaming(null)}
                  depth={depth}
                />
              ) : (
                <span className="truncate">{name}</span>
              )}
            </div>
          }
        />
      </div>
    );
  };

  const active = c.activeFolder;

  return (
    <div className="flex h-full flex-col bg-sidebar" onKeyDown={onKeyDown}>
      <div className="flex h-8 shrink-0 items-center gap-1 pl-3 pr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span className="flex-1 truncate">{t("explorer.title")}</span>
        <HeaderBtn
          label={t("explorer.newFile")}
          onClick={() => active && startCreate(active.rootPath, "file")}
          disabled={!active}
        >
          <FilePlus className="size-3.5" />
        </HeaderBtn>
        <HeaderBtn
          label={t("explorer.newFolder")}
          onClick={() => active && startCreate(active.rootPath, "folder")}
          disabled={!active}
        >
          <FolderPlus className="size-3.5" />
        </HeaderBtn>
        <HeaderBtn label={t("explorer.refresh")} onClick={() => setChildren({})}>
          <RefreshCw className="size-3.5" />
        </HeaderBtn>
        <HeaderBtn
          label={t("explorer.collapseAll")}
          onClick={() => setExpanded(new Set())}
          disabled={snap.workspaceFolders.length === 0}
        >
          <ChevronsDownUp className="size-3.5" />
        </HeaderBtn>
      </div>
      {/* `min-h-0` is load-bearing: without it this flex item keeps its content-based
          automatic minimum, so a tall tree grows the ScrollArea past the sidebar
          instead of scrolling inside it — the rows below the fold become unreachable
          and nothing ever sticks (the viewport is only a scrollport once it's capped). */}
      <ScrollArea className="min-h-0 flex-1">
        {snap.workspaceFolders.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            {t("explorer.empty")}{" "}
            <button className="text-foreground underline" onClick={() => c.goHome()}>
              {t("explorer.home")}
            </button>{" "}
            {t("explorer.emptyTail")}
          </div>
        ) : (
          <div
            // One tab stop for the whole tree: `focusedRow` is the only row rendered
            // with tabIndex 0, so Tab enters on it and leaves from it.
            role="tree"
            aria-label={t("explorer.tree.label")}
            aria-multiselectable
            className="relative min-h-full pb-4 outline-none"
            onKeyDown={onTreeKeyDown}
            {...dropProps(active?.rootPath ?? null, "__area__")}
          >
            {/* The area drag-over tint is an OVERLAY, not this container's background:
                the rows above it are opaquely `bg-sidebar` (parked ones have to be), so a
                background tint only showed through in the gaps and read as stripes. Above
                the sticky ramp, below the scrollbar, and never a pointer target. */}
            {dragOver === "__area__" && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-[25] bg-accent/30"
              />
            )}
            {snap.workspaceFolders.map((f) => {
              const open = expanded.has(f.rootPath);
              return (
                <div key={f.id} role="none">
                  <ExplorerRowMenu
                    abs={f.rootPath}
                    isDir
                    destDir={f.rootPath}
                    c={c}
                    canPaste={snap.clipboard != null}
                    isRoot
                    {...rowMenuProps(f.rootPath)}
                    onContextMenuOpen={() => c.setActiveFolder(f.id)}
                    onCopy={() => c.copyEntry(f.rootPath)}
                    onCut={() => c.cutEntry(f.rootPath)}
                    onOpen={() => toggle(f.rootPath)}
                    onRename={() => {
                      /* roots aren't renamed */
                    }}
                    onDelete={() => c.closeFolder(f.id)}
                    onNewFile={() => startCreate(f.rootPath, "file")}
                    onNewFolder={() => startCreate(f.rootPath, "folder")}
                    trigger={
                      <div
                        ref={(el) => setRowEl(f.rootPath, el)}
                        title={f.name}
                        {...dropProps(f.rootPath, f.id)}
                        {...treeItemAttributes({
                          focused: focusedRow?.id === f.rootPath,
                          // A root row's "selection" is the active workspace folder: it
                          // never joins the file selection.
                          selected: snap.activeFolderId === f.id,
                          level: 1,
                          expanded: open,
                        })}
                        className={cn(
                          "sticky flex w-full cursor-pointer items-center gap-1 bg-sidebar pl-2 text-left text-[11px] font-semibold uppercase tracking-wide outline-none",
                          "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                          dragOver === f.id
                            ? "bg-accent/80 text-foreground ring-1 ring-inset ring-primary"
                            : snap.activeFolderId === f.id
                              ? "text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                        )}
                        style={{ height: ROW_H, ...stickyStyle(0) }}
                        onClick={(e) => {
                          e.currentTarget.focus({ preventScroll: true });
                          setFocusedId(f.rootPath);
                          c.setActiveFolder(f.id);
                          toggle(f.rootPath);
                        }}
                      >
                        {open ? (
                          <ChevronDown className="size-3.5 shrink-0" />
                        ) : (
                          <ChevronRight className="size-3.5 shrink-0" />
                        )}
                        <span className="truncate">{f.name}</span>
                      </div>
                    }
                  />
                  {open && <div role="group">{renderChildren(f.rootPath, 1, f.id)}</div>}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <AlertDialog
        open={confirmDelete != null}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("explorer.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && confirmDelete.length === 1 ? (
                <>
                  <span className="font-mono text-foreground">{confirmDelete[0]}</span>{" "}
                  {t("explorer.delete.tail")}
                </>
              ) : (
                <>
                  <span className="font-mono text-foreground">
                    {t("explorer.delete.items", { count: confirmDelete?.length ?? 0 })}
                  </span>{" "}
                  {t("explorer.delete.tail")}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirmDelete) c.deleteEntries(confirmDelete);
                setSelection(new Set());
                setConfirmDelete(null);
              }}
            >
              {t("explorer.delete.action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function HeaderBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
