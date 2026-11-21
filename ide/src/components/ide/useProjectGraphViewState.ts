// The project graph's addressable view (issue #58): composes the saved-layout hook with the
// panel-local view fields (mode, lenses, selection, user focus, query) and keeps the tab URL
// in sync through the gv parameter. Restoring a deep link never writes .facilis: layout-derived
// fields go through the layout hook's non-persisting restoreView, and URL writes wait until
// the restore has landed so defaults cannot clobber a shared link.
//
// The AI focus (D-171) stays a separate overlay: this hook never touches graph-focus.ts, so a
// tool's focus and the user's selection live and clear independently (criterion 6).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { IdeController } from "@/vv/controller";
import type { GraphMatrixSort } from "@/facilis/graph-matrix";
import {
  DEFAULT_GRAPH_VIEW_STATE,
  decodeGraphViewState,
  encodeGraphViewState,
  type GraphLensId,
  type GraphViewMode,
  type GraphViewState,
} from "@/facilis/graph-view-state";
import {
  GRAPH_VIEW_URL_DELAY_MS,
  GRAPH_VIEW_URL_MAX_LENGTH,
  graphViewRootAction,
  graphViewSearch,
  readGraphViewParam,
  withGraphViewParam,
} from "@/facilis/graph-view-state-url";
import { useProjectGraphLayout, type ProjectGraphLayout } from "./useProjectGraphLayout";

/** The fields the panel owns; filters/collapsed/viewport are read from the layout object. */
interface GraphViewLocalState {
  readonly mode: GraphViewMode;
  readonly activeLenses: readonly GraphLensId[];
  readonly isolatedEdgeKinds: readonly GraphEdgeKind[];
  readonly isolatedNode: string | null;
  readonly selection: string | null;
  readonly focus: readonly string[];
  readonly query: string;
  readonly matrixSort: GraphMatrixSort;
}

const DEFAULT_LOCAL: GraphViewLocalState = {
  mode: DEFAULT_GRAPH_VIEW_STATE.mode,
  activeLenses: DEFAULT_GRAPH_VIEW_STATE.activeLenses,
  isolatedEdgeKinds: DEFAULT_GRAPH_VIEW_STATE.isolatedEdgeKinds,
  isolatedNode: DEFAULT_GRAPH_VIEW_STATE.isolatedNode,
  selection: DEFAULT_GRAPH_VIEW_STATE.selection,
  focus: DEFAULT_GRAPH_VIEW_STATE.focus,
  query: DEFAULT_GRAPH_VIEW_STATE.query,
  matrixSort: DEFAULT_GRAPH_VIEW_STATE.matrixSort,
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
  readonly setIsolatedNode: (id: string | null) => void;
  readonly setSelection: (id: string | null) => void;
  readonly setUserFocus: (ids: readonly string[]) => void;
  readonly setQuery: (query: string) => void;
  readonly setMatrixSort: (sort: GraphMatrixSort) => void;
}

/**
 * replaceState, never pushState: the view is not a navigation entry. history.state, the hash
 * and every other parameter survive because only the search string is rebuilt.
 */
function replaceSearch(search: string): void {
  const url = new URL(location.href);
  url.search = search;
  history.replaceState(history.state, "", url.toString());
}

/** The URL budget left for the search string once origin, pathname and hash are accounted for. */
function searchBudget(): number {
  return GRAPH_VIEW_URL_MAX_LENGTH - (location.href.length - location.search.length);
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
  const lastWritten = useRef<string>("");

  // Adopt the deep link on the first project, reset it on any other root (criterion 5).
  useEffect(() => {
    const action = graphViewRootAction(urlRoot.current, root);
    if (action === "none") return;
    urlRoot.current = root;
    if (action === "reset") {
      pendingRestore.current = null;
      setLocal(DEFAULT_LOCAL);
      lastWritten.current = "";
      setReady(true);
      replaceSearch(withGraphViewParam(location.search, null));
      return;
    }
    const raw = readGraphViewParam(location.search);
    lastWritten.current = raw ?? "";
    if (raw === null || raw === "") {
      setReady(true);
      return;
    }
    pendingRestore.current = decodeGraphViewState(raw);
    setReady(false);
  }, [root]);

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
    });
    restoreView({
      hiddenEdgeKinds: pending.filters.hiddenEdgeKinds,
      tableVisibility: pending.filters.tableVisibility,
      collapsed: Object.fromEntries(collapsed.map((id) => [id, true])),
      viewport: pending.viewport,
    });
    setReady(true);
  }, [layoutLoaded, knownNodeIds, restoreView]);

  // A user edit before the restore lands wins: the deep link is dropped, not replayed over
  // the edit, and URL writes unlock immediately.
  const cancelRestore = useCallback(() => {
    if (pendingRestore.current === null) return;
    pendingRestore.current = null;
    setReady(true);
  }, []);

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

  const setMatrixSort = useCallback(
    (sort: GraphMatrixSort) => {
      cancelRestore();
      setLocal((current) => ({ ...current, matrixSort: sort }));
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
      isolatedNode: local.isolatedNode,
      selection: local.selection,
      focus: local.focus,
      filters: { hiddenEdgeKinds: layout.hiddenEdges, tableVisibility: layout.tableVisibility },
      collapsed: collapsedIds,
      viewport: layout.viewport ?? null,
      query: local.query,
      matrixSort: local.matrixSort,
    }),
    [local, layout.hiddenEdges, layout.tableVisibility, layout.viewport, collapsedIds],
  );
  const encoded = encodeGraphViewState(state);

  // The URL write: debounced, only when the encoded value changed, and never before the
  // restore landed or the layout loaded (a snapshot taken mid-load would omit saved fields).
  useEffect(() => {
    if (!ready || !layoutLoaded || root === null) return;
    if (encoded === lastWritten.current) return;
    const timer = setTimeout(() => {
      lastWritten.current = encoded;
      replaceSearch(graphViewSearch(location.search, state, searchBudget()));
    }, GRAPH_VIEW_URL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [encoded, ready, layoutLoaded, root, state]);

  // Closing the tab must not drop the last keystroke: flush the pending write synchronously.
  const latest = useRef({ state, encoded, ready, layoutLoaded, root });
  latest.current = { state, encoded, ready, layoutLoaded, root };
  useEffect(
    () => () => {
      const snap = latest.current;
      if (!snap.ready || !snap.layoutLoaded || snap.root === null) return;
      if (snap.encoded === lastWritten.current) return;
      lastWritten.current = snap.encoded;
      replaceSearch(graphViewSearch(location.search, snap.state, searchBudget()));
    },
    [],
  );

  return {
    graph,
    state,
    ready,
    setMode,
    setActiveLenses,
    setIsolatedEdgeKinds,
    setIsolatedNode,
    setSelection,
    setUserFocus,
    setQuery,
    setMatrixSort,
  };
}
