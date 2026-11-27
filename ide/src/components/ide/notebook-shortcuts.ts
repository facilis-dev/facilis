// The notebook's bare-letter commands, as a predicate (issue #221).
//
// The keydown handler lives on the whole notebook surface, so it also sees keys typed
// over the toolbar and the kernel-log toggle. A letter is a command only when nothing
// else owns it: no modifier (so `a` is a cell, `⌘a` is Select All, and AltGr arrives as
// ctrl+alt), no IME composition in progress, no default already prevented, and no
// editable element or control under the target. Kept out of the view so it can be
// tested without a DOM.

export type NotebookCommand = "insert-above" | "insert-below" | "to-markdown" | "to-code";

/** The part of a React keyboard event this decision needs. */
export interface NotebookKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** React's KeyboardEvent carries the composition flag on the native event. */
  nativeEvent: { isComposing: boolean };
  defaultPrevented: boolean;
  target: EventTarget | null;
}

// Buttons and links matter as much as fields here: the toolbar and the cell action
// buttons sit inside this handler, and a key typed on a focused one belongs to it.
const OWNS_THE_KEY =
  ".vv-cell-editor, input, textarea, select, button, a, [contenteditable]:not([contenteditable='false']), [role='button']";

function ownsTheKey(target: EventTarget | null): boolean {
  const element = target as {
    closest?: (selector: string) => unknown;
    isContentEditable?: boolean;
  } | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  if (typeof element.closest !== "function") return false;
  return element.closest(OWNS_THE_KEY) !== null;
}

/** The command a keydown means, or null when the key belongs to something else. */
export function notebookCommand(e: NotebookKeyEvent): NotebookCommand | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing || e.defaultPrevented)
    return null;
  if (ownsTheKey(e.target)) return null;
  switch (e.key) {
    case "a":
      return "insert-above";
    case "b":
      return "insert-below";
    case "m":
      return "to-markdown";
    case "y":
      return "to-code";
    default:
      return null;
  }
}
