// F6 / Shift+F6 (issue #211): the one action the dispatcher and the palette share. createXterm
// is shared by the Terminal panel and the Console, so this action covers both surfaces and no
// second chord is added for the Console.
import TerminalIcon from "~icons/lucide/terminal";
import { t } from "@/i18n";
import type { IdeController } from "@/vv/controller";
import { terminalFocusTarget } from "@/vv/editor-prefs";
import { formatShortcut } from "./shortcuts";

const PANEL_REGION = "[data-terminal-panel]";

/** The palette's row for the chord: the same registry entry and the same action. */
export function terminalFocusCommands(c: IdeController) {
  return [
    {
      label: t("shortcuts.focusTerminal"),
      icon: TerminalIcon,
      keys: formatShortcut("terminal-focus"),
      run: () => focusTerminal(c),
    },
  ];
}

/** Show the panel and focus the visible terminal (the Console when it is the open surface). */
export function focusTerminal(c: IdeController): void {
  // setPanelTab opens a collapsed panel, fits the xterm and focuses it once React has flipped
  // visibility; the panel tab tells it whether that surface is the Console or a shell.
  c.terminals.setPanelTab(c.getSnapshot().panelTab === "console" ? "console" : "terminal");
}

/**
 * Leave a focused terminal for the panel region, or return to the terminal from anywhere else.
 * KeyboardEvent is passed in so the direction decision stays pure (terminalFocusTarget).
 */
export function toggleTerminalFocus(c: IdeController, event: KeyboardEvent): void {
  const inTerminal = document.activeElement?.closest(".vv-term-host") != null;
  const target = terminalFocusTarget(event, inTerminal);
  if (target === null) return;
  if (target === "panel") {
    // The panel region is tabIndex={-1}: focus is visible there and Tab reaches its buttons.
    document.querySelector<HTMLElement>(PANEL_REGION)?.focus();
    return;
  }
  focusTerminal(c);
}
