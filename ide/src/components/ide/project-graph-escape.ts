// The progressive Escape ladder for the project graph (D-219, issues #187/#188/#194), as a pure
// decision so the ordering is testable without a DOM. One key press does one thing: note edit ->
// fullscreen -> AI focus -> rich card -> drawer -> selection -> lens -> overview. Typing targets
// keep Escape for themselves; closing the note editor is the one layer that always wins.

export type EscapeAction =
  | "cancel-note-edit"
  | "exit-fullscreen"
  | "ignore"
  | "clear-focus"
  | "close-rich-card"
  | "close-drawer"
  | "clear-selection"
  | "clear-lens"
  | "overview"
  | "none";

export interface EscapeLadderState {
  /** A note textarea is open: Escape cancels it before any other layer. */
  readonly noteEditing: boolean;
  readonly fullscreen: boolean;
  /** The key event's target is an input, textarea, select or contenteditable. */
  readonly typing: boolean;
  readonly focusActive: boolean;
  readonly richCardOpen: boolean;
  readonly drawerOpen: boolean;
  readonly selectedNodeId: string | null;
  /** An active lens is its own layer, cleared after the selection and before leaving detail. */
  readonly lensActive: boolean;
  readonly detail: boolean;
}

export function resolveEscapeAction(state: EscapeLadderState): EscapeAction {
  if (state.noteEditing) return "cancel-note-edit";
  if (state.fullscreen) return "exit-fullscreen";
  if (state.typing) return "ignore";
  if (state.focusActive) return "clear-focus";
  if (state.richCardOpen) return "close-rich-card";
  if (state.drawerOpen) return "close-drawer";
  if (state.selectedNodeId !== null) return "clear-selection";
  if (state.lensActive) return "clear-lens";
  if (state.detail) return "overview";
  return "none";
}
