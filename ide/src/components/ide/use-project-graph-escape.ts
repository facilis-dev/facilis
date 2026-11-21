// The graph's Esc ladder and shortcuts (issue #66, epic #56 rule 6), resolved through
// graphEscapeAction and delivered by useProjectGraphKeys: Esc clears one layer at a time
// (zen → impact → isolate → selection → drill → AI focus), Enter isolates the selection's
// closure (F.5: the isolate is dim-only, F.6: double-click keeps opening the source), G toggles
// the cluster layout mode and C collapses the active cluster (issue #62), E cycles the
// edge-concentration threshold (issue #64), B toggles the bridges (issue #65), M toggles
// topology ↔ matrix (issue #67), and the navigation keys (F, 0, 1, 2, ?, Cmd/Ctrl+K) dispatch
// to the navigation hook (issue #68). One listener owns every graph key — the palette and the
// shortcut sheet resolve their own Esc/Enter inside their dialogs and prevent it, so the
// document-level ladder never double-fires. Typing targets keep their keys.

import type { RefObject } from "react";
import { clearGraphFocus } from "@/facilis/graph-focus";
import { graphEscapeAction } from "@/facilis/graph-user-focus";
import { useProjectGraphKeys } from "./useProjectGraphKeys";
import type { ProjectGraphNavigation } from "./useProjectGraphNavigation";

export interface ProjectGraphEscapeInput {
  readonly zen: boolean;
  /** The impact lens (issue #74): Esc drops the simulation before isolation/selection. */
  readonly impactActive: boolean;
  readonly isolatedNode: string | null;
  readonly selection: string | null;
  /** The drilled-into cluster id (issue #62), or null at the root level. */
  readonly drill: string | null;
  readonly aiFocusActive: boolean;
  readonly onExitZen: () => void;
  /** Removes only the impact lens and its column (issue #74, criterion 5). */
  readonly onExitImpact: () => void;
  readonly onClearSelection: () => void;
  readonly setIsolatedNode: (id: string | null) => void;
  readonly onDrillUp: () => void;
  readonly onToggleGroupBy: () => void;
  readonly onCollapseCluster: () => void;
  readonly onCycleConcentration: () => void;
  readonly onToggleBridges: () => void;
  readonly onToggleMode: () => void;
  /** The navigation surface (issue #68): fit, zoom presets, palette and shortcut sheet. */
  readonly navigation: ProjectGraphNavigation;
  /** F.8: the graph panel element that scopes the Cmd/Ctrl+K palette chord. */
  readonly focusScope: RefObject<Element | null>;
}

export function useProjectGraphEscape(input: ProjectGraphEscapeInput): void {
  useProjectGraphKeys(
    {
      escape: () => {
        const action = graphEscapeAction(input);
        if (action === "exit-zen") input.onExitZen();
        else if (action === "exit-impact") input.onExitImpact();
        else if (action === "exit-isolate") input.setIsolatedNode(null);
        else if (action === "clear-selection") input.onClearSelection();
        else if (action === "exit-drill") input.onDrillUp();
        else if (action === "clear-ai-focus") clearGraphFocus();
      },
      enter: () => {
        if (input.selection !== null) input.setIsolatedNode(input.selection);
      },
      "toggle-group-by": input.onToggleGroupBy,
      "collapse-cluster": input.onCollapseCluster,
      "cycle-concentration": input.onCycleConcentration,
      "toggle-bridges": input.onToggleBridges,
      "toggle-mode": input.onToggleMode,
      fit: input.navigation.fit,
      "reset-zoom": input.navigation.resetZoom,
      "zoom-preset-compact": () => input.navigation.applyZoomPreset(1),
      "zoom-preset-full": () => input.navigation.applyZoomPreset(2),
      "shortcut-sheet": input.navigation.openSheet,
      palette: input.navigation.openPalette,
    },
    input.focusScope,
  );
}
