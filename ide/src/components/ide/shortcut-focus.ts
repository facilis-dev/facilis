// What the keyboard focus is on right now (issue #223), as the shortcut dispatcher needs it:
// one dialog/overlay check plus the code surfaces and the plain typing targets. DOM-only, so it
// stays out of the pure registry; the result is what shortcutContext() reduces to a context.
import { isTypingTarget } from "./useProjectGraphEscape";
import type { ShortcutFocusState } from "./shortcuts";

/**
 * Modal surfaces: the Base UI dialogs and alert dialogs, the app's own overlays (the lens
 * picker and the tour mark themselves aria-modal) and the blocking boot/share overlays.
 */
const MODAL_SELECTOR =
  '[data-slot="dialog-content"], [data-slot="alert-dialog-content"], [aria-modal="true"]';
const BLOCKING_OVERLAY_SELECTOR = "[data-blocking-overlay]";

/**
 * Monaco and xterm focus a hidden textarea, which isTypingTarget() would read as a form field.
 * They are NOT typing targets here: Ctrl+S and Ctrl+B must still save and toggle while the
 * editor has focus, and the terminal keeps its own chords through each entry's deferTo.
 */
function inCodeSurface(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest(".monaco-editor") != null || target.closest(".vv-term-host") != null;
}

export function readShortcutFocus(target: EventTarget | null): ShortcutFocusState {
  const element = target instanceof HTMLElement ? target : null;
  const editor = element?.closest(".monaco-editor") != null;
  const terminal = element?.closest(".vv-term-host") != null;
  return {
    editing: !inCodeSurface(target) && isTypingTarget(target),
    editor,
    terminal,
    dialog: document.querySelector(MODAL_SELECTOR) !== null,
    overlay: document.querySelector(BLOCKING_OVERLAY_SELECTOR) !== null,
  };
}
