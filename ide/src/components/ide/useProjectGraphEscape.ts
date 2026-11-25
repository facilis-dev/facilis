// Progressive Escape for the project graph (D-211, issues #187/#188): exit fullscreen first,
// then clear an AI focus (D-171), then close the rich card, then the floating drawer, then clear
// the selection, then return to the overview. One key press does one thing; the ordering is the
// pure resolveEscapeAction ladder so it can be tested without a DOM. Typing targets keep Escape
// for themselves (the note editor cancels the edit), so the document listener never steals it.

import { useEffect } from "react";
import type { ProjectGraphMode } from "./project-graph-surface-mode";
import { resolveEscapeAction } from "./project-graph-escape";

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

export function useProjectGraphEscape({
  fullscreen,
  onExitFullscreen,
  focusActive,
  onClearFocus,
  richCardOpen,
  onCloseRichCard,
  drawerOpen,
  onCloseDrawer,
  selectedNodeId,
  onClearSelection,
  mode,
  onOverview,
}: {
  fullscreen: boolean;
  onExitFullscreen: () => void;
  focusActive: boolean;
  onClearFocus: () => void;
  richCardOpen: boolean;
  onCloseRichCard: () => void;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  selectedNodeId: string | null;
  onClearSelection: () => void;
  mode: ProjectGraphMode;
  onOverview: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const action = resolveEscapeAction({
        fullscreen,
        typing: isTypingTarget(event.target),
        focusActive,
        richCardOpen,
        drawerOpen,
        selectedNodeId,
        detail: mode.kind === "detail",
      });
      if (action === "exit-fullscreen") onExitFullscreen();
      else if (action === "clear-focus") onClearFocus();
      else if (action === "close-rich-card") onCloseRichCard();
      else if (action === "close-drawer") onCloseDrawer();
      else if (action === "clear-selection") onClearSelection();
      else if (action === "overview") onOverview();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    fullscreen,
    onExitFullscreen,
    focusActive,
    onClearFocus,
    richCardOpen,
    onCloseRichCard,
    drawerOpen,
    onCloseDrawer,
    selectedNodeId,
    onClearSelection,
    mode,
    onOverview,
  ]);
}
