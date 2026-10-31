// The resolved light/dark palettes: xterm's terminal themes and Monaco's theme
// ids, plus the one place an xterm is constructed. Split out of controller.ts
// (D-019/D-042); the controller still owns which theme is active.

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

export type UiTheme = "light" | "dark";

const TERM_THEME_DARK = {
  background: "#181818",
  foreground: "#cccccc",
  cursor: "#aeafad",
  selectionBackground: "#264f78",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#ffffff",
};

// Light terminal palette mirrors VS Code's default light theme so the terminal
// stays legible when the UI switches to light mode.
const TERM_THEME_LIGHT = {
  background: "#ffffff",
  foreground: "#3b3b3b",
  cursor: "#3b3b3b",
  selectionBackground: "#add6ff",
  black: "#000000",
  red: "#cd3131",
  green: "#00bc00",
  yellow: "#949800",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#555555",
  brightBlack: "#666666",
  brightRed: "#cd3131",
  brightGreen: "#14ce14",
  brightYellow: "#b5ba00",
  brightBlue: "#0451a5",
  brightMagenta: "#bc05bc",
  brightCyan: "#0598bc",
  brightWhite: "#a5a5a5",
};

// The terminal surface follows the theme's panel role, so a new theme restyles
// xterm without touching this file; the ANSI palette stays a per-appearance set.
function cssRole(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export const termThemeFor = (t: UiTheme) => {
  const base = t === "light" ? TERM_THEME_LIGHT : TERM_THEME_DARK;
  if (typeof document === "undefined") return base;
  return {
    ...base,
    background: cssRole("--panel", base.background),
    foreground: cssRole("--panel-foreground", base.foreground),
  };
};
export const monacoThemeFor = (t: UiTheme) => (t === "light" ? "vs" : "vs-dark");

/** A fresh xterm with the fit addon and the Cmd/Ctrl+K clear binding. */
export function createXterm(theme: UiTheme): { term: Terminal; fit: FitAddon } {
  const term = new Terminal({
    convertEol: true,
    cursorBlink: true,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    // Each terminal retains `scrollback` lines of parsed buffer; with several
    // terminals (console + shells) 8000 each adds up. 2000 keeps ample history
    // while cutting the per-terminal buffer footprint.
    fontSize: 12.5,
    scrollback: 2000,
    theme: termThemeFor(theme),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  // Cmd+K (macOS) / Ctrl+K (Win/Linux) clears the focused terminal, mirroring
  // VS Code's integrated terminal. Scoped to the focused xterm (not a global
  // shortcut) so it never clobbers the editor's Cmd+K chord bindings.
  term.attachCustomKeyEventHandler((e) => {
    if (
      e.type === "keydown" &&
      (e.metaKey || e.ctrlKey) &&
      !e.altKey &&
      !e.shiftKey &&
      e.key.toLowerCase() === "k"
    ) {
      term.clear();
      return false;
    }
    return true;
  });
  return { term, fit };
}
