// Shared dialog behaviour for the details surfaces (issue #59): focus moves inside on open,
// Tab cycles within the card, and Esc closes without leaking to the canvas' zen/focus handlers
// (stopPropagation keeps the document-level listeners from seeing it).

import { useEffect, type KeyboardEvent, type RefObject } from "react";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function useDetailsDialog(
  ref: RefObject<HTMLDivElement | null>,
  onClose: () => void,
): (event: KeyboardEvent<HTMLDivElement>) => void {
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const first = element.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? element).focus();
  }, [ref]);

  return (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const element = ref.current;
    if (element === null) return;
    const items = [...element.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (item) => !item.hasAttribute("disabled"),
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === element)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
}
