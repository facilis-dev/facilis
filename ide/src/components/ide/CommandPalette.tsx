import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
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
import RotateCcw from "~icons/lucide/rotate-ccw";
import FileCode from "~icons/lucide/file-code";
import Gauge from "~icons/lucide/gauge";
import FolderInput from "~icons/lucide/folder-input";
import FileArchive from "~icons/lucide/file-archive";
import Share2 from "~icons/lucide/share-2";
import Github from "~icons/lucide/github";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useIde } from "./useIde";
import { t } from "@/i18n";

const baseName = (abs: string) => abs.split("/").pop() ?? abs;

// Parse a quick-open query into its path part and an optional `:line[:col]`
// suffix (VS Code style — e.g. "app.tsx:42" or "app.tsx:42:5").
function parseQuery(raw: string): { path: string; line: number | null; col: number } {
  const m = raw.match(/^(.*?):(\d+)(?::(\d+))?$/);
  if (m) return { path: m[1], line: parseInt(m[2], 10), col: m[3] ? parseInt(m[3], 10) : 1 };
  return { path: raw, line: null, col: 1 };
}

export function CommandPalette() {
  const { c, snap } = useIde();
  const { setTheme } = useTheme();
  const [raw, setRaw] = useState("");

  // Reset the typed text whenever the palette (re)opens.
  useEffect(() => {
    if (snap.paletteOpen) setRaw("");
  }, [snap.paletteOpen, snap.paletteMode]);

  // `keys` is the palette's only way to teach a shortcut, so it must stay honest:
  // only commands with a binding in AppShell's global handler carry one.
  const commands = useMemo<
    { label: string; icon: React.ComponentType; keys?: string; run: () => void }[]
  >(
    () => [
      { label: t("palette.home"), icon: Home, run: () => c.goHome() },
      {
        label: t("palette.newTerminal"),
        icon: Plus,
        keys: "⇧⌘C",
        run: () => c.terminals.newShellTerminal(),
      },
      { label: t("palette.runProject"), icon: Play, run: () => c.runActiveFolder() },
      {
        label: t("palette.importFolder"),
        icon: FolderInput,
        run: () => c.importFolderViaPicker(),
      },
      { label: t("palette.importRemote"), icon: Github, run: () => c.openImportRemote() },
      { label: t("palette.exportZip"), icon: FileArchive, run: () => c.exportActiveFolder() },
      { label: t("palette.shareProject"), icon: Share2, run: () => c.shareActiveFolder() },
      {
        label: t("palette.toggleTerminal"),
        icon: TerminalIcon,
        keys: "⌘J",
        run: () => c.togglePanel(),
      },
      {
        label: t("palette.toggleSidebar"),
        icon: PanelLeft,
        keys: "⌘B",
        run: () => c.toggleSidebar(),
      },
      {
        label: t("palette.togglePreview"),
        icon: PanelRight,
        keys: "⌥⌘B",
        run: () => c.togglePreview(),
      },
      // ⌥Z is the macOS spelling of the one binding; on Windows and Linux the same
      // chord reads Alt+Z. Every other entry here writes the macOS form too, so this
      // stays consistent rather than growing a platform switch for one row.
      {
        label: t("palette.toggleWordWrap"),
        icon: WrapText,
        keys: "⌥Z",
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
      {
        label: t("palette.resetEverything"),
        icon: RotateCcw,
        run: () => {
          if (confirm(t("palette.resetConfirm"))) void c.resetEverything();
        },
      },
    ],
    [c, setTheme],
  );

  const isFile = snap.paletteMode === "file";
  const { path, line, col } = parseQuery(raw);

  // File mode: filter ourselves (so the `:line` suffix doesn't break matching).
  const files = useMemo(() => {
    if (!isFile) return [];
    const needle = path.trim().toLowerCase();
    const list = needle
      ? snap.files.filter((rel) => rel.toLowerCase().includes(needle))
      : snap.files;
    return list.slice(0, 200);
  }, [isFile, path, snap.files]);

  const run = (fn: () => void) => {
    c.closePalette();
    fn();
  };

  const openFileFromPalette = (rel: string) =>
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
                <CommandItem key={cmd.label} value={cmd.label} onSelect={() => run(cmd.run)}>
                  <cmd.icon /> {cmd.label}
                  {cmd.keys && (
                    <span className="ml-auto text-xs text-muted-foreground">{cmd.keys}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : (
            <>
              {line != null && path.trim() === "" && snap.activeTab && (
                <CommandGroup heading={t("palette.currentFile")}>
                  <CommandItem
                    value="__goto_line__"
                    onSelect={() => run(() => c.openFileAt(snap.activeTab as string, line, col))}
                  >
                    <FileCode /> <span>{t("palette.goToLine", { line })}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {baseName(snap.activeTab)}
                    </span>
                  </CommandItem>
                </CommandGroup>
              )}
              <CommandGroup
                heading={line != null ? t("palette.filesLine", { line }) : t("palette.files")}
              >
                {files.map((rel) => (
                  <CommandItem key={rel} value={rel} onSelect={() => openFileFromPalette(rel)}>
                    <FileCode /> <span>{baseName(rel)}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{rel}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
