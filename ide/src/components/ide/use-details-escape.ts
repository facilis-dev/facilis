// Esc fallback for the open details (issue #59): React Flow focuses the clicked card, and that
// focus can win the race with the dialog's mount focus, leaving the key outside the trap. This
// document-level handler closes the details anyway (unless the user is typing). It registers
// before the AI-focus handler and stops immediate propagation, so one Esc closes one thing:
// zen first (the panel gates this on !zen), then the details, then an AI focus. The dialog's
// own Esc handler stops propagation at the element, so this never double-closes.

import { useEffect } from "react";

export function useDetailsEscape(
  selectedNodeId: string | null,
  zen: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (selectedNodeId === null || zen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      if (typing) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedNodeId, zen, onClose]);
}
