// The editor tab strip's keyboard model: what a key means while a tab has focus, which
// tab the window-level chords select, where cycling lands and which tabs a close command
// targets. Deliberately free of React and the DOM so the rules are unit-tested (the IDE
// ships no jsdom); EditorTabStrip.tsx only renders the results.

/** The parts of a key event the tab chords read. */
export interface TabKeyLike {
  key: string;
  code?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export type TabStripIntent =
  | { kind: "move"; delta: -1 | 1 }
  | { kind: "edge"; edge: "first" | "last" }
  | { kind: "activate" }
  | { kind: "close" };

/**
 * What a key pressed on a focused tab means, or null when it is not the strip's.
 * Left/Right (and Up/Down, the same move for a horizontal strip) move the roving focus
 * and activate, Home/End jump to the ends, Enter/Space activate and Delete/Backspace
 * close through the same dirty-aware queue as the close control. Modifier chords belong
 * to the window handler (tabShortcutIntent), never here.
 */
export function tabStripIntent(e: TabKeyLike): TabStripIntent | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  switch (e.key) {
    case "ArrowLeft":
    case "ArrowUp":
      return { kind: "move", delta: -1 };
    case "ArrowRight":
    case "ArrowDown":
      return { kind: "move", delta: 1 };
    case "Home":
      return { kind: "edge", edge: "first" };
    case "End":
      return { kind: "edge", edge: "last" };
    case "Enter":
    case " ":
      return { kind: "activate" };
    case "Delete":
    case "Backspace":
      return { kind: "close" };
    default:
      return null;
  }
}

export type TabShortcutIntent =
  { kind: "select"; index: number } | { kind: "cycle"; delta: -1 | 1 };

const DIGIT_CODE = /^Digit([1-9])$/;
const DIGIT_KEY = /^[1-9]$/;

/**
 * The window-level tab chords. Ctrl/Cmd+Tab, Ctrl/Cmd+Shift+Tab and Ctrl/Cmd+PageUp/
 * PageDown are reserved by Chrome, Safari and Edge and never reach the page (the same
 * reason this app refuses Ctrl+W), so the strip is driven by chords the browser does
 * deliver: Alt+1…9 selects the Nth open tab directly and Ctrl+Alt+Left/Right cycles to
 * the previous/next one.
 *
 * Alt is matched on `code` as well as `key` because holding Option on macOS composes
 * the character (⌥1 is "¡"), so a matcher that reads `key` alone is dead on macOS. The
 * composed key stays as the fallback: `code` is positional, so an AZERTY user gets a
 * match from either what the key is or what it typed.
 */
export function tabShortcutIntent(e: TabKeyLike): TabShortcutIntent | null {
  if (e.metaKey) return null;
  // Ctrl+Alt is AltGr on Windows, so a composed alternative key never selects a tab.
  if (e.ctrlKey && e.altKey) {
    if (e.shiftKey) return null;
    if (e.key === "ArrowLeft") return { kind: "cycle", delta: -1 };
    if (e.key === "ArrowRight") return { kind: "cycle", delta: 1 };
    return null;
  }
  if (!e.altKey || e.ctrlKey || e.shiftKey) return null;
  const digit = e.code?.match(DIGIT_CODE)?.[1] ?? (DIGIT_KEY.test(e.key) ? e.key : null);
  return digit === null ? null : { kind: "select", index: Number(digit) - 1 };
}

/** The tab cycling `delta` lands on, wrapping around. Null when no tab is open. */
export function nextTabId(
  openTabs: readonly string[],
  activeTab: string | null,
  delta: -1 | 1,
): string | null {
  const count = openTabs.length;
  if (count === 0) return null;
  const index = activeTab === null ? -1 : openTabs.indexOf(activeTab);
  if (index === -1) return openTabs[delta === 1 ? 0 : count - 1] ?? null;
  return openTabs[(index + delta + count) % count] ?? null;
}

/**
 * The tab holding the strip's single roving tab stop: the active one, else the first.
 * Every arrow press activates, so the tab the keyboard is on IS the active tab; this
 * keeps the stop in agreement after a close, a palette command or an Explorer click.
 */
export function tabStopId(openTabs: readonly string[], activeTab: string | null): string | null {
  if (activeTab !== null && openTabs.includes(activeTab)) return activeTab;
  return openTabs[0] ?? null;
}

export type TabCloseSetKind = "others" | "right" | "all";

/**
 * The tabs a close command targets, in strip order. Every one of them goes through the
 * component's dirty-aware queue: the controller's closeTab discards unsaved edits, so a
 * palette or shortcut command must never call it directly.
 */
export function tabCloseSet(
  openTabs: readonly string[],
  activeTab: string | null,
  kind: TabCloseSetKind,
): string[] {
  if (kind === "all") return [...openTabs];
  const index = activeTab === null ? -1 : openTabs.indexOf(activeTab);
  if (index === -1) return [];
  if (kind === "others") return openTabs.filter((tab) => tab !== activeTab);
  return openTabs.slice(index + 1);
}

/**
 * The tab that takes focus once `closing` goes away: the first survivor at or after the
 * closed block, else the last survivor. Null when the strip empties, so the caller can
 * focus the strip itself instead of letting focus fall to <body>.
 */
export function focusAfterClose(
  openTabs: readonly string[],
  closing: readonly string[],
): string | null {
  const closingSet = new Set(closing);
  const index = openTabs.findIndex((tab) => closingSet.has(tab));
  if (index === -1) return null;
  const remaining = openTabs.filter((tab) => !closingSet.has(tab));
  return remaining[Math.min(index, remaining.length - 1)] ?? null;
}
