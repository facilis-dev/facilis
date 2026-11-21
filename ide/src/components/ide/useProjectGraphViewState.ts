// The project graph's addressable view (issue #58): composes the saved-layout hook with the
// panel-local view fields (mode, lenses, selection, user focus, query, cluster mode/collapse/
// drill) and keeps the tab URL in sync through the gv parameter. Restoring a deep link never
// writes .facilis: layout-derived fields go through the layout hook's non-persisting
// restoreView, and URL writes wait until the restore has landed so defaults cannot clobber a
// shared link. The cluster fields (issue #62) are view state only — never .facilis/graph/.
//
// The AI focus (D-171) stays a separate overlay: this hook never touches graph-focus.ts, so a
// tool's focus and the user's selection live and clear independently (criterion 6).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { RuntimeWindow } from "@/facilis/graph-runtime";
import type { IdeController } from "@/vv/controller";
import {
  DEFAULT_GRAPH_VIEW_STATE,
  decodeGraphViewState,
  encodeGraphViewState,
  type GraphGroupBy,
  type GraphLensId,
  type GraphViewMode,
  type GraphViewState,
} from "@/facilis/graph-view-state";
import { graphViewRootAction, readGraphViewParam } from "@/facilis/graph-view-state-url";
import { useGraphClusterViewState } from "./use-graph-cluster-view-state";
import { useGraphViewUrlSync } from "./use-graph-view-url-sync";
import { useProjectGraphLayout, type ProjectGraphLayout } from "./useProjectGraphLayout";

/** The fields the panel owns; filters/collapsed/viewport are read from the layout object. */
interface GraphViewLocalState {
  readonly mode: GraphViewMode;
  readonly activeLenses: readonly GraphLensId[];
  readonly isolatedEdgeKinds: readonly GraphEdgeKind[];
  readonly runtimeWindow: RuntimeWindow;
  readonly runtimeLive: boolean;
  readonly isolatedNode: string | null;
  readonly selection: string | null;
  readonly focus: readonly string[];
  readonly query: string;
}

const DEFAULT_LOCAL: GraphViewLocalState = {
  mode: DEFAULT_GRAPH_VIEW_STATE.mode,
  activeLenses: DEFAULT_GRAPH_VIEW_STATE.activeLenses,
  isolatedEdgeKinds: DEFAULT_GRAPH_VIEW_STATE.isolatedEdgeKinds,
  runtimeWindow: DEFAULT_GRAPH_VIEW_STATE.runtimeWindow,
  runtimeLive: DEFAULT_GRAPH_VIEW_STATE.runtimeLive,
  isolatedNode: DEFAULT_GRAPH_VIEW_STATE.isolatedNode,
  selection: DEFAULT_GRAPH_VIEW_STATE.selection,
  focus: DEFAULT_GRAPH_VIEW_STATE.focus,
  query: DEFAULT_GRAPH_VIEW_STATE.query,
};

export interface ProjectGraphViewState {
  /** The composed layout hook: positions, notes and the persisting setters stay as they were. */
  readonly graph: ProjectGraphLayout;
  readonly state: GraphViewState;
  /** False only while a deep link waits for the layout and analysis to restore onto. */
  readonly ready: boolean;
  readonly setMode: (mode: GraphViewMode) => void;
  readonly setActiveLenses: (lenses: readonly GraphLensId[]) => void;
  readonly setIsolatedEdgeKinds: (kinds: readonly GraphEdgeKind[]) => void;
  readonly setRuntimeWindow: (window: RuntimeWindow) => void;
  readonly setRuntimeLive: (live: boolean) => void;
  readonly setIsolatedNode: (id: string | null) => void;
  readonly setSelection: (id: string | null) => void;
  readonly setUserFocus: (ids: readonly string[]) => void;
  readonly setQuery: (query: string) => void;
  readonly setGroupBy: (groupBy: GraphGroupBy) => void;
  readonly setCollapsedClusters: (ids: readonly string[]) => void;
  readonly setDrill: (id: string | null) => void;
}

export function useProjectGraphViewState(
  controller: IdeController,
  root: string | null,
  knownNodeIds: ReadonlySet<string> | null,
): ProjectGraphViewState {
  const graph = useProjectGraphLayout(controller, root);
  const { layout, layoutLoaded, restoreView } = graph;
  const [local, setLocal] = useState<GraphViewLocalState>(DEFAULT_LOCAL);
  const [ready, setReady] = useState(false);
  // Which root the current URL state belongs to; null until a project adopts the parameter.
  const urlRoot = useRef<string | null>(null);
  const pendingRestore = useRef<GraphViewState | null>(null);

  // A user edit before the restore lands wins: the deep link is dropped, not replayed over
  // the edit, and URL writes unlock immediately.
  const cancelRestore = useCallback(() => {
    if (pendingRestore.current === null) return;
    pendingRestore.current = null;
    setReady(true);
  }, []);
  const clusterView = useGraphClusterViewState(cancelRestore);

  const setMode = useCallback(
    (mode: GraphViewMode) => {
      cancelRestore();
      setLocal((current) => ({ ...current, mode }));
    },
    [cancelRestore],
  );
  const setActiveLenses = useCallback(
    (lenses: readonly GraphLensId[]) => {
      cancelRestore();
      setLocal((current) => ({ ...current, activeLenses: lenses }));
    },
    [cancelRestore],
  );
  const setIsolatedEdgeKinds = useCallback(
    (kinds: readonly GraphEdgeKind[]) => {
      cancelRestore();
      setLocal((current) => ({ ...current, isolatedEdgeKinds: kinds }));
    },
    [cancelRestore],
  );
  const setRuntimeWindow = useCallback(
    (window: RuntimeWindow) => {
      cancelRestore();
      setLocal((current) => ({ ...current, runtimeWindow: window }));
    },
    [cancelRestore],
  );
  const setRuntimeLive = useCallback(
    (live: boolean) => {
      cancelRestore();
      setLocal((current) => ({ ...current, runtimeLive: live }));
    },
    [cancelRestore],
  );
  const setIsolatedNode = useCallback(
    (id: string | null) => {
      cancelRestore();
      setLocal((current) => ({ ...current, isolatedNode: id }));
    },
    [cancelRestore],
  );
  const setSelection = useCallback(
    (id: string | null) => {
      cancelRestore();
      setLocal((current) => ({ ...current, selection: id }));
    },
    [cancelRestore],
  );
  const setUserFocus = useCallback(
    (ids: readonly string[]) => {
      cancelRestore();
      setLocal((current) => ({ ...current, focus: ids }));
    },
    [cancelRestore],
  );
  const setQuery = useCallback(
    (query: string) => {
      cancelRestore();
      setLocal((current) => ({ ...current, query }));
    },
    [cancelRestore],
  );

  const collapsedIds = useMemo(
    () =>
      Object.entries(layout.collapsed)
        .filter(([, value]) => value)
        .map(([id]) => id),
    [layout.collapsed],
  );
  const state = useMemo<GraphViewState>(
    () => ({
      mode: local.mode,
      activeLenses: local.activeLenses,
      isolatedEdgeKinds: local.isolatedEdgeKinds,
      runtimeWindow: local.runtimeWindow,
      runtimeLive: local.runtimeLive,
      isolatedNode: local.isolatedNode,
      selection: local.selection,
      focus: local.focus,
      filters: { hiddenEdgeKinds: layout.hiddenEdges, tableVisibility: layout.tableVisibility },
      collapsed: collapsedIds,
      ...clusterView.local,
      viewport: layout.viewport ?? null,
      query: local.query,
    }),
    [
      local,
      layout.hiddenEdges,
      layout.tableVisibility,
      layout.viewport,
      collapsedIds,
      clusterView.local,
    ],
  );
  const encoded = encodeGraphViewState(state);
  const { markWritten, reset: resetUrl } = useGraphViewUrlSync(
    state,
    encoded,
    ready,
    layoutLoaded,
    root,
  );

  // Adopt the deep link on the first project, reset it on any other root (criterion 5).
  useEffect(() => {
    const action = graphViewRootAction(urlRoot.current, root);
    if (action === "none") return;
    urlRoot.current = root;
    if (action === "reset") {
      pendingRestore.current = null;
      setLocal(DEFAULT_LOCAL);
      clusterView.reset();
      resetUrl();
      setReady(true);
      return;
    }
    const raw = readGraphViewParam(location.search);
    markWritten(raw ?? "");
    if (raw === null || raw === "") {
      setReady(true);
      return;
    }
    pendingRestore.current = decodeGraphViewState(raw);
    setReady(false);
  }, [root, clusterView.reset, resetUrl, markWritten]);

  // Apply the decoded view once both gates are up: the layout (so the restore lands on loaded
  // state) and the analysis (so stale node ids degrade silently instead of selecting ghosts).
  useEffect(() => {
    const pending = pendingRestore.current;
    if (pending === null || !layoutLoaded || knownNodeIds === null) return;
    pendingRestore.current = null;
    const collapsed = pending.collapsed.filter((id) => knownNodeIds.has(id));
    setLocal({
      mode: pending.mode,
      activeLenses: pending.activeLenses,
      isolatedEdgeKinds: pending.isolatedEdgeKinds,
      runtimeWindow: pending.runtimeWindow,
      runtimeLive: pending.runtimeLive,
      isolatedNode:
        pending.isolatedNode !== null && knownNodeIds.has(pending.isolatedNode)
          ? pending.isolatedNode
          : null,
      selection:
        pending.selection !== null && knownNodeIds.has(pending.selection)
          ? pending.selection
          : null,
      focus: pending.focus.filter((id) => knownNodeIds.has(id)),
      query: pending.query,
    });
    // Cluster ids are derived, not analysis ids: they restore unfiltered and the clusters hook
    // drops the ones no current cluster carries (issue #62).
    clusterView.restore(pending);
    restoreView({
      hiddenEdgeKinds: pending.filters.hiddenEdgeKinds,
      tableVisibility: pending.filters.tableVisibility,
      collapsed: Object.fromEntries(collapsed.map((id) => [id, true])),
      viewport: pending.viewport,
    });
    setReady(true);
  }, [layoutLoaded, knownNodeIds, restoreView, clusterView.restore]);

  return {
    graph,
    state,
    ready,
    setMode,
    setActiveLenses,
    setIsolatedEdgeKinds,
    setRuntimeWindow,
    setRuntimeLive,
    setIsolatedNode,
    setSelection,
    setUserFocus,
    setQuery,
    setGroupBy: clusterView.setGroupBy,
    setCollapsedClusters: clusterView.setCollapsedClusters,
    setDrill: clusterView.setDrill,
  };
}
