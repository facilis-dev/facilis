// The panel's keyboard semantics (issues #66/#67/#68), split from ProjectGraphPanel.tsx so
// the composition root stays under the source limit: Esc clears one layer at a time (the order
// lives in graphEscapeAction — the palette/sheet dialogs close FIRST, handling and preventing
// Esc themselves), Enter isolates the selection, "m" toggles topology ↔ matrix, and the
// navigation keys (F, 0, 1, 2, ?, Cmd/Ctrl+K) dispatch to the navigation hook. The matrix grid
// owns Enter for its cell cursor and preventDefaults it, so the document-level isolate never
// doubles up on a cell. Typing targets keep their plain keys — the resolver guards.

import type { GraphViewMode } from "@/facilis/graph-view-state";
import { graphEscapeAction } from "@/facilis/graph-user-focus";
import { clearGraphFocus } from "@/facilis/graph-focus";
import { useProjectGraphKeys } from "./useProjectGraphKeys";
import type { ProjectGraphNavigation } from "./useProjectGraphNavigation";

export function useProjectGraphPanelKeys({
  zen,
  exitZen,
  isolatedNode,
  setIsolatedNode,
  selection,
  setSelection,
  aiFocusActive,
  mode,
  setMode,
  navigation,
}: {
  zen: boolean;
  exitZen: () => void;
  isolatedNode: string | null;
  setIsolatedNode: (id: string | null) => void;
  selection: string | null;
  setSelection: (id: string | null) => void;
  aiFocusActive: boolean;
  mode: GraphViewMode;
  setMode: (mode: GraphViewMode) => void;
  navigation: ProjectGraphNavigation;
}): void {
  useProjectGraphKeys({
    escape: () => {
      const action = graphEscapeAction({ zen, isolatedNode, selection, aiFocusActive });
      if (action === "exit-zen") exitZen();
      else if (action === "exit-isolate") setIsolatedNode(null);
      else if (action === "clear-selection") setSelection(null);
      else if (action === "clear-ai-focus") clearGraphFocus();
    },
    enter: () => {
      if (selection !== null) setIsolatedNode(selection);
    },
    "toggle-mode": () => setMode(mode === "matrix" ? "topology" : "matrix"),
    fit: navigation.fit,
    "reset-zoom": navigation.resetZoom,
    "zoom-preset-compact": () => navigation.applyZoomPreset(1),
    "zoom-preset-full": () => navigation.applyZoomPreset(2),
    "shortcut-sheet": navigation.openSheet,
    palette: navigation.openPalette,
  });
}
