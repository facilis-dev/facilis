// The graph canvas's keyboard surface (issues #66/#67/#68, epic #56 rule 6): one ref-based
// document listener resolves every key through the pure resolver (graph-keys.ts) — Esc clears
// one layer at a time (the panel resolves the order through graphEscapeAction), Enter isolates
// the selection, G groups, C collapses, E cycles the edge concentration, B toggles the bridges,
// M toggles topology ↔ matrix, F fits, 0 resets the zoom, 1/2 are the viewport zoom presets,
// "?" opens the shortcut sheet and Cmd/Ctrl+K the palette. Plain keys never fire on a typing
// target (the HUD search, the note editor); the palette combo does.
//
// F.8: the palette chord is focus-scoped, not a global hijack. This listener is mounted only
// while the graph tab is the active editor tab (EditorGroup renders ProjectGraphPanel then),
// and the chord additionally requires the event to originate inside the panel (or on the
// document itself, when nothing has focus): a Cmd/Ctrl+K typed in the terminal, the explorer or
// an editor keeps its own meaning. The action is consumed with preventDefault, and the resolver
// refuses an already-prevented event, so a handler that claims the chord first wins.

import { useEffect, useRef, type RefObject } from "react";
import {
  graphPaletteInScope,
  isTypingTargetInfo,
  resolveGraphKey,
  type GraphKeyAction,
} from "@/facilis/graph-keys";

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

/** F.8: the palette chord's scope — inside the graph panel, or nowhere focused at all. */
function paletteInScope(scope: Element | null, target: EventTarget | null): boolean {
  if (scope === null) return true;
  return graphPaletteInScope({
    scopeContainsTarget: target instanceof Node && scope.contains(target),
    targetIsDocument:
      target === null || target === document.body || target === document.documentElement,
  });
}

export function useProjectGraphKeys(
  handlers: ProjectGraphKeyHandlers,
  scopeRef?: RefObject<Element | null>,
): void {
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
      if (action === "palette" && !paletteInScope(scopeRef?.current ?? null, event.target)) return;
      // The palette combo must not also reach the browser's own search/shortcut.
      event.preventDefault();
      handler();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [scopeRef]);
}
