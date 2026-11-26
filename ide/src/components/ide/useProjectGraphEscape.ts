// Progressive Escape for the project graph (D-211, issues #187/#188/#194): cancel an open note
// editor first, then exit fullscreen, then clear an AI focus (D-171), then close the rich card,
// then the floating drawer, then clear the selection, then the active lens, then return to the
// overview. One key press does one thing; the ordering is the pure resolveEscapeAction ladder so
// it can be tested without a DOM. Typing targets keep Escape for themselves.

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
  noteEditing,
  onCancelNoteEdit,
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
  lensActive,
  onClearLens,
  mode,
  onOverview,
}: {
  noteEditing: boolean;
  onCancelNoteEdit: () => void;
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
  lensActive: boolean;
  onClearLens: () => void;
  mode: ProjectGraphMode;
  onOverview: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const action = resolveEscapeAction({
        noteEditing,
        fullscreen,
        typing: isTypingTarget(event.target),
        focusActive,
        richCardOpen,
        drawerOpen,
        selectedNodeId,
        lensActive,
        detail: mode.kind === "detail",
      });
      if (action === "cancel-note-edit") onCancelNoteEdit();
      else if (action === "exit-fullscreen") onExitFullscreen();
      else if (action === "clear-focus") onClearFocus();
      else if (action === "close-rich-card") onCloseRichCard();
      else if (action === "close-drawer") onCloseDrawer();
      else if (action === "clear-selection") onClearSelection();
      else if (action === "clear-lens") onClearLens();
      else if (action === "overview") onOverview();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    noteEditing,
    onCancelNoteEdit,
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
    lensActive,
    onClearLens,
    mode,
    onOverview,
  ]);
}
