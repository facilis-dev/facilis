// The lens picker (issue #204): the Ctrl/Cmd+Shift+L chord opens one list built from the lens
// registry. A digit picks a lens, Enter confirms the highlighted row, Esc closes without
// changing the active lens. Choosing runs the same command as the palette and the chip.

import { useEffect, useMemo, useState } from "react";
import { t } from "@/i18n";
import {
  graphLensCommands,
  type GraphLensCommand,
  type GraphLensCommandController,
} from "./graph-lens-commands";

function runCommand(command: GraphLensCommand, onClose: () => void): void {
  if (command.disabled) return;
  command.run();
  onClose();
}

export function GraphLensPicker({
  open,
  onClose,
  controller,
}: {
  open: boolean;
  onClose: () => void;
  controller: GraphLensCommandController;
}) {
  const commands = useMemo(() => graphLensCommands(controller), [controller]);
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    if (open) setSelected(0);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setSelected((current) => (current + step + commands.length) % commands.length);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const command = commands[selected];
        if (command !== undefined) runCommand(command, onClose);
        return;
      }
      if (/^[1-9]$/.test(event.key)) {
        const command = commands[Number(event.key) - 1];
        if (command !== undefined) {
          event.preventDefault();
          runCommand(command, onClose);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, commands, selected, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/80 p-4 pt-[12vh] backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("projectGraph.surface.lens.picker.title")}
        data-testid="graph-lens-picker"
        className="w-full max-w-md overflow-hidden rounded-xl border bg-panel shadow-xl"
      >
        <header className="border-b px-3 py-2">
          <h2 className="text-sm font-semibold text-foreground">
            {t("projectGraph.surface.lens.picker.title")}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t("projectGraph.surface.lens.picker.hint", { count: commands.length })}
          </p>
        </header>
        <ul className="max-h-[60vh] overflow-y-auto p-1" role="listbox">
          {commands.map((command, index) => (
            <li key={command.lens} role="option" aria-selected={index === selected}>
              <button
                type="button"
                data-testid={"graph-lens-picker-" + command.lens}
                disabled={command.disabled}
                onClick={() => runCommand(command, onClose)}
                onMouseEnter={() => setSelected(index)}
                className={
                  "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left " +
                  (index === selected ? "bg-accent/10 " : "") +
                  (command.disabled ? "opacity-60" : "hover:bg-accent/10")
                }
              >
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border text-[10px] font-medium text-muted-foreground">
                  {command.index}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">
                    {command.title}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                    {command.description}
                  </span>
                  {command.reason !== null && (
                    <span className="mt-0.5 block text-[10px] leading-snug text-warning">
                      {command.reason}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{command.keys}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
