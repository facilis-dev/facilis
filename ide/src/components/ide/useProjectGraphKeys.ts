// The graph canvas's keyboard surface (issue #66, epic #56 rule 6): Esc clears one layer at a
// time (the panel resolves the order through graphEscapeAction), Enter isolates the selection,
// G toggles feature grouping, C collapses the active cluster (issue #62) and E cycles the
// edge-concentration threshold (issue #64). Typing targets
// keep their keys — the note editor cancels its own edit with Esc — and native controls keep
// Enter for their own activation, so the canvas shortcut never steals a button's click. The
// handlers travel through a ref so the document listener is attached exactly once.

import { useEffect, useRef } from "react";

export interface ProjectGraphKeys {
  readonly onEscape: () => void;
  readonly onEnter: () => void;
  /** G: toggle the cluster layout mode (issue #62); absent leaves the key to the browser. */
  readonly onToggleGroupBy?: () => void;
  /** C: collapse/expand the drilled or selected cluster (issue #62). */
  readonly onCollapseCluster?: () => void;
  /** E: cycle the edge-concentration threshold off/4/8 (issue #64). */
  readonly onCycleConcentration?: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

/** Native interactive elements activate themselves with Enter; a focused node card does not. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("button, a, input, textarea, select, summary") !== null
  );
}

export function useProjectGraphKeys({
  onEscape,
  onEnter,
  onToggleGroupBy,
  onCollapseCluster,
  onCycleConcentration,
}: ProjectGraphKeys): void {
  const handlers = useRef({ onEscape, onEnter, onToggleGroupBy, onCollapseCluster, onCycleConcentration });
  useEffect(() => {
    handlers.current = { onEscape, onEnter, onToggleGroupBy, onCollapseCluster, onCycleConcentration };
  }, [onEscape, onEnter, onToggleGroupBy, onCollapseCluster, onCycleConcentration]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      if (event.key === "Escape") {
        handlers.current.onEscape();
        return;
      }
      if (event.key === "Enter" && !isInteractiveTarget(event.target)) {
        handlers.current.onEnter();
        return;
      }
      // Modifiers stay the browser's (Ctrl+C copies, Cmd+G finds): the cluster keys are bare.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "g" || event.key === "G") {
        handlers.current.onToggleGroupBy?.();
      } else if (event.key === "c" || event.key === "C") {
        handlers.current.onCollapseCluster?.();
      } else if (event.key === "e" || event.key === "E") {
        handlers.current.onCycleConcentration?.();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
