// The IDE's global shortcut registry (issue #223): the one place a chord is declared.
//
// Every entry carries its chord, its label and the context it may fire in, so the dispatcher
// (AppShell), the command palette, the title bar and the shortcuts help dialog read the same
// fact instead of three hand-written copies that drift. It is data plus pure matching — no
// React, no DOM — so the rules are unit-tested (the IDE ships no jsdom).
//
// This is deliberately NOT a registry of everything (scope honesty, issue #223 §3): Escape
// belongs to the surface that is open (the narrow drawer, the project graph, the tour, each
// dialog), and Monaco and xterm keep their own keymaps. The help dialog says so rather than
// pretending this list is complete.

import type { MessageKey } from "@/i18n";

/**
 * Where a binding may fire. `global` entries fire wherever the dispatcher runs; an `editor`
 * or `terminal` entry only while that surface has focus; `dialog` and `overlay` are surfaces
 * a global entry never reaches into — the command palette, the modal dialogs, the tour and
 * the blocking boot/share overlays own their keys.
 */
export type ShortcutContext = "global" | "editor" | "terminal" | "dialog" | "overlay";

/** The two platform spellings of a chord: `⌘⇧P` on macOS, `Ctrl+Shift+P` elsewhere. */
export type ShortcutPlatform = "mac" | "other";

export interface ShortcutChord {
  /** The typed key, compared case-insensitively ("p", "ArrowLeft", "?"). */
  readonly key: string;
  /** The physical key, for chords macOS composes into another character (⌥B types "∫"). */
  readonly code?: string;
  /** Ctrl on Windows/Linux, Cmd on macOS: what the browser delivers on both. */
  readonly mod?: boolean;
  /** Literal Control on every platform: the tab cycle is Ctrl+Alt even on macOS. */
  readonly ctrl?: boolean;
  readonly alt?: boolean;
  /**
   * Exact Shift — an omitted value means "not pressed" — except the string "any", which only
   * the `?` help key uses: layouts disagree on whether that character needs Shift.
   */
  readonly shift?: boolean | "any";
}

export interface ShortcutEntry {
  readonly id: string;
  readonly chord: ShortcutChord;
  /** Typed against the English catalogue: a typo is a typecheck error, not a silent label. */
  readonly labelKey: MessageKey;
  /** Values for the label's placeholders (the Alt+1…9 tab digits). */
  readonly labelParams?: Readonly<Record<string, string | number>>;
  readonly context: ShortcutContext;
  /**
   * The browser keeps the chord and never delivers it to the page (⌘W closes the tab,
   * Ctrl+Tab switches tabs). The entry documents a binding the IDE cannot have; match()
   * never returns it.
   */
  readonly reservedByBrowser: boolean;
  /** Surfaces that own the chord and keep it: the terminal reads Alt+<key> as its meta prefix. */
  readonly deferTo?: readonly ShortcutContext[];
  /** A translated caveat the help surface shows under the label. */
  readonly noteKey?: MessageKey;
}

/** The slice of a key event the registry reads (KeyboardEvent is assignable to it). */
export interface ShortcutKeyEvent {
  readonly key: string;
  readonly code?: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
}

/** What the DOM said about the focus, reduced by shortcutContext() to one context. */
export interface ShortcutFocusState {
  /** isTypingTarget(): an input, textarea, select or contenteditable — not Monaco's textarea. */
  readonly editing: boolean;
  readonly editor: boolean;
  readonly terminal: boolean;
  readonly dialog: boolean;
  readonly overlay: boolean;
}

export function shortcutContext(focus: ShortcutFocusState): ShortcutContext {
  if (focus.dialog) return "dialog";
  if (focus.overlay) return "overlay";
  if (focus.editor) return "editor";
  if (focus.terminal) return "terminal";
  return "global";
}

const TERMINAL = ["terminal"] as const;
const CODE_SURFACES = ["editor", "terminal"] as const;

function shortcut<Id extends string>(
  id: Id,
  chord: ShortcutChord,
  labelKey: MessageKey,
  init?: Omit<Partial<ShortcutEntry>, "id" | "chord" | "labelKey" | "context">,
): ShortcutEntry & { readonly id: Id } {
  return { id, chord, labelKey, context: "global", reservedByBrowser: false, ...init };
}

const TAB_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export const SHORTCUTS = [
  // Word wrap is the one binding without Ctrl/Cmd. The terminal keeps Alt+<key> for the
  // shell (readline's meta prefix on Windows/Linux, the composed character on macOS).
  shortcut("word-wrap", { key: "z", alt: true }, "shortcuts.wordWrap", { deferTo: TERMINAL }),

  // Alt+1…9 select a tab by position; the digit is both the key and the label's placeholder.
  // Ctrl/Cmd+Tab, Ctrl/Cmd+Shift+Tab and Ctrl/Cmd+PageUp/PageDown are reserved by the browser
  // and never reach the page, so the cycle chords are Ctrl+Alt+←/→.
  ...TAB_DIGITS.map((digit) =>
    shortcut(`tab-select-${digit}`, { key: `${digit}`, alt: true }, "shortcuts.tabSelect", {
      labelParams: { index: digit },
      deferTo: TERMINAL,
    }),
  ),
  shortcut("tab-previous", { key: "ArrowLeft", ctrl: true, alt: true }, "shortcuts.tabPrevious", {
    deferTo: TERMINAL,
  }),
  shortcut("tab-next", { key: "ArrowRight", ctrl: true, alt: true }, "shortcuts.tabNext", {
    deferTo: TERMINAL,
  }),

  // Views and palettes.
  shortcut("view-explorer", { key: "e", mod: true, shift: true }, "shortcuts.explorer"),
  shortcut("view-search", { key: "f", mod: true, shift: true }, "shortcuts.search"),
  shortcut("view-source-control", { key: "g", mod: true, shift: true }, "shortcuts.sourceControl"),
  shortcut("palette-command", { key: "p", mod: true, shift: true }, "shortcuts.commandPalette"),
  shortcut("palette-file", { key: "p", mod: true }, "shortcuts.filePalette"),

  // Layout toggles. The backtick is the terminal panel's own chord, kept alongside ⌘J.
  shortcut("panel-toggle", { key: "j", mod: true }, "shortcuts.togglePanel"),
  shortcut("panel-toggle-backtick", { key: "`", mod: true }, "shortcuts.togglePanel"),
  // ⌥B composes "∫" on macOS: matched on code too, or the chord would fall through to ⌘B.
  shortcut(
    "preview-toggle",
    { key: "b", code: "KeyB", mod: true, alt: true },
    "shortcuts.togglePreview",
  ),
  shortcut("sidebar-toggle", { key: "b", mod: true }, "shortcuts.sidebarToggle"),

  // Files and terminals.
  shortcut("file-save", { key: "s", mod: true }, "shortcuts.save"),
  shortcut("terminal-new", { key: "c", mod: true, shift: true }, "shortcuts.newTerminal"),

  // The graph lens picker (issue #204) lives here now; Ctrl+Shift+L belongs to the editor and
  // the terminal when they have focus, which is what deferTo keeps.
  shortcut("graph-lens", { key: "l", mod: true, shift: true }, "shortcuts.graphLens", {
    deferTo: CODE_SURFACES,
  }),

  // The browser keeps these: ⌘W/⌃W closes the tab and Ctrl+Tab switches it. Registering them
  // lets the help surface say so instead of pretending the IDE has them.
  shortcut("browser-close-tab", { key: "w", mod: true }, "shortcuts.closeTab", {
    reservedByBrowser: true,
    noteKey: "shortcuts.note.browserKeeps",
  }),
  shortcut("browser-cycle-tabs", { key: "Tab", ctrl: true }, "shortcuts.cycleTabs", {
    reservedByBrowser: true,
    noteKey: "shortcuts.note.browserKeeps",
  }),
] as const;

export type ShortcutId = (typeof SHORTCUTS)[number]["id"];
export type RegisteredShortcut = ShortcutEntry & { readonly id: ShortcutId };

const BY_ID: ReadonlyMap<string, ShortcutEntry> = new Map(
  SHORTCUTS.map((entry): [string, ShortcutEntry] => [entry.id, entry]),
);

/** The entry a surface renders; ids come from the registry, so a miss cannot be typed. */
export function shortcutById(id: ShortcutId): RegisteredShortcut {
  return BY_ID.get(id) as RegisteredShortcut; // why: ShortcutId is derived from SHORTCUTS
}

export function chordMatches(chord: ShortcutChord, event: ShortcutKeyEvent): boolean {
  const command = event.metaKey === true || event.ctrlKey === true;
  if (chord.mod === true) {
    if (!command) return false;
  } else if (chord.ctrl === true) {
    if (event.ctrlKey !== true || event.metaKey === true) return false;
  } else if (command) {
    return false;
  }
  if ((chord.alt === true) !== (event.altKey === true)) return false;
  if (chord.shift !== "any" && (chord.shift === true) !== (event.shiftKey === true)) return false;
  const key = event.key.toLowerCase();
  return key === chord.key.toLowerCase() || (chord.code !== undefined && event.code === chord.code);
}

/** Whether `context` may fire this entry: global chords reach the code surfaces unless deferred. */
export function shortcutApplies(entry: ShortcutEntry, context: ShortcutContext): boolean {
  if (entry.context !== "global") return entry.context === context;
  if (context === "dialog" || context === "overlay") return false;
  return entry.deferTo?.includes(context) !== true;
}

/** The binding the active context dispatches, or null when the key belongs elsewhere. */
export function matchShortcut(
  event: ShortcutKeyEvent,
  context: ShortcutContext,
): RegisteredShortcut | null {
  for (const entry of SHORTCUTS) {
    if (entry.reservedByBrowser) continue;
    if (shortcutApplies(entry, context) && chordMatches(entry.chord, event)) return entry;
  }
  return null;
}

/** The platform string the formatter reads: navigator.platform, injectable for tests. */
export function shortcutPlatform(platform: string | undefined): ShortcutPlatform {
  return platform !== undefined && /mac|iphone|ipad/i.test(platform) ? "mac" : "other";
}

function currentPlatform(): ShortcutPlatform {
  return shortcutPlatform(typeof navigator === "undefined" ? undefined : navigator.platform);
}

const KEY_LABELS: Readonly<Record<string, { readonly mac: string; readonly other: string }>> = {
  arrowleft: { mac: "←", other: "Left" },
  arrowright: { mac: "→", other: "Right" },
};

function keyLabel(chord: ShortcutChord, platform: ShortcutPlatform): string {
  const mapped = KEY_LABELS[chord.key.toLowerCase()];
  if (mapped !== undefined) return mapped[platform];
  return chord.key.length === 1 ? chord.key.toUpperCase() : chord.key;
}

/** A chord in this platform's spelling: `⌘⇧P` on macOS, `Ctrl+Shift+P` elsewhere. */
export function formatChord(
  chord: ShortcutChord,
  platform: ShortcutPlatform = currentPlatform(),
): string {
  if (platform === "mac") {
    const glyphs = (chord.ctrl === true ? "⌃" : "") + (chord.mod === true ? "⌘" : "");
    const alt = chord.alt === true ? "⌥" : "";
    const shift = chord.shift === true ? "⇧" : "";
    return glyphs + alt + shift + keyLabel(chord, platform);
  }
  const parts: string[] = [];
  if (chord.ctrl === true || chord.mod === true) parts.push("Ctrl");
  if (chord.alt === true) parts.push("Alt");
  if (chord.shift === true) parts.push("Shift");
  parts.push(keyLabel(chord, platform));
  return parts.join("+");
}

/** The rendered spelling of a registry entry's chord (the palette, the title bar, the help). */
export function formatShortcut(id: ShortcutId, platform?: ShortcutPlatform): string {
  return formatChord(shortcutById(id).chord, platform);
}
