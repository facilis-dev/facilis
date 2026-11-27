import { useRef } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { t } from "@/i18n";
import { formatChord } from "./shortcuts";
import type { IdeController } from "@/vv/controller";

/** The controller calls the menu makes; keeping it narrow makes the menu testable. */
type MenuController = Pick<
  IdeController,
  "openTerminalIn" | "copyPath" | "exportProjectZip" | "shareProject" | "pasteInto"
>;

// The row's context menu. The trigger is the ROW ELEMENT itself (`render`), not a
// wrapper around it: a `treeitem` nested under a plain div breaks the tree's
// aria-required-children, and focus restoration on close must land on the row.
export function ExplorerRowMenu({
  trigger,
  abs,
  isDir,
  destDir,
  c,
  canPaste,
  isRoot,
  open,
  anchorAtRow,
  onOpenChange,
  onContextMenuOpen,
  onCopy,
  onCut,
  onOpen,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
}: {
  trigger: React.ReactElement;
  abs: string;
  isDir: boolean;
  destDir: string;
  c: MenuController;
  canPaste: boolean;
  isRoot?: boolean;
  /** Controlled open state: the tree opens the menu itself on Shift+F10. */
  open: boolean;
  /** Anchor the popup on the row instead of the pointer (keyboard invocation). */
  anchorAtRow: boolean;
  onOpenChange: (open: boolean) => void;
  onContextMenuOpen: () => void;
  onCopy: () => void;
  onCut: () => void;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
}) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const termDir = isDir ? abs : destDir;
  return (
    <ContextMenu open={open} onOpenChange={(next) => onOpenChange(next)}>
      <ContextMenuTrigger ref={triggerRef} render={trigger} onContextMenu={onContextMenuOpen} />
      {/* A keyboard-generated contextmenu event has no pointer coordinates (0/0), so
          setOpen from the tree would pop the menu in the corner: anchor it on the row
          when the menu was opened from the keyboard, and leave the pointer path alone. */}
      <ContextMenuContent className="w-56" anchor={anchorAtRow ? triggerRef : undefined}>
        <ContextMenuItem onClick={onOpen}>
          {t("explorer.menu.open")}
          <ContextMenuShortcut>⏎</ContextMenuShortcut>
        </ContextMenuItem>
        {isDir && (
          <>
            <ContextMenuItem onClick={onNewFile}>{t("explorer.menu.newFile")}</ContextMenuItem>
            <ContextMenuItem onClick={onNewFolder}>{t("explorer.menu.newFolder")}</ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => c.openTerminalIn(termDir)}>
          {t("explorer.menu.terminal")}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => c.copyPath(abs)}>
          {t("explorer.menu.copyPath")}
        </ContextMenuItem>
        {isRoot && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => void c.exportProjectZip(abs)}>
              {t("explorer.menu.exportZip")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => void c.shareProject(abs)}>
              {t("explorer.menu.share")}
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        {!isRoot && (
          <ContextMenuItem onClick={onRename}>
            {t("explorer.menu.rename")}
            <ContextMenuShortcut>F2</ContextMenuShortcut>
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={onCopy}>
          {t("explorer.menu.copy")}
          <ContextMenuShortcut>{formatChord({ key: "c", mod: true })}</ContextMenuShortcut>
        </ContextMenuItem>
        {!isRoot && (
          <ContextMenuItem onClick={onCut}>
            {t("explorer.menu.cut")}
            <ContextMenuShortcut>{formatChord({ key: "x", mod: true })}</ContextMenuShortcut>
          </ContextMenuItem>
        )}
        <ContextMenuItem disabled={!canPaste} onClick={() => void c.pasteInto(destDir)}>
          {t("explorer.menu.paste")}
          <ContextMenuShortcut>{formatChord({ key: "v", mod: true })}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        {isRoot ? (
          <ContextMenuItem onClick={onDelete}>{t("explorer.menu.closeFolder")}</ContextMenuItem>
        ) : (
          <ContextMenuItem variant="destructive" onClick={onDelete}>
            {t("explorer.menu.delete")}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
