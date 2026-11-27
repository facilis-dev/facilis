// The focus handoff for the graph's dialog surfaces (issue #216): move focus into the dialog on
// open, keep Tab inside it, and return focus to the control that opened it on close. Escape is
// deliberately absent — project-graph-escape owns every layer, and a second handler here would
// make one press close two.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { trappedTabTarget } from "./project-graph-focus-trap";

// Only what the browser itself makes keyboard-reachable: roving-tabindex options are skipped.
const TABBABLE = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

// The toolbar search is the graph's keyboard entry point, so it is where focus goes back when
// the control that opened the dialog is gone (a pointer-opened dialog has no opener at all).
const SEARCH_INPUT = "[data-project-graph-search]";

// renderToStaticMarkup renders both dialogs in the tests, where layout effects never run.
const useIsoLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

function tabbablesIn(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (element) => element.getClientRects().length > 0,
  );
}

/** The closer's return target: the opener if it still exists, else the toolbar search. */
export function returnFocusTarget(opener: HTMLElement | null): HTMLElement | null {
  if (opener !== null && opener.isConnected && opener.getClientRects().length > 0) return opener;
  const search = document.querySelector<HTMLElement>(SEARCH_INPUT);
  return search !== null && search.getClientRects().length > 0 ? search : null;
}

export interface DialogFocus {
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * Trap Tab inside `containerRef` while it is open and restore focus when it unmounts. The caller
 * gives the container `tabIndex={-1}`, so it receives focus on open and assistive tech announces
 * the dialog's name before its content.
 */
export function useProjectGraphDialogFocus(
  containerRef: RefObject<HTMLElement | null>,
): DialogFocus {
  const openerRef = useRef<HTMLElement | null>(null);
  useIsoLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const opener = document.activeElement;
    openerRef.current = opener instanceof HTMLElement ? opener : null;
    container.focus();
    return () => {
      returnFocusTarget(openerRef.current)?.focus();
    };
  }, [containerRef]);
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Tab") return;
      const container = containerRef.current;
      if (container === null) return;
      const items = tabbablesIn(container);
      const index = items.indexOf(document.activeElement as HTMLElement);
      const target = trappedTabTarget(index, items.length, event.shiftKey);
      if (target === null) return;
      event.preventDefault();
      items[target]?.focus();
    },
    [containerRef],
  );
  return { onKeyDown };
}
