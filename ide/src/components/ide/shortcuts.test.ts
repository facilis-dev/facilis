// The registry's guarantees (issue #223): one chord per context, every label and note real in
// both catalogues, match() picking by context, and the formatter speaking each platform. Pure
// and Node-safe, which is the point of keeping the registry out of the components.

import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { it as itMessages } from "@/i18n/it";
import {
  SHORTCUTS,
  formatChord,
  formatShortcut,
  matchShortcut,
  shortcutApplies,
  shortcutById,
  shortcutContext,
  shortcutPlatform,
  type ShortcutEntry,
  type ShortcutKeyEvent,
} from "./shortcuts";

const chordOf = (entry: ShortcutEntry): string =>
  JSON.stringify([
    entry.context,
    entry.chord.key.toLowerCase(),
    entry.chord.code ?? "",
    entry.chord.mod === true,
    entry.chord.ctrl === true,
    entry.chord.alt === true,
    entry.chord.shift ?? false,
  ]);

const event = (init: Partial<ShortcutKeyEvent> & { key: string }): ShortcutKeyEvent => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...init,
});

describe("the registry", () => {
  it("claims each chord once per context", () => {
    const claimed = new Map<string, string>();
    for (const entry of SHORTCUTS) {
      const signature = chordOf(entry);
      expect(claimed.get(signature), entry.id + " collides with " + claimed.get(signature)).toBe(
        undefined,
      );
      claimed.set(signature, entry.id);
    }
  });

  it("keeps every label and note in the English and Italian catalogues", () => {
    for (const entry of SHORTCUTS) {
      expect(en[entry.labelKey], entry.id).toBeTruthy();
      expect(itMessages[entry.labelKey], entry.id).toBeTruthy();
      if (entry.noteKey !== undefined) {
        expect(en[entry.noteKey], entry.id).toBeTruthy();
        expect(itMessages[entry.noteKey], entry.id).toBeTruthy();
      }
    }
  });

  it("looks every entry up by id", () => {
    for (const entry of SHORTCUTS) expect(shortcutById(entry.id).id).toBe(entry.id);
  });
});

describe("matchShortcut", () => {
  it("reads the modifiers exactly", () => {
    const command = event({ key: "P", metaKey: true, shiftKey: true });
    expect(matchShortcut(command, "global")?.id).toBe("palette-command");
    expect(matchShortcut({ ...command, metaKey: false, ctrlKey: true }, "global")?.id).toBe(
      "palette-command",
    );
    expect(matchShortcut(event({ key: "p", metaKey: true }), "global")?.id).toBe("palette-file");
    expect(matchShortcut(event({ key: "p", metaKey: true, altKey: true }), "global")).toBeNull();
    expect(
      matchShortcut(event({ key: "p", metaKey: true, shiftKey: true, altKey: true }), "global"),
    ).toBeNull();
  });

  it("keeps global chords out of dialogs and blocking overlays", () => {
    const sidebar = event({ key: "b", metaKey: true });
    expect(matchShortcut(sidebar, "global")?.id).toBe("sidebar-toggle");
    expect(matchShortcut(sidebar, "dialog")).toBeNull();
    expect(matchShortcut(sidebar, "overlay")).toBeNull();
  });

  it("drops every global chord while a covering layer (Home) is up", () => {
    // #212: Home marks itself data-blocking-overlay, readShortcutFocus reports overlay, and
    // no global entry may reach the covered shell — not just the two toggles sampled above.
    for (const entry of SHORTCUTS) {
      if (entry.context !== "global" || entry.keptBy !== undefined) continue;
      const chord = entry.chord;
      const pressed = event({
        key: chord.key,
        code: chord.code,
        metaKey: chord.mod === true,
        ctrlKey: chord.ctrl === true,
        altKey: chord.alt === true,
        shiftKey: chord.shift === true,
      });
      expect(matchShortcut(pressed, "overlay"), entry.id).toBeNull();
    }
  });

  it("still saves and toggles with the editor focused, because Monaco is not a form field", () => {
    expect(matchShortcut(event({ key: "s", ctrlKey: true }), "editor")?.id).toBe("file-save");
    expect(matchShortcut(event({ key: "b", metaKey: true }), "editor")?.id).toBe("sidebar-toggle");
    expect(matchShortcut(event({ key: "j", metaKey: true }), "editor")?.id).toBe("panel-toggle");
  });

  it("defers the Alt chords to the terminal but keeps them everywhere else", () => {
    expect(matchShortcut(event({ key: "z", altKey: true }), "editor")?.id).toBe("word-wrap");
    expect(matchShortcut(event({ key: "z", altKey: true }), "global")?.id).toBe("word-wrap");
    expect(matchShortcut(event({ key: "z", altKey: true }), "terminal")).toBeNull();
    const cycle = event({ key: "ArrowRight", ctrlKey: true, altKey: true });
    expect(matchShortcut(cycle, "global")?.id).toBe("tab-next");
    expect(matchShortcut(cycle, "terminal")).toBeNull();
    expect(matchShortcut(event({ key: "1", altKey: true }), "global")?.id).toBe("tab-select-1");
    expect(matchShortcut(event({ key: "9", altKey: true }), "global")?.id).toBe("tab-select-9");
    expect(matchShortcut(event({ key: "0", altKey: true }), "global")).toBeNull();
  });

  it("matches every Alt chord on its physical code when macOS composes the character", () => {
    const composed = event({ key: "∫", code: "KeyB", metaKey: true, altKey: true });
    expect(matchShortcut(composed, "global")?.id).toBe("preview-toggle");
    // ⌥Z composes "Ω" and ⌥1 composes "¡" on a US layout: reading `key` alone would
    // leave both chords dead on macOS, which is where they are most used.
    expect(matchShortcut(event({ key: "Ω", code: "KeyZ", altKey: true }), "global")?.id).toBe(
      "word-wrap",
    );
    expect(matchShortcut(event({ key: "¡", code: "Digit1", altKey: true }), "global")?.id).toBe(
      "tab-select-1",
    );
  });

  it("binds F6 and Shift+F6 to the terminal escape wherever a surface has focus", () => {
    for (const context of ["global", "editor", "terminal"] as const) {
      expect(matchShortcut(event({ key: "F6" }), context)?.id).toBe("terminal-focus");
      expect(matchShortcut(event({ key: "F6", shiftKey: true }), context)?.id).toBe(
        "terminal-focus",
      );
    }
    // A dialog or the tour owns its keys; Ctrl/Cmd+F6 were never the chord.
    expect(matchShortcut(event({ key: "F6" }), "dialog")).toBeNull();
    expect(matchShortcut(event({ key: "F6" }), "overlay")).toBeNull();
    expect(matchShortcut(event({ key: "F6", ctrlKey: true }), "global")).toBeNull();
    expect(matchShortcut(event({ key: "F6", metaKey: true }), "global")).toBeNull();
  });

  it("defers the lens picker to the editor and the terminal", () => {
    const lens = event({ key: "L", metaKey: true, shiftKey: true });
    expect(matchShortcut(lens, "global")?.id).toBe("graph-lens");
    expect(matchShortcut(lens, "editor")).toBeNull();
    expect(matchShortcut(lens, "terminal")).toBeNull();
  });

  it("binds ? to the help unless the editor or the terminal is typing", () => {
    expect(matchShortcut(event({ key: "?", shiftKey: true }), "global")?.id).toBe("shortcuts-help");
    expect(matchShortcut(event({ key: "?" }), "global")?.id).toBe("shortcuts-help");
    expect(matchShortcut(event({ key: "?", shiftKey: true }), "editor")).toBeNull();
    expect(matchShortcut(event({ key: "?" }), "terminal")).toBeNull();
    expect(matchShortcut(event({ key: "?", shiftKey: true }), "dialog")).toBeNull();
  });

  it("never returns a chord the browser keeps for itself", () => {
    expect(matchShortcut(event({ key: "w", metaKey: true }), "global")).toBeNull();
    expect(matchShortcut(event({ key: "Tab", ctrlKey: true }), "global")).toBeNull();
  });

  it("documents the tour's Escape and arrows without binding them", () => {
    const tour = SHORTCUTS.filter((entry) => entry.keptBy === "tour");
    expect(tour.map((entry) => entry.chord.key)).toEqual(["Escape", "ArrowRight", "ArrowLeft"]);
    for (const entry of tour) {
      expect(entry.context).toBe("overlay");
      for (const context of ["global", "editor", "terminal", "dialog", "overlay"] as const) {
        expect(matchShortcut(event({ key: entry.chord.key }), context), entry.id).toBeNull();
      }
    }
  });
});

describe("shortcutContext", () => {
  const base = { editing: false, editor: false, terminal: false, dialog: false, overlay: false };

  it("ranks the modal surfaces over the focus and the code surfaces over the rest", () => {
    expect(shortcutContext(base)).toBe("global");
    expect(shortcutContext({ ...base, terminal: true })).toBe("terminal");
    expect(shortcutContext({ ...base, editor: true, terminal: true })).toBe("editor");
    expect(shortcutContext({ ...base, editor: true, overlay: true })).toBe("overlay");
    expect(shortcutContext({ ...base, editor: true, overlay: true, dialog: true })).toBe("dialog");
  });

  it("applies global entries everywhere but the modal surfaces", () => {
    const save = shortcutById("file-save");
    expect(shortcutApplies(save, "global")).toBe(true);
    expect(shortcutApplies(save, "editor")).toBe(true);
    expect(shortcutApplies(save, "terminal")).toBe(true);
    expect(shortcutApplies(save, "dialog")).toBe(false);
    expect(shortcutApplies(save, "overlay")).toBe(false);
  });

  it("keeps a namespaced entry inside its own context only", () => {
    const terminalOnly: ShortcutEntry = {
      id: "test-terminal-only",
      chord: { key: "t" },
      labelKey: "shortcuts.save",
      context: "terminal",
    };
    expect(shortcutApplies(terminalOnly, "terminal")).toBe(true);
    expect(shortcutApplies(terminalOnly, "global")).toBe(false);
    expect(shortcutApplies(terminalOnly, "editor")).toBe(false);
  });
});

describe("formatChord", () => {
  it("spells a chord per platform", () => {
    expect(formatChord({ key: "p", mod: true, shift: true }, "mac")).toBe("⌘⇧P");
    expect(formatChord({ key: "p", mod: true, shift: true }, "other")).toBe("Ctrl+Shift+P");
    expect(formatChord({ key: "z", alt: true }, "mac")).toBe("⌥Z");
    expect(formatChord({ key: "z", alt: true }, "other")).toBe("Alt+Z");
    expect(formatChord({ key: "ArrowLeft", ctrl: true, alt: true }, "mac")).toBe("⌃⌥←");
    expect(formatChord({ key: "ArrowLeft", ctrl: true, alt: true }, "other")).toBe("Ctrl+Alt+Left");
    expect(formatChord({ key: "`", mod: true }, "mac")).toBe("⌘`");
    expect(formatChord({ key: "?", shift: "any" }, "other")).toBe("?");
  });

  it("reads the platform from the string it is given, and stays Node-safe without one", () => {
    expect(shortcutPlatform("MacIntel")).toBe("mac");
    expect(shortcutPlatform("iPhone")).toBe("mac");
    expect(shortcutPlatform("Linux x86_64")).toBe("other");
    expect(shortcutPlatform(undefined)).toBe("other");
  });

  it("formats a registry entry's chord", () => {
    expect(formatShortcut("graph-lens", "mac")).toBe("⌘⇧L");
    expect(formatShortcut("graph-lens", "other")).toBe("Ctrl+Shift+L");
    expect(formatShortcut("file-save", "mac")).toBe("⌘S");
    expect(formatShortcut("tab-next", "other")).toBe("Ctrl+Alt+Right");
  });
});
