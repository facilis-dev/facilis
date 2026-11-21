// The panel-local view fields and their setters (issue #58), extracted from
// useProjectGraphViewState so that hook stays under the 300-line source limit as modes and
// lenses add fields. Every setter cancels a pending deep-link restore first: a user edit before
// the restore lands wins, and URL writes unlock immediately. The matrix sort (issue #67) rides
// the same pattern — panel-local, URL-synced through gv's ms key, never .facilis/graph/.

import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { AuditFilterId } from "@/facilis/graph-contract";
import type { RuntimeWindow } from "@/facilis/graph-runtime";
import type { GraphMatrixSort } from "@/facilis/graph-matrix";
import {
  DEFAULT_GRAPH_VIEW_STATE,
  type GraphEdgeConcentration,
  type GraphLensId,
  type GraphViewMode,
} from "@/facilis/graph-view-state";

/** The fields the panel owns; filters/collapsed/viewport are read from the layout object. */
export interface GraphViewLocalState {
  readonly mode: GraphViewMode;
  readonly activeLenses: readonly GraphLensId[];
  readonly isolatedEdgeKinds: readonly GraphEdgeKind[];
  readonly auditFilters: readonly AuditFilterId[];
  readonly runtimeWindow: RuntimeWindow;
  readonly runtimeLive: boolean;
  readonly isolatedNode: string | null;
  readonly selection: string | null;
  readonly focus: readonly string[];
  readonly query: string;
  readonly edgeConcentration: GraphEdgeConcentration;
  readonly bridges: boolean;
  readonly matrixSort: GraphMatrixSort;
}

export const DEFAULT_GRAPH_VIEW_LOCAL: GraphViewLocalState = {
  mode: DEFAULT_GRAPH_VIEW_STATE.mode,
  activeLenses: DEFAULT_GRAPH_VIEW_STATE.activeLenses,
  isolatedEdgeKinds: DEFAULT_GRAPH_VIEW_STATE.isolatedEdgeKinds,
  auditFilters: DEFAULT_GRAPH_VIEW_STATE.auditFilters,
  runtimeWindow: DEFAULT_GRAPH_VIEW_STATE.runtimeWindow,
  runtimeLive: DEFAULT_GRAPH_VIEW_STATE.runtimeLive,
  isolatedNode: DEFAULT_GRAPH_VIEW_STATE.isolatedNode,
  selection: DEFAULT_GRAPH_VIEW_STATE.selection,
  focus: DEFAULT_GRAPH_VIEW_STATE.focus,
  query: DEFAULT_GRAPH_VIEW_STATE.query,
  edgeConcentration: DEFAULT_GRAPH_VIEW_STATE.edgeConcentration,
  bridges: DEFAULT_GRAPH_VIEW_STATE.bridges,
  matrixSort: DEFAULT_GRAPH_VIEW_STATE.matrixSort,
};

export interface GraphViewSetters {
  readonly setMode: (mode: GraphViewMode) => void;
  readonly setActiveLenses: (lenses: readonly GraphLensId[]) => void;
  readonly setIsolatedEdgeKinds: (kinds: readonly GraphEdgeKind[]) => void;
  readonly setAuditFilters: (filters: readonly AuditFilterId[]) => void;
  readonly setRuntimeWindow: (window: RuntimeWindow) => void;
  readonly setRuntimeLive: (live: boolean) => void;
  readonly setIsolatedNode: (id: string | null) => void;
  readonly setSelection: (id: string | null) => void;
  readonly setUserFocus: (ids: readonly string[]) => void;
  readonly setQuery: (query: string) => void;
  readonly setEdgeConcentration: (value: GraphEdgeConcentration) => void;
  readonly setBridges: (bridges: boolean) => void;
  readonly setMatrixSort: (sort: GraphMatrixSort) => void;
}

export function useGraphViewSetters(
  cancelRestore: () => void,
  setLocal: Dispatch<SetStateAction<GraphViewLocalState>>,
): GraphViewSetters {
  const setMode = useCallback(
    (mode: GraphViewMode) => {
      cancelRestore();
      setLocal((current) => ({ ...current, mode }));
    },
    [cancelRestore, setLocal],
  );
  const setActiveLenses = useCallback(
    (lenses: readonly GraphLensId[]) => {
      cancelRestore();
      setLocal((current) => ({ ...current, activeLenses: lenses }));
    },
    [cancelRestore, setLocal],
  );
  const setIsolatedEdgeKinds = useCallback(
    (kinds: readonly GraphEdgeKind[]) => {
      cancelRestore();
      setLocal((current) => ({ ...current, isolatedEdgeKinds: kinds }));
    },
    [cancelRestore, setLocal],
  );
  const setAuditFilters = useCallback(
    (filters: readonly AuditFilterId[]) => {
      cancelRestore();
      setLocal((current) => ({ ...current, auditFilters: filters }));
    },
    [cancelRestore, setLocal],
  );
  const setRuntimeWindow = useCallback(
    (window: RuntimeWindow) => {
      cancelRestore();
      setLocal((current) => ({ ...current, runtimeWindow: window }));
    },
    [cancelRestore, setLocal],
  );
  const setRuntimeLive = useCallback(
    (live: boolean) => {
      cancelRestore();
      setLocal((current) => ({ ...current, runtimeLive: live }));
    },
    [cancelRestore, setLocal],
  );
  const setIsolatedNode = useCallback(
    (id: string | null) => {
      cancelRestore();
      setLocal((current) => ({ ...current, isolatedNode: id }));
    },
    [cancelRestore, setLocal],
  );
  const setSelection = useCallback(
    (id: string | null) => {
      cancelRestore();
      setLocal((current) => ({ ...current, selection: id }));
    },
    [cancelRestore, setLocal],
  );
  const setUserFocus = useCallback(
    (ids: readonly string[]) => {
      cancelRestore();
      setLocal((current) => ({ ...current, focus: ids }));
    },
    [cancelRestore, setLocal],
  );
  const setQuery = useCallback(
    (query: string) => {
      cancelRestore();
      setLocal((current) => ({ ...current, query }));
    },
    [cancelRestore, setLocal],
  );
  const setEdgeConcentration = useCallback(
    (edgeConcentration: GraphEdgeConcentration) => {
      cancelRestore();
      setLocal((current) => ({ ...current, edgeConcentration }));
    },
    [cancelRestore, setLocal],
  );
  const setBridges = useCallback(
    (bridges: boolean) => {
      cancelRestore();
      setLocal((current) => ({ ...current, bridges }));
    },
    [cancelRestore, setLocal],
  );
  const setMatrixSort = useCallback(
    (sort: GraphMatrixSort) => {
      cancelRestore();
      setLocal((current) => ({ ...current, matrixSort: sort }));
    },
    [cancelRestore, setLocal],
  );
  return {
    setMode,
    setActiveLenses,
    setIsolatedEdgeKinds,
    setAuditFilters,
    setRuntimeWindow,
    setRuntimeLive,
    setIsolatedNode,
    setSelection,
    setUserFocus,
    setQuery,
    setEdgeConcentration,
    setBridges,
    setMatrixSort,
  };
}
