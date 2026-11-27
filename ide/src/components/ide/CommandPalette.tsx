import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import CircleHelp from "~icons/lucide/circle-help";
import Sun from "~icons/lucide/sun";
import Moon from "~icons/lucide/moon";
import Monitor from "~icons/lucide/monitor";
import Plus from "~icons/lucide/plus";
import Play from "~icons/lucide/play";
import Home from "~icons/lucide/house";
import TerminalIcon from "~icons/lucide/terminal";
import PanelLeft from "~icons/lucide/panel-left";
import PanelRight from "~icons/lucide/panel-right";
import WrapText from "~icons/lucide/wrap-text";
import Eraser from "~icons/lucide/eraser";
import RefreshCw from "~icons/lucide/refresh-cw";
import ChevronRight from "~icons/lucide/chevron-right";
import ChevronLeft from "~icons/lucide/chevron-left";
import X from "~icons/lucide/x";
import RotateCcw from "~icons/lucide/rotate-ccw";
import FileCode from "~icons/lucide/file-code";
import FolderTree from "~icons/lucide/folder-tree";
import Search from "~icons/lucide/search";
import Save from "~icons/lucide/save";
import Gauge from "~icons/lucide/gauge";
import FolderInput from "~icons/lucide/folder-input";
import FileArchive from "~icons/lucide/file-archive";
import Share2 from "~icons/lucide/share-2";
import GitBranch from "~icons/lucide/git-branch";
import MessageSquare from "~icons/lucide/message-square";
import Network from "~icons/lucide/network";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { startTour } from "@/components/tour/tour-focus";
import { useIde } from "./useIde";
import { t } from "@/i18n";
import { deployment, pushAllowed } from "@/deploy/current";
import { proxyBase } from "@/vv/git-remote";
import { gitRemoteUi } from "@/vv/git-remote-ui";
import { publishSession } from "@/vv/publish-session";
import { resetUi } from "@/vv/reset-ui";
import { scaffoldUi } from "@/vv/scaffold-ui";
import { shortcutHelpUi } from "@/vv/shortcut-help-ui";
import { graphLensCommands } from "./graph-lens-commands";
import { nextTabId, tabCloseSet } from "./editor-tabs";
import { closeEditorTabs } from "./editor-tab-close";
import { PaletteFileList } from "./PaletteFileList";
import { formatShortcut } from "./shortcuts";
import { terminalFocusCommands } from "./terminal-focus";

export function CommandPalette() {
  const { c, snap } = useIde();
  const { setTheme } = useTheme();
  const [raw, setRaw] = useState("");

  // Reset the typed text whenever the palette (re)opens.
  useEffect(() => {
    if (snap.paletteOpen) setRaw("");
  }, [snap.paletteOpen, snap.paletteMode]);

  // `keys` is the palette's only way to teach a shortcut, so it must stay honest: every
  // string comes from the shortcut registry (shortcuts.ts), never from a hand-written copy,
  // so the palette cannot drift from the dispatcher (issue #223).
  const commands = useMemo<
    {
      label: string;
      icon: React.ComponentType;
      keys?: string;
      run: () => void;
      disabled?: boolean;
    }[]
  >(
    () => [
      { label: t("palette.home"), icon: Home, run: () => c.goHome() },
      { label: t("palette.tour"), icon: CircleHelp, run: () => startTour(null) },
      {
        label: t("shortcuts.help"),
        icon: CircleHelp,
        keys: formatShortcut("shortcuts-help"),
        run: () => shortcutHelpUi.open(),
      },
      // The views and Save had no chord hint at all; they are registry entries now (#223).
      {
        label: t("shortcuts.explorer"),
        icon: FolderTree,
        keys: formatShortcut("view-explorer"),
        run: () => c.setActiveView("explorer"),
      },
      {
        label: t("shortcuts.search"),
        icon: Search,
        keys: formatShortcut("view-search"),
        run: () => c.setActiveView("search"),
      },
      {
        label: t("shortcuts.sourceControl"),
        icon: GitBranch,
        keys: formatShortcut("view-source-control"),
        run: () => c.setActiveView("scm"),
      },
      {
        label: t("shortcuts.save"),
        icon: Save,
        keys: formatShortcut("file-save"),
        disabled: snap.activeTab === null,
        run: () => c.saveActiveFile(),
      },
      {
        label: t("palette.newTerminal"),
        icon: Plus,
        keys: formatShortcut("terminal-new"),
        run: () => c.terminals.newShellTerminal(),
      },
      // Same registry entry and action as the dispatcher (issue #211): the palette teaches F6.
      ...terminalFocusCommands(c),
      { label: t("palette.runProject"), icon: Play, run: () => c.runActiveFolder() },
      {
        label: t("palette.importFolder"),
        icon: FolderInput,
        run: () => c.importFolderViaPicker(),
      },
      { label: t("palette.importRemote"), icon: GitBranch, run: () => c.openImportRemote() },
      {
        // The empty-repository case and the manual recovery: pick a template, then write
        // it into the open folder without touching anything already there (D-080).
        label: t("palette.scaffold"),
        icon: FileCode,
        run: () => {
          const root = snap.workspaceFolders.find(
            (folder) => folder.id === snap.activeFolderId,
          )?.rootPath;
          if (root !== undefined) scaffoldUi.open(root);
        },
      },
      // Publishing is compiled out of deployments that forbid writing to a git host.
      ...(pushAllowed(deployment)
        ? [{ label: t("palette.pushRemote"), icon: GitBranch, run: () => publishSession.open() }]
        : []),
      // Real git needs the stateless proxy; without one there is nothing to drive (D-079).
      ...(proxyBase() !== null
        ? [{ label: t("palette.gitRemote"), icon: GitBranch, run: () => gitRemoteUi.open() }]
        : []),
      { label: t("palette.openChat"), icon: MessageSquare, run: () => c.setActiveView("chat") },
      { label: t("palette.exportZip"), icon: FileArchive, run: () => c.exportActiveFolder() },
      { label: t("palette.shareProject"), icon: Share2, run: () => c.shareActiveFolder() },
      {
        label: t("palette.toggleTerminal"),
        icon: TerminalIcon,
        keys: formatShortcut("panel-toggle"),
        run: () => c.togglePanel(),
      },
      {
        label: t("palette.toggleSidebar"),
        icon: PanelLeft,
        keys: formatShortcut("sidebar-toggle"),
        run: () => c.toggleSidebar(),
      },
      {
        label: t("palette.togglePreview"),
        icon: PanelRight,
        keys: formatShortcut("preview-toggle"),
        run: () => c.togglePreview(),
      },
      // Tab commands. Next/previous carry the chords AppShell binds (the same registry
      // the strip defers to); the close commands exist only here and in the tab context
      // menu, and route through the editor's dirty-aware queue — never the controller.
      {
        label: t("editorTabs.next"),
        icon: ChevronRight,
        keys: formatShortcut("tab-next"),
        disabled: snap.openTabs.length < 2,
        run: () => {
          const next = nextTabId(snap.openTabs, snap.activeTab, 1);
          if (next !== null) c.openFile(next, { preview: next === snap.previewTab });
        },
      },
      {
        label: t("editorTabs.previous"),
        icon: ChevronLeft,
        keys: formatShortcut("tab-previous"),
        disabled: snap.openTabs.length < 2,
        run: () => {
          const previous = nextTabId(snap.openTabs, snap.activeTab, -1);
          if (previous !== null) c.openFile(previous, { preview: previous === snap.previewTab });
        },
      },
      {
        label: t("editorTabs.closeOthers"),
        icon: X,
        disabled: tabCloseSet(snap.openTabs, snap.activeTab, "others").length === 0,
        run: () => closeEditorTabs(tabCloseSet(snap.openTabs, snap.activeTab, "others")),
      },
      {
        label: t("editorTabs.closeRight"),
        icon: X,
        disabled: tabCloseSet(snap.openTabs, snap.activeTab, "right").length === 0,
        run: () => closeEditorTabs(tabCloseSet(snap.openTabs, snap.activeTab, "right")),
      },
      {
        label: t("editorTabs.closeAll"),
        icon: X,
        disabled: snap.openTabs.length === 0,
        run: () => closeEditorTabs(tabCloseSet(snap.openTabs, snap.activeTab, "all")),
      },
      // Word wrap is the registry's one binding without Ctrl/Cmd; the formatter shows the
      // platform's spelling (⌥Z on macOS, Alt+Z elsewhere).
      {
        label: t("palette.toggleWordWrap"),
        icon: WrapText,
        keys: formatShortcut("word-wrap"),
        run: () => c.toggleWordWrap(),
      },
      {
        label: t("palette.clearTerminal"),
        icon: Eraser,
        run: () => c.clearActiveTerminal(),
      },
      { label: t("palette.reloadPreview"), icon: RefreshCw, run: () => c.preview.reloadPreview() },
      { label: t("palette.measureMemory"), icon: Gauge, run: () => void c.measureMemory() },
      { label: t("theme.light"), icon: Sun, run: () => setTheme("light") },
      { label: t("theme.dark"), icon: Moon, run: () => setTheme("dark") },
      { label: t("theme.system"), icon: Monitor, run: () => setTheme("system") },
      // The lens registry is the source of truth (issue #204): no lens is named here.
      ...(snap.activeFolderId === null
        ? []
        : graphLensCommands(c).map((command) => ({
            label: command.reason === null ? command.label : command.label + " — " + command.reason,
            icon: Network,
            keys: command.keys,
            run: command.run,
            disabled: command.disabled,
          }))),
      {
        label: t("palette.resetEverything"),
        icon: RotateCcw,
        // The dialog owns the typed confirmation: a browser confirm() here would be
        // a second, weaker gate in front of the same irreversible wipe (D-189).
        run: () => resetUi.open(),
      },
    ],
    [c, setTheme, snap],
  );

  const isFile = snap.paletteMode === "file";

  const run = (fn: () => void) => {
    c.closePalette();
    fn();
  };

  const openFileFromPalette = (rel: string, line: number | null, col: number) =>
    run(() => (line != null ? c.openFileAt(rel, line, col) : c.openFile(rel)));

  return (
    <CommandDialog open={snap.paletteOpen} onOpenChange={(o) => (o ? undefined : c.closePalette())}>
      <Command shouldFilter={!isFile}>
        <CommandInput
          value={raw}
          onValueChange={setRaw}
          placeholder={isFile ? t("palette.filePlaceholder") : t("palette.commandPlaceholder")}
        />
        <CommandList>
          <CommandEmpty>{t("palette.noResults")}</CommandEmpty>
          {!isFile ? (
            <CommandGroup heading={t("palette.commands")}>
              {commands.map((cmd) => (
                <CommandItem
                  key={cmd.label}
                  value={cmd.label}
                  disabled={cmd.disabled}
                  onSelect={() => run(cmd.run)}
                >
                  <cmd.icon /> {cmd.label}
                  {cmd.keys && (
                    <span className="ml-auto text-xs text-muted-foreground">{cmd.keys}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : (
            <PaletteFileList
              raw={raw}
              files={snap.files}
              activeTab={snap.activeTab}
              onOpen={openFileFromPalette}
            />
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
