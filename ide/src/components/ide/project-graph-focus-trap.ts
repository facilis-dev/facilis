// Focus containment for the project-graph dialogs (issue #216), as a pure decision so the Tab
// cycle is testable without a DOM. Both surfaces are modal when open — focus moves in, Tab stays
// inside — but they keep the pointer-outside dismissal the canvas relies on, so Escape stays
// with the project-graph ladder and this module never touches it.

/**
 * The index Tab should focus inside a trapped dialog, or null when the browser's default move
 * stays inside it. `index` is -1 while focus sits on the dialog container itself (tabIndex=-1),
 * which sorts before the first tabbable, so Shift+Tab from there wraps to the last control.
 */
export function trappedTabTarget(index: number, count: number, shiftKey: boolean): number | null {
  if (count === 0) return null;
  if (count === 1) return 0;
  if (shiftKey) return index <= 0 ? count - 1 : null;
  return index >= count - 1 ? 0 : null;
}
