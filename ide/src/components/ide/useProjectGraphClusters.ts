// The cluster orchestration (issue #62): derives the enabled lens from the group-by choice and
// the node count, composes the model input, owns the drill-down and the collapse toggle, and
// binds the keyboard (epic #56 rule 6: G toggles grouping, C collapses the drilled or selected
// cluster, Esc goes up one level). Everything it writes is URL view state — never .facilis/graph/.

import { useCallback, useEffect, useMemo, useRef } from "react";
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
  readonly drillInto: (id: string) => void;
  readonly drillUp: () => void;
}

/** Typing targets keep their keys (the search box, the note editor); modifiers stay browser's. */
function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

export function useProjectGraphClusters(
  viewState: ProjectGraphViewState,
  view: ProjectGraphView | null,
  nodeCount: number,
  zen: boolean,
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

  // The keyboard reads the latest actions through a ref so the listener registers once.
  const latest = useRef({ toggleGroupBy, toggleCollapse, drillUp, drill, clusters, selection: state.selection, zen });
  latest.current = { toggleGroupBy, toggleCollapse, drillUp, drill, clusters, selection: state.selection, zen };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
      const snap = latest.current;
      if (event.key === "Escape") {
        // Zen owns Esc first; the drill owns it before the AI focus (which checks preventDefault).
        if (snap.zen || snap.drill === null || event.defaultPrevented) return;
        event.preventDefault();
        snap.drillUp();
        return;
      }
      if (event.key === "g" || event.key === "G") {
        snap.toggleGroupBy();
        return;
      }
      if (event.key === "c" || event.key === "C") {
        const target =
          snap.drill?.clusterId ??
          snap.clusters.find((cluster) => cluster.nodeIds.includes(snap.selection ?? ""))?.id;
        if (target !== undefined) snap.toggleCollapse(target);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return { enabled, drill, drillCluster, toggleGroupBy, toggleCollapse, drillInto, drillUp };
}
