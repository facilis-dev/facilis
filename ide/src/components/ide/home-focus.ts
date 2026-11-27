// Home's focus handoff (issue #212): where focus goes when Home opens, and where it goes
// back when Home closes. DOM-only and module-level, because the memory has to outlive the
// commit that makes the shell inert — the browser blurs the focused element when that
// happens, so by the time Home's layout effect runs document.activeElement may be <body>.
// The frame's own marker: only controls inside it are workspace openers. Portaled dialogs
// and the command palette live outside it, and their focus must not become Home's opener.
const WORKSPACE_FRAME = "[data-workspace-frame]";

// Where focus goes when the opener is gone (a closed tab, a palette item that unmounted):
// the title-bar brand button, else the narrow shell's Files tab. getClientRects() filters
// the brand's `hidden lg:flex` twin out on phones.
const RETURN_FOCUS_FALLBACKS = [
  "[data-home-return-focus]",
  '[data-slot="mobile-shell-nav"] button',
] as const;

let lastFocused: HTMLElement | null = null;

function onWorkspaceFocusIn(event: FocusEvent): void {
  const target = event.target;
  if (target instanceof HTMLElement && target.closest(WORKSPACE_FRAME) !== null) {
    lastFocused = target;
  }
}

/** Start remembering the last control focused in the workspace; returns the cleanup. */
export function trackWorkspaceFocus(): () => void {
  document.addEventListener("focusin", onWorkspaceFocusIn);
  return () => removeEventListener("focusin", onWorkspaceFocusIn);
}

/** The last workspace control that had focus, for when Home opened from it. */
export function lastWorkspaceFocus(): HTMLElement | null {
  return lastFocused;
}

/** Put focus back on the opener, or on a control that still exists. */
export function restoreWorkspaceFocus(opener: HTMLElement | null): void {
  if (opener !== null && opener.isConnected && opener.closest("[inert]") === null) {
    opener.focus();
    return;
  }
  for (const selector of RETURN_FOCUS_FALLBACKS) {
    const target = document.querySelector<HTMLElement>(selector);
    if (target !== null && target.getClientRects().length > 0) {
      target.focus();
      return;
    }
  }
}
