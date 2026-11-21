// The cluster orchestration (issue #62, F.4): derives the enabled layout MODE from the group-by
// choice and the node count, owns the drill-down and the collapse toggle, and drops stale ids.
// Everything it writes is URL view state — never .facilis/graph/. The keyboard (G toggles
// grouping, C collapses the drilled or selected cluster, Esc goes up one level) is delivered by
// useProjectGraphKeys through the panel's Esc ladder, so one listener owns every graph key.

import { useCallback, useEffect, useMemo } from "react";
import { isClusterGroupingEnabled } from "@/facilis/graph-clusters";
import type { GraphCluster } from "@/facilis/graph-types";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { ProjectGraphDrill } from "./project-graph-flow-nodes";
import type { ProjectGraphViewState } from "./useProjectGraphViewState";

export interface ProjectGraphClusters {
  readonly enabled: boolean;
  readonly drill: ProjectGraphDrill | null;
  readonly drillCluster: GraphCluster | null;
  readonly toggleGroupBy: () => void;
  readonly toggleCollapse: (id: string) => void;
  /** C's target: the drilled cluster, else the one holding the selection (issue #62). */
  readonly collapseActive: () => void;
  readonly drillInto: (id: string) => void;
  readonly drillUp: () => void;
}

export function useProjectGraphClusters(
  viewState: ProjectGraphViewState,
  view: ProjectGraphView | null,
  nodeCount: number,
): ProjectGraphClusters {
  const { state, setGroupBy, setCollapsedClusters, setDrill } = viewState;
  const enabled = isClusterGroupingEnabled(state.groupBy, nodeCount);
  const clusters = view?.clusters ?? [];
  const drillCluster =
    state.drill === null ? null : (clusters.find((cluster) => cluster.id === state.drill) ?? null);
  const drill = useMemo<ProjectGraphDrill | null>(
    () =>
      drillCluster === null
        ? null
        : { clusterId: drillCluster.id, nodeIds: new Set(drillCluster.nodeIds) },
    [drillCluster],
  );
  const toggleGroupBy = useCallback(() => {
    setGroupBy(enabled ? "off" : "on");
  }, [enabled, setGroupBy]);
  const toggleCollapse = useCallback(
    (id: string) => {
      const cluster = clusters.find((entry) => entry.id === id);
      if (cluster === undefined || !cluster.collapsible) return;
      const isCollapsed = state.collapsedClusters.includes(id);
      const collapsed = isCollapsed
        ? state.collapsedClusters.filter((entry) => entry !== id)
        : [...state.collapsedClusters, id];
      setCollapsedClusters(collapsed);
      // Collapsing the cluster you stand inside goes up one level: the drill forces it open,
      // so staying drilled would make the collapse look like it did nothing.
      if (!isCollapsed && state.drill === id) setDrill(null);
    },
    [clusters, state.collapsedClusters, state.drill, setCollapsedClusters, setDrill],
  );
  const collapseActive = useCallback(() => {
    const target =
      drill?.clusterId ??
      clusters.find((cluster) => cluster.nodeIds.includes(state.selection ?? ""))?.id;
    if (target !== undefined) toggleCollapse(target);
  }, [drill, clusters, state.selection, toggleCollapse]);
  const drillInto = useCallback((id: string) => setDrill(id), [setDrill]);
  const drillUp = useCallback(() => setDrill(null), [setDrill]);

  // A reload or a re-analysis can leave ids no current cluster carries: drop them silently so
  // the URL never accumulates ghosts (the decoder cannot check derived ids itself).
  useEffect(() => {
    if (view === null) return;
    const ids = new Set(clusters.map((cluster) => cluster.id));
    if (state.drill !== null && !ids.has(state.drill)) setDrill(null);
    const kept = state.collapsedClusters.filter((id) => ids.has(id));
    if (kept.length !== state.collapsedClusters.length) setCollapsedClusters(kept);
  }, [view, clusters, state.drill, state.collapsedClusters, setDrill, setCollapsedClusters]);

  return {
    enabled,
    drill,
    drillCluster,
    toggleGroupBy,
    toggleCollapse,
    collapseActive,
    drillInto,
    drillUp,
  };
}
