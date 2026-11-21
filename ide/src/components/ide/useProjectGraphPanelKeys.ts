// The panel's keyboard semantics (issue #66 + issue #67), split from ProjectGraphPanel.tsx so
// the composition root stays under the source limit: Esc clears one layer at a time (the order
// lives in graphEscapeAction), Enter isolates the selection, and "m" toggles topology ↔ matrix
// (epic rule 6: every mode is keyboard-reachable). The matrix grid owns Enter for its cell
// cursor and preventDefaults it, so the document-level isolate never doubles up on a cell.

import type { GraphViewMode } from "@/facilis/graph-view-state";
import { graphEscapeAction } from "@/facilis/graph-user-focus";
import { clearGraphFocus } from "@/facilis/graph-focus";
import { useProjectGraphKeys } from "./useProjectGraphKeys";

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
}): void {
  useProjectGraphKeys({
    onEscape: () => {
      const action = graphEscapeAction({ zen, isolatedNode, selection, aiFocusActive });
      if (action === "exit-zen") exitZen();
      else if (action === "exit-isolate") setIsolatedNode(null);
      else if (action === "clear-selection") setSelection(null);
      else if (action === "clear-ai-focus") clearGraphFocus();
    },
    onEnter: () => {
      if (selection !== null) setIsolatedNode(selection);
    },
    onToggleMode: () => setMode(mode === "matrix" ? "topology" : "matrix"),
  });
}
