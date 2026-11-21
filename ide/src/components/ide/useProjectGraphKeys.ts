// The graph canvas's keyboard surface (issue #66, epic #56 rule 6): Esc clears one layer at a
// time (the panel resolves the order through graphEscapeAction), Enter isolates the selection,
// "m" toggles topology ↔ matrix (issue #67).
// Typing targets keep their keys — the note editor cancels its own edit with Esc — and native
// controls keep Enter for their own activation, so the canvas shortcut never steals a button's
// click. The handlers travel through a ref so the document listener is attached exactly once.

import { useEffect, useRef } from "react";

export interface ProjectGraphKeys {
  readonly onEscape: () => void;
  readonly onEnter: () => void;
  /** "m" — the mode toggle; typing targets keep the letter for their own input. */
  readonly onToggleMode?: () => void;
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

export function useProjectGraphKeys({ onEscape, onEnter, onToggleMode }: ProjectGraphKeys): void {
  const handlers = useRef({ onEscape, onEnter, onToggleMode });
  useEffect(() => {
    handlers.current = { onEscape, onEnter, onToggleMode };
  }, [onEscape, onEnter, onToggleMode]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      if (event.key === "Escape") {
        handlers.current.onEscape();
      } else if (event.key === "Enter" && !isInteractiveTarget(event.target)) {
        handlers.current.onEnter();
      } else if (event.key === "m" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        handlers.current.onToggleMode?.();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
