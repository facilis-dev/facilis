import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
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
import { tabFocusMode } from "@/vv/tab-focus-mode";
import { paletteCommands } from "./palette-commands";
import { PaletteFileList } from "./PaletteFileList";

export function CommandPalette() {
  const { c, snap } = useIde();
  const { setTheme } = useTheme();
  const [raw, setRaw] = useState("");
  // The rows live in palette-commands.ts (issue #210); this only subscribes to the one piece
  // of state a row labels — Tab-moves-focus — so its own label can restate it when it opens.
  const tabFocusOn = useSyncExternalStore(tabFocusMode.subscribe, tabFocusMode.getSnapshot);

  // Reset the typed text whenever the palette (re)opens.
  useEffect(() => {
    if (snap.paletteOpen) setRaw("");
  }, [snap.paletteOpen, snap.paletteMode]);

  // `keys` is the palette's only way to teach a shortcut, so it must stay honest: every
  // string comes from the shortcut registry (shortcuts.ts), never from a hand-written copy,
  // so the palette cannot drift from the dispatcher (issue #223).
  const commands = useMemo(
    () => paletteCommands({ c, snap, setTheme, tabFocusOn }),
    [c, setTheme, snap, tabFocusOn],
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
