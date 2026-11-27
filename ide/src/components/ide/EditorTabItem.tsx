// One editor tab: the tab element with its close control, plus the context menu that
// closes the strip around it (issue #214). Split from EditorTabStrip.tsx, which owns
// the tablist, the roving tabindex and the keyboard model.
import X from "~icons/lucide/x";
import { cn } from "@/lib/utils";
import type { TabKind } from "@/vv/controller";
import {
  commitGraphRootOf,
  diffTargetOf,
  isCommitGraphTabId,
  isDataQueryTabId,
  isDiffTabId,
  isProjectGraphTabId,
} from "@/vv/synthetic-tabs";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { t } from "@/i18n";
import { EditorTabLabel, tabTitle } from "./EditorTabLabel";
import { tabCloseSet } from "./editor-tabs";

// Drag payload for reordering tabs within the strip (kept distinct from the Explorer's
// VV_PATH_MIME so the editor-body drop zone ignores tab drags).
const VV_TAB_MIME = "application/x-vv-tab";

/** Whether the pointer is past the tab's midpoint, i.e. the tab drops after it. */
function droppedAfter(e: React.DragEvent<HTMLDivElement>): boolean {
  const rect = e.currentTarget.getBoundingClientRect();
  return e.clientX - rect.left > rect.width / 2;
}

export interface EditorTabItemProps {
  rel: string;
  index: number;
  active: boolean;
  openTabs: readonly string[];
  dirty: readonly string[];
  preview: boolean;
  tabKind: TabKind | undefined;
  /** Whether this tab holds the strip's single roving tab stop. */
  tabStop: boolean;
  /** The tab being dragged, faded while the drag is in flight. */
  dragging: boolean;
  /** Where this tab would drop the dragged one. */
  dropSide: "before" | "after" | null;
  onElement: (rel: string, el: HTMLDivElement | null) => void;
  onActivate: (id: string) => void;
  onPin: (id: string) => void;
  onClose: (ids: readonly string[]) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>, rel: string) => void;
  onDragStart: (rel: string) => void;
  onDragOver: (rel: string, after: boolean) => void;
  onDrop: (rel: string, from: string, after: boolean) => void;
  onDragEnd: () => void;
}

export function EditorTabItem({
  rel,
  index,
  active,
  openTabs,
  dirty,
  preview,
  tabKind,
  tabStop,
  dragging,
  dropSide,
  onElement,
  onActivate,
  onPin,
  onClose,
  onKeyDown,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: EditorTabItemProps) {
  const isDirty = dirty.includes(rel);
  const isDiff = isDiffTabId(rel);
  const isCommitGraph = isCommitGraphTabId(rel);
  const isProjectGraph = isProjectGraphTabId(rel);
  const isDataQuery = isDataQueryTabId(rel);
  const label = tabTitle(rel);
  // A synthetic tab has no path to show, so its tooltip is its own title.
  const tooltip = isDiff
    ? diffTargetOf(rel)
    : isCommitGraph
      ? commitGraphRootOf(rel)
      : isProjectGraph
        ? t("projectGraph.tabTitle")
        : isDataQuery
          ? t("dataQuery.tabTitle")
          : rel;
  return (
    <ContextMenu>
      {/* "contents" keeps the layout; presentation keeps the tablist's accessible
          children the tabs themselves instead of a generic div. */}
      <ContextMenuTrigger className="contents" role="presentation">
        <div
          ref={(el) => onElement(rel, el)}
          role="tab"
          aria-selected={active}
          aria-label={isDirty ? t("editorTabs.tabDirty", { name: label }) : label}
          tabIndex={tabStop ? 0 : -1}
          title={tooltip}
          draggable
          onClick={() => onActivate(rel)}
          onDoubleClick={() => onPin(rel)}
          onKeyDown={(e) => onKeyDown(e, rel)}
          // Middle-click closes the tab, as it does in VS Code. Goes through the same
          // queue as the ✕ so a dirty file still gets its prompt.
          onAuxClick={(e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            onClose([rel]);
          }}
          onDragStart={(e) => {
            e.dataTransfer.setData(VV_TAB_MIME, rel);
            e.dataTransfer.effectAllowed = "move";
            onDragStart(rel);
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(VV_TAB_MIME)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            onDragOver(rel, droppedAfter(e));
          }}
          onDrop={(e) => {
            if (!e.dataTransfer.types.includes(VV_TAB_MIME)) return;
            e.preventDefault();
            const from = e.dataTransfer.getData(VV_TAB_MIME);
            if (from) onDrop(rel, from, droppedAfter(e));
          }}
          onDragEnd={onDragEnd}
          className={cn(
            "group flex cursor-pointer items-center gap-1.5 border-r px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            active
              ? "bg-editor text-foreground shadow-[inset_0_2px_0_0_var(--brand)]"
              : "bg-chrome text-muted-foreground hover:text-foreground",
            dragging && "opacity-50",
            dropSide === "after" && "shadow-[inset_-2px_0_0_0_var(--primary)]",
            dropSide === "before" && "shadow-[inset_2px_0_0_0_var(--primary)]",
          )}
        >
          <EditorTabLabel rel={rel} kind={tabKind} isDiff={isDiff} italic={preview} />
          {/* Deliberately focusable and labelled: hiding it from AT while it can still
              take focus is axe's aria-hidden-focus, and the label is the shared
              common.close, never a tab-specific string. */}
          <button
            className="flex size-4 items-center justify-center rounded hover:bg-accent"
            onClick={(e) => {
              e.stopPropagation();
              onClose([rel]);
            }}
            aria-label={t("common.close")}
            title={t("common.close")}
          >
            {isDirty ? (
              <>
                <span className="size-2 rounded-full bg-foreground group-hover:hidden" />
                <X className="hidden size-3 group-hover:block" />
              </>
            ) : (
              <X className={cn("size-3", active ? "block" : "hidden group-hover:block")} />
            )}
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={() => onClose([rel])}>{t("common.close")}</ContextMenuItem>
        <ContextMenuItem
          disabled={openTabs.length <= 1}
          onClick={() => onClose(tabCloseSet(openTabs, rel, "others"))}
        >
          {t("editorTabs.menu.closeOthers")}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={index >= openTabs.length - 1}
          onClick={() => onClose(tabCloseSet(openTabs, rel, "right"))}
        >
          {t("editorTabs.menu.closeRight")}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={openTabs.every((tab) => dirty.includes(tab))}
          onClick={() => onClose(openTabs.filter((tab) => !dirty.includes(tab)))}
        >
          {t("editorTabs.menu.closeSaved")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onClose(tabCloseSet(openTabs, rel, "all"))}>
          {t("editorTabs.menu.closeAll")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
