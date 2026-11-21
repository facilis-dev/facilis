// The HUD slot composition (issue #57's slots): the lens chips (#63), the selection-context
// focus bar (#66) and the runtime lens's window/live strip (#72), extracted from
// ProjectGraphPanel so the composition root stays under the 300-line source limit. The slots
// stay ReactNode props of the Hud — the docked ribbon owns where they render (issue #150).

import { useMemo, type ReactNode } from "react";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { ProjectGraphStats } from "@/facilis/graph-model";
import type { GraphClosureSummary } from "@/facilis/graph-user-focus";
import { ProjectGraphFocusBar } from "./ProjectGraphFocusBar";
import { ProjectGraphHudClusters } from "./ProjectGraphHudClusters";
import { ProjectGraphLensChips } from "./ProjectGraphLensChips";
import { ProjectGraphRuntimeControls } from "./ProjectGraphRuntimeControls";
import type { ProjectGraphClusters } from "./useProjectGraphClusters";
import type { ProjectGraphRuntimeLens } from "./useProjectGraphRuntimeLens";
import type { ProjectGraphViewState } from "./useProjectGraphViewState";

export interface ProjectGraphHudSlots {
  readonly lensChips: ReactNode;
  readonly focusBar: ReactNode;
  /** null while the runtime lens is inactive: the ribbon renders exactly as before. */
  readonly runtimeControls: ReactNode;
  /** The cluster breadcrumb + group-by toggle (issue #62), in the top-left cluster. */
  readonly clusterControls: ReactNode;
}

export function useProjectGraphHudSlots({
  stats,
  edgeCounts,
  hiddenEdgeKinds,
  viewState,
  onHideEdgeKind,
  focusSummary,
  isolatedNode,
  selectedNodeId,
  runtime,
  clusters,
}: {
  stats: ProjectGraphStats | null;
  edgeCounts: Readonly<Record<GraphEdgeKind, number>>;
  hiddenEdgeKinds: readonly GraphEdgeKind[];
  viewState: ProjectGraphViewState;
  onHideEdgeKind: (kind: GraphEdgeKind, hidden: boolean) => void;
  focusSummary: GraphClosureSummary | null;
  isolatedNode: string | null;
  selectedNodeId: string | null;
  runtime: ProjectGraphRuntimeLens;
  clusters: ProjectGraphClusters;
}): ProjectGraphHudSlots {
  const lensChips = useMemo(
    () => (
      <ProjectGraphLensChips
        disabled={stats === null}
        edgeCounts={edgeCounts}
        hiddenEdgeKinds={hiddenEdgeKinds}
        isolatedEdgeKinds={viewState.state.isolatedEdgeKinds}
        onIsolatedEdgeKindsChange={viewState.setIsolatedEdgeKinds}
        onHideEdgeKind={onHideEdgeKind}
        activeLenses={viewState.state.activeLenses}
        onActiveLensesChange={viewState.setActiveLenses}
      />
    ),
    [stats, edgeCounts, hiddenEdgeKinds, viewState, onHideEdgeKind],
  );
  const focusBar = useMemo(
    () => (
      <ProjectGraphFocusBar
        summary={focusSummary}
        isolated={isolatedNode !== null}
        selectedNodeId={selectedNodeId}
        onIsolateChange={viewState.setIsolatedNode}
      />
    ),
    [focusSummary, isolatedNode, selectedNodeId, viewState],
  );
  const runtimeControls = useMemo(
    () =>
      runtime.context === null ? null : (
        <ProjectGraphRuntimeControls
          window={runtime.window}
          live={runtime.live}
          onWindowChange={runtime.setWindow}
          onLiveChange={runtime.setLive}
        />
      ),
    [runtime],
  );
  const clusterControls = useMemo(
    () => (
      <ProjectGraphHudClusters
        enabled={clusters.enabled}
        drillKey={clusters.drillCluster?.key ?? null}
        onToggleGroupBy={clusters.toggleGroupBy}
        onDrillUp={clusters.drillUp}
      />
    ),
    [clusters],
  );
  return { lensChips, focusBar, runtimeControls, clusterControls };
}
