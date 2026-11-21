// The graph's key resolution (issue #68), split from useProjectGraphKeys.ts so the guard and
// the dispatch table are unit-testable without a DOM (the ide/ test pattern is static markup).
// The hook feeds real event facts in; this module decides the action. Epic #56 rule 6: every
// action is keyboard-reachable, and plain keys never fire while a text input has focus.

export type GraphKeyAction =
  | "escape"
  | "enter"
  | "toggle-mode"
  | "toggle-group-by"
  | "collapse-cluster"
  | "cycle-concentration"
  | "toggle-bridges"
  | "fit"
  | "reset-zoom"
  | "zoom-preset-compact"
  | "zoom-preset-full"
  | "shortcut-sheet"
  | "palette";

/** The event facts the resolver needs; the hook extracts them from the KeyboardEvent. */
export interface GraphKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly defaultPrevented: boolean;
  /** The target is a text input (INPUT/TEXTAREA/SELECT/contentEditable — the note editor). */
  readonly typingTarget: boolean;
  /** The target activates itself with Enter (button, a, input, …); a focused card does not. */
  readonly interactiveTarget: boolean;
}

/**
 * The typing-target predicate, structural so it is testable: the hook applies it to real
 * HTMLElements. contentEditable covers the note editor and any rich-text surface.
 */
export function isTypingTargetInfo(target: {
  tagName?: unknown;
  isContentEditable?: unknown;
}): boolean {
  const tag = typeof target.tagName === "string" ? target.tagName.toUpperCase() : "";
  return (
    target.isContentEditable === true || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
  );
}

/**
 * F.8 (#128): the palette chord is FOCUS-SCOPED to the graph tab, never a global hijack. The
 * hook resolves the two DOM facts — is the event target inside the graph panel, is it the
 * document itself (nothing focused) — and this decides. A chord typed in the terminal, the
 * file explorer or an editor keeps its own meaning, so the graph palette cannot open from
 * outside its tab and the IDE keeps its own Cmd/Ctrl+K surface (the terminal's clear).
 */
export function graphPaletteInScope(facts: {
  readonly scopeContainsTarget: boolean;
  readonly targetIsDocument: boolean;
}): boolean {
  return facts.scopeContainsTarget || facts.targetIsDocument;
}

/**
 * Resolve one keydown to an action, or null. The Cmd/Ctrl+K palette combo is checked BEFORE
 * the typing guard — the palette must open from the graph's search field or a note editor too
 * — while every plain key is refused there. Other modifier combos belong to the browser/OS.
 */
export function resolveGraphKey(event: GraphKeyEvent): GraphKeyAction | null {
  if (event.defaultPrevented) return null;
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
    return "palette";
  }
  if (event.typingTarget) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case "Escape":
      return "escape";
    case "Enter":
      return event.interactiveTarget ? null : "enter";
    case "?":
      return "shortcut-sheet";
  }
  // Letters are case-insensitive: "G" (Shift+g) is the same action as "g" (issues #62/#64/#65).
  switch (event.key.toLowerCase()) {
    case "m":
      return "toggle-mode";
    case "g":
      return "toggle-group-by";
    case "c":
      return "collapse-cluster";
    case "e":
      return "cycle-concentration";
    case "b":
      return "toggle-bridges";
    case "f":
      return "fit";
    case "0":
      return "reset-zoom";
    case "1":
      return "zoom-preset-compact";
    case "2":
      return "zoom-preset-full";
    default:
      return null;
  }
}
