// Esc clears an active AI focus (D-171) — the rung between zen and the details surface in the
// panel's Esc ladder. Extracted from ProjectGraphPanel for the 300-line limit; typing targets
// keep their Escape (the note editor cancels its own draft first).

import { useEffect } from "react";
import { clearGraphFocus } from "@/facilis/graph-focus";

export function useFocusEscape(focusActive: boolean, zen: boolean): void {
  useEffect(() => {
    if (!focusActive || zen) return;
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
      clearGraphFocus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focusActive, zen]);
}
