// The key guard and dispatch (issue #68 criterion 4): plain shortcuts never fire while a text
// input has focus — the HUD search field and the note editor included — while the Cmd/Ctrl+K
// palette combo still does. Pure facts in, action out; the hook feeds real events.

import { describe, expect, it } from "vitest";
import {
  graphPaletteInScope,
  isTypingTargetInfo,
  resolveGraphKey,
  type GraphKeyEvent,
} from "./graph-keys";

function event(overrides: Partial<GraphKeyEvent> = {}): GraphKeyEvent {
  return {
    key: "f",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    defaultPrevented: false,
    typingTarget: false,
    interactiveTarget: false,
    ...overrides,
  };
}

describe("isTypingTargetInfo (the guard)", () => {
  it("covers INPUT, TEXTAREA, SELECT and contentEditable — the note editor included", () => {
    expect(isTypingTargetInfo({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTargetInfo({ tagName: "input" })).toBe(true);
    expect(isTypingTargetInfo({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTargetInfo({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTargetInfo({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("lets the canvas and its cards keep the plain keys", () => {
    expect(isTypingTargetInfo({ tagName: "DIV" })).toBe(false);
    expect(isTypingTargetInfo({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTargetInfo({})).toBe(false);
  });
});

describe("graphPaletteInScope (F.8 focus scope)", () => {
  it("opens the palette only from inside the graph panel or with nothing focused", () => {
    expect(graphPaletteInScope({ scopeContainsTarget: true, targetIsDocument: false })).toBe(true);
    // Nothing focused: the graph tab is still the active surface, so the chord opens its palette.
    expect(graphPaletteInScope({ scopeContainsTarget: false, targetIsDocument: true })).toBe(true);
    // Focus elsewhere in the IDE (terminal, explorer, editor): the chord keeps its own meaning.
    expect(graphPaletteInScope({ scopeContainsTarget: false, targetIsDocument: false })).toBe(
      false,
    );
  });
});

describe("resolveGraphKey", () => {
  it("maps every plain shortcut to its action", () => {
    expect(resolveGraphKey(event({ key: "f" }))).toBe("fit");
    expect(resolveGraphKey(event({ key: "0" }))).toBe("reset-zoom");
    expect(resolveGraphKey(event({ key: "1" }))).toBe("zoom-preset-compact");
    expect(resolveGraphKey(event({ key: "2" }))).toBe("zoom-preset-full");
    expect(resolveGraphKey(event({ key: "m" }))).toBe("toggle-mode");
    expect(resolveGraphKey(event({ key: "g" }))).toBe("toggle-group-by");
    expect(resolveGraphKey(event({ key: "c" }))).toBe("collapse-cluster");
    expect(resolveGraphKey(event({ key: "e" }))).toBe("cycle-concentration");
    expect(resolveGraphKey(event({ key: "b" }))).toBe("toggle-bridges");
    expect(resolveGraphKey(event({ key: "?" }))).toBe("shortcut-sheet");
    expect(resolveGraphKey(event({ key: "Escape" }))).toBe("escape");
    expect(resolveGraphKey(event({ key: "Enter" }))).toBe("enter");
  });

  it("keeps the #62/#64/#65 letters case-insensitive so Shift works too", () => {
    expect(resolveGraphKey(event({ key: "G" }))).toBe("toggle-group-by");
    expect(resolveGraphKey(event({ key: "C" }))).toBe("collapse-cluster");
    expect(resolveGraphKey(event({ key: "E" }))).toBe("cycle-concentration");
    expect(resolveGraphKey(event({ key: "B" }))).toBe("toggle-bridges");
    expect(resolveGraphKey(event({ key: "M" }))).toBe("toggle-mode");
  });

  it("refuses every plain key while typing in the search field or a note editor", () => {
    for (const key of ["f", "0", "1", "2", "m", "g", "c", "e", "b", "?", "Escape", "Enter"]) {
      expect(resolveGraphKey(event({ key, typingTarget: true }))).toBeNull();
    }
  });

  it("still opens the palette with Cmd/Ctrl+K from a typing target", () => {
    expect(resolveGraphKey(event({ key: "k", metaKey: true, typingTarget: true }))).toBe("palette");
    expect(resolveGraphKey(event({ key: "K", ctrlKey: true, typingTarget: true }))).toBe("palette");
    expect(resolveGraphKey(event({ key: "k", metaKey: true }))).toBe("palette");
  });

  it("leaves other modifier combos and prevented events to the browser", () => {
    expect(resolveGraphKey(event({ key: "f", ctrlKey: true }))).toBeNull();
    expect(resolveGraphKey(event({ key: "k", ctrlKey: true, altKey: true }))).toBeNull();
    expect(resolveGraphKey(event({ key: "f", defaultPrevented: true }))).toBeNull();
    expect(resolveGraphKey(event({ key: "x" }))).toBeNull();
  });

  it("does not isolate on Enter when a native interactive element owns it", () => {
    expect(resolveGraphKey(event({ key: "Enter", interactiveTarget: true }))).toBeNull();
    expect(resolveGraphKey(event({ key: "Enter", interactiveTarget: false }))).toBe("enter");
  });
});
