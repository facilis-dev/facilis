// Zen mode and the graph's single Escape ladder (issue #57). Pure so the priority is
// unit-tested: one key press does one thing, biggest mode change first.
//
// Zen replaces the old fullscreen: the HUD (and the inspector overlay) hide inside the tab
// instead of the panel leaving the IDE layout. Esc restores them; a second Esc closes the
// inspector; a third leaves an AI focus (D-171). Typing targets keep Escape for themselves
// (the note editor cancels its edit and stops propagation), so the ladder never steals it.

export type GraphEscapeAction = "exit-zen" | "close-inspector" | "clear-focus" | null;

export function resolveGraphEscape(input: {
  readonly zen: boolean;
  readonly inspectorOpen: boolean;
  readonly focusActive: boolean;
  readonly typing: boolean;
  readonly defaultPrevented: boolean;
}): GraphEscapeAction {
  if (input.defaultPrevented || input.typing) return null;
  if (input.zen) return "exit-zen";
  if (input.inspectorOpen) return "close-inspector";
  if (input.focusActive) return "clear-focus";
  return null;
}

/** Whether the event target owns Escape (search field, note editor, a select). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}
