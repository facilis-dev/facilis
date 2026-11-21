// The cluster fields of the addressable view (issue #62, F.4): group-by mode, collapsed
// cluster ids and the drill — panel-local, URL-synced, NEVER persisted to .facilis/graph/.
// Extracted from useProjectGraphViewState so that hook stays under the 300-line source limit;
// the setters cancel a pending deep-link restore exactly like every other view field.

import { useCallback, useState } from "react";
import {
  DEFAULT_GRAPH_VIEW_STATE,
  type GraphGroupBy,
  type GraphViewState,
} from "@/facilis/graph-view-state";

export interface GraphClusterLocalState {
  readonly groupBy: GraphGroupBy;
  readonly collapsedClusters: readonly string[];
  readonly drill: string | null;
}

const DEFAULT_CLUSTER_LOCAL: GraphClusterLocalState = {
  groupBy: DEFAULT_GRAPH_VIEW_STATE.groupBy,
  collapsedClusters: DEFAULT_GRAPH_VIEW_STATE.collapsedClusters,
  drill: DEFAULT_GRAPH_VIEW_STATE.drill,
};

export interface GraphClusterViewState {
  readonly local: GraphClusterLocalState;
  readonly setGroupBy: (groupBy: GraphGroupBy) => void;
  readonly setCollapsedClusters: (ids: readonly string[]) => void;
  readonly setDrill: (id: string | null) => void;
  readonly reset: () => void;
  readonly restore: (pending: GraphViewState) => void;
}

export function useGraphClusterViewState(cancelRestore: () => void): GraphClusterViewState {
  const [local, setLocal] = useState<GraphClusterLocalState>(DEFAULT_CLUSTER_LOCAL);
  const setGroupBy = useCallback(
    (groupBy: GraphGroupBy) => {
      cancelRestore();
      setLocal((current) => ({ ...current, groupBy }));
    },
    [cancelRestore],
  );
  const setCollapsedClusters = useCallback(
    (ids: readonly string[]) => {
      cancelRestore();
      setLocal((current) => ({ ...current, collapsedClusters: ids }));
    },
    [cancelRestore],
  );
  const setDrill = useCallback(
    (id: string | null) => {
      cancelRestore();
      setLocal((current) => ({ ...current, drill: id }));
    },
    [cancelRestore],
  );
  const reset = useCallback(() => setLocal(DEFAULT_CLUSTER_LOCAL), []);
  const restore = useCallback(
    (pending: GraphViewState) =>
      setLocal({
        groupBy: pending.groupBy,
        collapsedClusters: pending.collapsedClusters,
        drill: pending.drill,
      }),
    [],
  );
  return { local, setGroupBy, setCollapsedClusters, setDrill, reset, restore };
}
