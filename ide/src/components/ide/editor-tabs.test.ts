import { describe, expect, it } from "vitest";
import {
  focusAfterClose,
  nextTabId,
  tabCloseSet,
  tabShortcutIntent,
  tabStopId,
  tabStripIntent,
} from "./editor-tabs";

const key = (over: Partial<Parameters<typeof tabShortcutIntent>[0]>) => ({
  key: "",
  ...over,
});

describe("tabStripIntent", () => {
  it("moves with arrows in both directions, wrapping at the renderer", () => {
    expect(tabStripIntent(key({ key: "ArrowLeft" }))).toEqual({ kind: "move", delta: -1 });
    expect(tabStripIntent(key({ key: "ArrowRight" }))).toEqual({ kind: "move", delta: 1 });
    // Up/Down are the same move: the strip is horizontal.
    expect(tabStripIntent(key({ key: "ArrowUp" }))).toEqual({ kind: "move", delta: -1 });
    expect(tabStripIntent(key({ key: "ArrowDown" }))).toEqual({ kind: "move", delta: 1 });
  });

  it("jumps to the ends with Home and End", () => {
    expect(tabStripIntent(key({ key: "Home" }))).toEqual({ kind: "edge", edge: "first" });
    expect(tabStripIntent(key({ key: "End" }))).toEqual({ kind: "edge", edge: "last" });
  });

  it("activates on Enter and Space, closes on Delete and Backspace", () => {
    expect(tabStripIntent(key({ key: "Enter" }))).toEqual({ kind: "activate" });
    expect(tabStripIntent(key({ key: " " }))).toEqual({ kind: "activate" });
    expect(tabStripIntent(key({ key: "Delete" }))).toEqual({ kind: "close" });
    expect(tabStripIntent(key({ key: "Backspace" }))).toEqual({ kind: "close" });
  });

  it("ignores keys the strip does not own", () => {
    expect(tabStripIntent(key({ key: "a" }))).toBeNull();
    expect(tabStripIntent(key({ key: "PageDown" }))).toBeNull();
    expect(tabStripIntent(key({ key: "Escape" }))).toBeNull();
  });

  it("leaves modifier chords to the window handler", () => {
    expect(tabStripIntent(key({ key: "ArrowLeft", altKey: true }))).toBeNull();
    expect(tabStripIntent(key({ key: "ArrowRight", ctrlKey: true }))).toBeNull();
    expect(tabStripIntent(key({ key: "ArrowRight", metaKey: true }))).toBeNull();
  });
});

describe("tabShortcutIntent", () => {
  it("selects the Nth tab with Alt+1…9", () => {
    expect(tabShortcutIntent(key({ key: "1", altKey: true }))).toEqual({
      kind: "select",
      index: 0,
    });
    expect(tabShortcutIntent(key({ key: "9", altKey: true }))).toEqual({
      kind: "select",
      index: 8,
    });
    expect(tabShortcutIntent(key({ key: "0", altKey: true }))).toBeNull();
  });

  it("matches the physical digit on macOS, where Option composes the key", () => {
    // ⌥1 arrives as key "¡" with code "Digit1".
    expect(tabShortcutIntent(key({ key: "¡", code: "Digit1", altKey: true }))).toEqual({
      kind: "select",
      index: 0,
    });
    expect(tabShortcutIntent(key({ key: "¡", code: "Digit1" }))).toBeNull();
  });

  it("cycles with Ctrl+Alt+Left/Right", () => {
    expect(tabShortcutIntent(key({ key: "ArrowLeft", ctrlKey: true, altKey: true }))).toEqual({
      kind: "cycle",
      delta: -1,
    });
    expect(tabShortcutIntent(key({ key: "ArrowRight", ctrlKey: true, altKey: true }))).toEqual({
      kind: "cycle",
      delta: 1,
    });
  });

  it("never claims a browser-reserved chord", () => {
    // Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+PageUp / Ctrl+PageDown never reach the page.
    expect(tabShortcutIntent(key({ key: "Tab", ctrlKey: true }))).toBeNull();
    expect(tabShortcutIntent(key({ key: "Tab", ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(tabShortcutIntent(key({ key: "PageDown", ctrlKey: true }))).toBeNull();
    expect(tabShortcutIntent(key({ key: "PageUp", ctrlKey: true }))).toBeNull();
    expect(tabShortcutIntent(key({ key: "Tab", metaKey: true }))).toBeNull();
    expect(tabShortcutIntent(key({ key: "PageDown", metaKey: true }))).toBeNull();
  });

  it("stays out of other modifier combinations", () => {
    expect(tabShortcutIntent(key({ key: "1" }))).toBeNull();
    expect(tabShortcutIntent(key({ key: "2", altKey: true, shiftKey: true }))).toBeNull();
    expect(tabShortcutIntent(key({ key: "3", ctrlKey: true, altKey: true }))).toBeNull();
    expect(
      tabShortcutIntent(key({ key: "ArrowLeft", ctrlKey: true, altKey: true, shiftKey: true })),
    ).toBeNull();
    expect(tabShortcutIntent(key({ key: "ArrowLeft", metaKey: true, altKey: true }))).toBeNull();
  });
});

describe("nextTabId", () => {
  const tabs = ["/a.ts", "/b.ts", "/c.ts"];

  it("wraps around in both directions", () => {
    expect(nextTabId(tabs, "/a.ts", 1)).toBe("/b.ts");
    expect(nextTabId(tabs, "/c.ts", 1)).toBe("/a.ts");
    expect(nextTabId(tabs, "/a.ts", -1)).toBe("/c.ts");
    expect(nextTabId(tabs, "/b.ts", -1)).toBe("/a.ts");
  });

  it("recovers from an active tab that is no longer open", () => {
    expect(nextTabId(tabs, null, 1)).toBe("/a.ts");
    expect(nextTabId(tabs, null, -1)).toBe("/c.ts");
    expect(nextTabId(tabs, "/gone.ts", 1)).toBe("/a.ts");
  });

  it("returns null when there is nothing to switch to", () => {
    expect(nextTabId([], null, 1)).toBeNull();
    expect(nextTabId(["/only.ts"], "/only.ts", 1)).toBe("/only.ts");
  });

  it("cycles synthetic tabs like any other", () => {
    const mixed = ["/a.ts", "vv-diff:/a.ts", "vv-commit-graph:/repo", "vv-project-graph"];
    expect(nextTabId(mixed, "/a.ts", 1)).toBe("vv-diff:/a.ts");
    expect(nextTabId(mixed, "vv-commit-graph:/repo", 1)).toBe("vv-project-graph");
  });
});

describe("tabStopId", () => {
  const tabs = ["/a.ts", "/b.ts"];

  it("gives the single tab stop to the active tab", () => {
    expect(tabStopId(tabs, "/b.ts")).toBe("/b.ts");
    expect(tabStopId(tabs, "/a.ts")).toBe("/a.ts");
  });

  it("falls back to the first tab, and to nothing when the strip is empty", () => {
    expect(tabStopId(tabs, null)).toBe("/a.ts");
    expect(tabStopId(tabs, "/closed.ts")).toBe("/a.ts");
    expect(tabStopId([], null)).toBeNull();
  });
});

describe("tabCloseSet", () => {
  const tabs = ["/a.ts", "/b.ts", "/c.ts"];

  it("closes the neighbours and the whole strip", () => {
    expect(tabCloseSet(tabs, "/b.ts", "others")).toEqual(["/a.ts", "/c.ts"]);
    expect(tabCloseSet(tabs, "/a.ts", "right")).toEqual(["/b.ts", "/c.ts"]);
    expect(tabCloseSet(tabs, "/c.ts", "right")).toEqual([]);
    expect(tabCloseSet(tabs, "/b.ts", "all")).toEqual(tabs);
  });

  it("targets nothing when there is no open active tab", () => {
    expect(tabCloseSet(tabs, null, "others")).toEqual([]);
    expect(tabCloseSet(tabs, null, "right")).toEqual([]);
    expect(tabCloseSet(tabs, "/gone.ts", "others")).toEqual([]);
    expect(tabCloseSet([], null, "all")).toEqual([]);
  });
});

describe("focusAfterClose", () => {
  const tabs = ["/a.ts", "/b.ts", "/c.ts"];

  it("takes the right neighbour, or the left one when closing the last tab", () => {
    expect(focusAfterClose(tabs, ["/b.ts"])).toBe("/c.ts");
    expect(focusAfterClose(tabs, ["/c.ts"])).toBe("/b.ts");
  });

  it("takes the first survivor after a block", () => {
    expect(focusAfterClose(tabs, ["/a.ts", "/b.ts"])).toBe("/c.ts");
    expect(focusAfterClose(tabs, ["/b.ts", "/c.ts"])).toBe("/a.ts");
  });

  it("returns null when the strip empties", () => {
    expect(focusAfterClose(tabs, tabs)).toBeNull();
    expect(focusAfterClose(tabs, [])).toBeNull();
  });
});
