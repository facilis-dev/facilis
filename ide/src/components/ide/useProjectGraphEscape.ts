// Progressive Escape for the project graph (D-211, issue #187): exit fullscreen first, then
// clear an AI focus (D-171), then close the floating drawer, then clear the selection, then
// return to the overview. One key press does one thing. Typing targets keep Escape for
// themselves (the note editor cancels the edit), so the document listener never steals it.

import { useEffect } from "react";
import type { ProjectGraphMode } from "./project-graph-surface-mode";

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
      if (fullscreen) {
        onExitFullscreen();
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (focusActive) {
        onClearFocus();
        return;
      }
      if (drawerOpen) {
        onCloseDrawer();
        return;
      }
      if (selectedNodeId !== null) {
        onClearSelection();
        return;
      }
      if (mode.kind === "detail") onOverview();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    fullscreen,
    onExitFullscreen,
    focusActive,
    onClearFocus,
    drawerOpen,
    onCloseDrawer,
    selectedNodeId,
    onClearSelection,
    mode,
    onOverview,
  ]);
}
