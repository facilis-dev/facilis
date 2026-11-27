// The command palette and the window shortcuts cannot call the controller's closeTab:
// it closes unconditionally and silently discards unsaved edits (issue #214), while the
// Save / Don't save prompt lives in EditorGroup's close queue. A close command therefore
// re-enters that queue through this module: EditorGroup registers the queue while it is
// mounted (it stays mounted under Home), and the palette asks this module to close.
type EditorTabCloseHandler = (ids: readonly string[]) => void;

let handler: EditorTabCloseHandler | null = null;

/** Register the editor's dirty-aware close queue; returns the cleanup for its effect. */
export function setEditorTabCloseHandler(next: EditorTabCloseHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/** Close tabs through the editor's queue; false when no editor is mounted or nothing to close. */
export function closeEditorTabs(ids: readonly string[]): boolean {
  if (handler === null || ids.length === 0) return false;
  handler(ids);
  return true;
}
