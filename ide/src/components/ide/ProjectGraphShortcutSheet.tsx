// The "?" shortcut sheet (issue #68 criterion 6): a floating dialog listing EVERY graph
// shortcut and EVERY palette command with its accessible name, so keyboard reachability is
// discoverable (epic #56 rule 6). Esc closes it here and is prevented — first in the close
// order, before the document-level graphEscapeAction layers. The shortcut rows come from the
// pure GRAPH_SHORTCUTS registry and the command rows from the same command list the palette
// ranks, so the two surfaces can never drift. Role tokens only (D-044), t() (D-043).

import { type KeyboardEvent } from "react";
import { t, type MessageKey } from "@/i18n";
import { GRAPH_SHORTCUTS } from "@/facilis/graph-navigation";
import type { PaletteCommand } from "@/facilis/graph-palette";
import { paletteCommandLabel } from "./project-graph-edges";

export interface ProjectGraphShortcutSheetProps {
  readonly open: boolean;
  readonly commands: readonly PaletteCommand[];
  readonly onClose: () => void;
}

export function ProjectGraphShortcutSheet({
  open,
  commands,
  onClose,
}: ProjectGraphShortcutSheetProps) {
  if (!open) return null;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  return (
    <div className="absolute inset-0 z-30" data-testid="graph-shortcut-sheet">
      <div aria-hidden className="absolute inset-0 bg-overlay/70" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("projectGraph.shortcuts.label")}
        onKeyDown={onKeyDown}
        className="absolute inset-x-0 top-[10%] mx-auto flex max-h-[80%] w-[min(28rem,calc(100%-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
      >
        <p className="border-b border-border px-3 py-2 text-xs font-semibold">
          {t("projectGraph.shortcuts.label")}
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <ul className="space-y-1" data-testid="graph-shortcut-list">
            {GRAPH_SHORTCUTS.map((shortcut) => (
              <li
                key={shortcut.id}
                data-testid={"graph-shortcut-" + shortcut.id}
                className="flex items-center gap-2 text-[11px]"
              >
                <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                  {shortcut.keys}
                </kbd>
                <span className="min-w-0 flex-1">{t(shortcut.labelKey as MessageKey)}</span>
              </li>
            ))}
          </ul>
          <p className="px-0.5 pt-3 pb-1 text-[9px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t("projectGraph.shortcuts.commands")}
          </p>
          <ul className="space-y-1" data-testid="graph-shortcut-commands">
            {commands.map((command) => (
              <li
                key={command.id}
                data-testid={"graph-shortcut-command-" + command.id}
                className="flex items-center gap-2 text-[11px]"
              >
                <span className="min-w-0 flex-1">{paletteCommandLabel(command)}</span>
                {command.shortcut !== undefined && (
                  <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                    {command.shortcut}
                  </kbd>
                )}
              </li>
            ))}
          </ul>
        </div>
        <p className="border-t border-border px-3 py-1.5 text-[9px] text-muted-foreground">
          {t("projectGraph.shortcuts.closeHint")}
        </p>
      </div>
    </div>
  );
}
