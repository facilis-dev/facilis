// The project graph's addressable view (issue #58): the saved-layout hook plus the panel-local
// fields, URL-synced through gv. A deep-link restore never writes .facilis (restoreView carries
// layout fields; URL writes wait so defaults cannot clobber a shared link). Cluster fields (#62)
// are view state only; the AI focus (D-171) stays a separate, independently cleared overlay.
// The field setters live in use-graph-view-setters.ts (300-line split); the matrix sort (#67)
// is one more panel-local field, carried by the same restore/URL lifecycle.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IdeController } from "@/vv/controller";
import {
  decodeGraphViewState,
  encodeGraphViewState,
  type GraphGroupBy,
  type GraphViewState,
} from "@/facilis/graph-view-state";
import { graphViewRootAction, readGraphViewParam } from "@/facilis/graph-view-state-url";
import { useGraphClusterViewState } from "./use-graph-cluster-view-state";
import {
  DEFAULT_GRAPH_VIEW_LOCAL,
  useGraphViewSetters,
  type GraphViewLocalState,
  type GraphViewSetters,
} from "./use-graph-view-setters";
import { useGraphViewUrlSync } from "./use-graph-view-url-sync";
import { useProjectGraphLayout, type ProjectGraphLayout } from "./useProjectGraphLayout";

export interface ProjectGraphViewState extends GraphViewSetters {
  /** The composed layout hook: positions, notes and the persisting setters stay as they were. */
  readonly graph: ProjectGraphLayout;
  readonly state: GraphViewState;
  /** False only while a deep link waits for the layout and analysis to restore onto. */
  readonly ready: boolean;
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
  const [local, setLocal] = useState<GraphViewLocalState>(DEFAULT_GRAPH_VIEW_LOCAL);
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

  const setters = useGraphViewSetters(cancelRestore, setLocal);

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
      matrixSort: local.matrixSort,
      edgeConcentration: local.edgeConcentration,
      bridges: local.bridges,
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
      setLocal(DEFAULT_GRAPH_VIEW_LOCAL);
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
      matrixSort: pending.matrixSort,
      edgeConcentration: pending.edgeConcentration,
      bridges: pending.bridges,
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
    ...setters,
    setGroupBy: clusterView.setGroupBy,
    setCollapsedClusters: clusterView.setCollapsedClusters,
    setDrill: clusterView.setDrill,
  };
}
