// The graph's Esc ladder and shortcuts (issue #66, epic #56 rule 6), resolved through
// graphEscapeAction and delivered by useProjectGraphKeys: Esc clears one layer at a time
// (zen → isolate → selection → drill → AI focus), Enter isolates the selection's closure (F.5:
// the isolate is dim-only, F.6: double-click keeps opening the source), G toggles the cluster
// layout mode and C collapses the active cluster (issue #62). Replaces the separate
// zen/details/focus Esc handlers so one keypress clears exactly one layer; E cycles the
// edge-concentration threshold (issue #64); typing targets and
// the details dialog's own Esc trap keep their keys (the dialog stops propagation).

import { clearGraphFocus } from "@/facilis/graph-focus";
import { graphEscapeAction } from "@/facilis/graph-user-focus";
import { useProjectGraphKeys } from "./useProjectGraphKeys";

export interface ProjectGraphEscapeInput {
  readonly zen: boolean;
  readonly isolatedNode: string | null;
  readonly selection: string | null;
  /** The drilled-into cluster id (issue #62), or null at the root level. */
  readonly drill: string | null;
  readonly aiFocusActive: boolean;
  readonly onExitZen: () => void;
  readonly onClearSelection: () => void;
  readonly setIsolatedNode: (id: string | null) => void;
  readonly onDrillUp: () => void;
  readonly onToggleGroupBy: () => void;
  readonly onCollapseCluster: () => void;
  readonly onCycleConcentration: () => void;
  readonly onToggleBridges: () => void;
}

export function useProjectGraphEscape(input: ProjectGraphEscapeInput): void {
  useProjectGraphKeys({
    onEscape: () => {
      const action = graphEscapeAction(input);
      if (action === "exit-zen") input.onExitZen();
      else if (action === "exit-isolate") input.setIsolatedNode(null);
      else if (action === "clear-selection") input.onClearSelection();
      else if (action === "exit-drill") input.onDrillUp();
      else if (action === "clear-ai-focus") clearGraphFocus();
    },
    onEnter: () => {
      if (input.selection !== null) input.setIsolatedNode(input.selection);
    },
    onToggleGroupBy: input.onToggleGroupBy,
    onCollapseCluster: input.onCollapseCluster,
    onCycleConcentration: input.onCycleConcentration,
    onToggleBridges: input.onToggleBridges,
  });
}
