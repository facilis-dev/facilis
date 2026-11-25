// The progressive Escape ladder for the project graph (D-211, issues #187/#188), as a pure
// decision so the ordering is testable without a DOM. One key press does one thing:
// fullscreen -> AI focus -> rich card -> drawer -> selection -> overview. Typing targets keep
// Escape for themselves; a fullscreen surface still exits first (the existing behaviour).

export type EscapeAction =
  | "exit-fullscreen"
  | "ignore"
  | "clear-focus"
  | "close-rich-card"
  | "close-drawer"
  | "clear-selection"
  | "overview"
  | "none";

export interface EscapeLadderState {
  readonly fullscreen: boolean;
  /** The key event's target is an input, textarea, select or contenteditable. */
  readonly typing: boolean;
  readonly focusActive: boolean;
  readonly richCardOpen: boolean;
  readonly drawerOpen: boolean;
  readonly selectedNodeId: string | null;
  readonly detail: boolean;
}

export function resolveEscapeAction(state: EscapeLadderState): EscapeAction {
  if (state.fullscreen) return "exit-fullscreen";
  if (state.typing) return "ignore";
  if (state.focusActive) return "clear-focus";
  if (state.richCardOpen) return "close-rich-card";
  if (state.drawerOpen) return "close-drawer";
  if (state.selectedNodeId !== null) return "clear-selection";
  if (state.detail) return "overview";
  return "none";
}
