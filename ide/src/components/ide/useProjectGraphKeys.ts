// The graph canvas's keyboard surface (issues #66/#67/#68, epic #56 rule 6): one ref-based
// document listener resolves every key through the pure resolver (graph-keys.ts) — Esc clears
// one layer at a time (the panel resolves the order through graphEscapeAction), Enter isolates
// the selection, "m" toggles topology ↔ matrix, F fits, 0 resets the zoom, 1/2 are the
// viewport zoom presets, "?" opens the shortcut sheet and Cmd/Ctrl+K the palette. Plain keys
// never fire on a typing target (the HUD search, the note editor); the palette combo does.

import { useEffect, useRef } from "react";
import { isTypingTargetInfo, resolveGraphKey, type GraphKeyAction } from "@/facilis/graph-keys";

export type ProjectGraphKeyHandlers = Partial<Record<GraphKeyAction, () => void>>;

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && isTypingTargetInfo(target);
}

/** Native interactive elements activate themselves with Enter; a focused node card does not. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("button, a, input, textarea, select, summary") !== null
  );
}

export function useProjectGraphKeys(handlers: ProjectGraphKeyHandlers): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  }, [handlers]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = resolveGraphKey({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        defaultPrevented: event.defaultPrevented,
        typingTarget: isTypingTarget(event.target),
        interactiveTarget: isInteractiveTarget(event.target),
      });
      if (action === null) return;
      const handler = ref.current[action];
      if (handler === undefined) return;
      // The palette combo must not also reach the browser's own search/shortcut.
      event.preventDefault();
      handler();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
