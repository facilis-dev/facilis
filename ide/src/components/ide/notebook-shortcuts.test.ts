// The notebook's bare-letter gate (issue #221). The point of the extracted
// predicate is that these cases are checkable without a DOM: every one of them is a
// keystroke the old handler turned into a cell.
import { describe, expect, it } from "vitest";
import { notebookCommand, type NotebookKeyEvent } from "./notebook-shortcuts";

function key(overrides: Partial<NotebookKeyEvent> = {}): NotebookKeyEvent {
  return {
    key: "a",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    nativeEvent: { isComposing: false },
    defaultPrevented: false,
    target: null,
    ...overrides,
  };
}

/** A target whose closest() matches one comma-separated selector. */
function inside(selectorPart: string): EventTarget {
  return {
    isContentEditable: false,
    closest: (selector: string) =>
      selector
        .split(",")
        .map((part) => part.trim())
        .includes(selectorPart)
        ? {}
        : null,
  } as unknown as EventTarget;
}

describe("notebookCommand", () => {
  it("maps the bare letters the notebook handles", () => {
    expect(notebookCommand(key({ key: "a" }))).toBe("insert-above");
    expect(notebookCommand(key({ key: "b" }))).toBe("insert-below");
    expect(notebookCommand(key({ key: "m" }))).toBe("to-markdown");
    expect(notebookCommand(key({ key: "y" }))).toBe("to-code");
  });

  it("ignores any other key, including the shifted letter", () => {
    expect(notebookCommand(key({ key: "Enter" }))).toBeNull();
    expect(notebookCommand(key({ key: "A" }))).toBeNull();
  });

  it("refuses a modified key", () => {
    expect(notebookCommand(key({ ctrlKey: true }))).toBeNull();
    expect(notebookCommand(key({ metaKey: true }))).toBeNull();
    expect(notebookCommand(key({ altKey: true }))).toBeNull();
  });

  it("refuses a key that an IME composition or another handler owns", () => {
    expect(notebookCommand(key({ nativeEvent: { isComposing: true } }))).toBeNull();
    expect(notebookCommand(key({ defaultPrevented: true }))).toBeNull();
  });

  it("refuses while a cell editor or a text field has focus", () => {
    expect(notebookCommand(key({ target: inside(".vv-cell-editor") }))).toBeNull();
    expect(notebookCommand(key({ target: inside("input") }))).toBeNull();
    expect(notebookCommand(key({ target: inside("textarea") }))).toBeNull();
    expect(notebookCommand(key({ target: inside("select") }))).toBeNull();
    expect(
      notebookCommand(key({ target: inside("[contenteditable]:not([contenteditable='false'])") })),
    ).toBeNull();
    expect(
      notebookCommand(
        key({
          target: { isContentEditable: true, closest: () => null } as unknown as EventTarget,
        }),
      ),
    ).toBeNull();
  });

  it("refuses while the toolbar or a cell action button has focus", () => {
    expect(notebookCommand(key({ target: inside("button") }))).toBeNull();
    expect(notebookCommand(key({ target: inside("a") }))).toBeNull();
    expect(notebookCommand(key({ target: inside("[role='button']") }))).toBeNull();
  });

  it("still fires on the notebook surface and never throws on a bare target", () => {
    expect(notebookCommand(key({ target: inside("body") }))).toBe("insert-above");
    expect(notebookCommand(key({ target: null }))).toBe("insert-above");
    expect(notebookCommand(key({ target: {} as EventTarget }))).toBe("insert-above");
  });
});
