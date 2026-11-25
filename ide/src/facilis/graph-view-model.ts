// The incremental graph view-model owner (issue #186, D-211). The node/edge model is rebuilt
// ONLY when the dataset or the saved layout inputs change (analysis, saved positions, edge-kind
// filter, table visibility, collapsed cards). Search is a debounced match pass over the cached
// nodes — it never rebuilds node objects — and selection/focus never reach this module at all:
// they are draw state on the canvas surface. The panel drives this controller through
// useProjectGraphViewModel; the injectable builder and timers make the per-interaction cost
// unit-testable without a DOM.

import type { GraphEdgeKind, ProjectGraph } from "@facilis.dev/analyze";
import type { GraphLayoutFile, GraphPosition } from "./graph-layout-file.ts";
import { buildProjectGraphView } from "./graph-model.ts";
import {
  GRAPH_SEARCH_DEBOUNCE_MS,
  matchGraphNodes,
  normalizeGraphQuery,
} from "./graph-search.ts";
import type {
  GraphTableVisibility,
  ProjectGraphView,
  ProjectGraphViewInput,
} from "./graph-types.ts";

/** Everything the model depends on — and nothing else: no query, matched, selection or focus. */
export interface GraphViewModelInput {
  readonly graph: ProjectGraph | null;
  readonly positions: Readonly<Record<string, GraphPosition>>;
  readonly hiddenEdgeKinds: readonly GraphEdgeKind[];
  readonly tableVisibility: GraphTableVisibility;
  readonly collapsed: Readonly<Record<string, boolean>>;
}

/** Project the panel's analysis + saved layout onto the model inputs (shared with the tests). */
export function graphViewModelInput(
  graph: ProjectGraph | null,
  layout: GraphLayoutFile,
): GraphViewModelInput {
  return {
    graph,
    positions: layout.nodes,
    hiddenEdgeKinds: layout.hiddenEdges,
    tableVisibility: layout.tableVisibility,
    collapsed: layout.collapsed,
  };
}

/** The debounced match pass result: draw state for the surface, never a model input. */
export interface GraphSearchResult {
  /** The normalized (trimmed, lowercased) query the pass ran for; empty means no dimming. */
  readonly query: string;
  readonly matched: ReadonlySet<string>;
}

const EMPTY_MATCHED: ReadonlySet<string> = new Set<string>();

/** Opaque timer handles so tests can drive the debounce with a fake clock. */
export interface GraphViewModelTimers {
  readonly set: (callback: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
}

const DEFAULT_TIMERS: GraphViewModelTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  // Handles are opaque: browser numbers and Node timeouts both clear through clearTimeout.
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface GraphViewModelOptions {
  /** Called after each debounced match pass (outside render): publish the new draw state. */
  readonly onSearch: (result: GraphSearchResult) => void;
  readonly timers?: GraphViewModelTimers;
  readonly delayMs?: number;
  /** Injectable so tests can count model builds; defaults to the real builder. */
  readonly buildView?: (input: ProjectGraphViewInput) => ProjectGraphView;
}

export interface GraphViewModel {
  /** The memoized model: a rebuild happens only when the dataset/saved-layout inputs change. */
  update(input: GraphViewModelInput): ProjectGraphView | null;
  /** Debounced search input: a burst of keystrokes schedules at most one match pass. */
  pushQuery(query: string): void;
  /** Run the pending match pass now (no-op when nothing is pending). */
  flush(): void;
  /** Cancel any pending pass; the controller stays usable afterwards. */
  dispose(): void;
  readonly searchResult: GraphSearchResult;
}

function sameModelInput(a: GraphViewModelInput, b: GraphViewModelInput): boolean {
  // The layout helpers are immutable and preserve untouched fields, so reference equality is
  // the memo key: a viewport-only change (pan/zoom) keeps every one of these references.
  return (
    a.graph === b.graph &&
    a.positions === b.positions &&
    a.hiddenEdgeKinds === b.hiddenEdgeKinds &&
    a.collapsed === b.collapsed &&
    a.tableVisibility === b.tableVisibility
  );
}

export function createGraphViewModel(options: GraphViewModelOptions): GraphViewModel {
  const timers = options.timers ?? DEFAULT_TIMERS;
  const delayMs = options.delayMs ?? GRAPH_SEARCH_DEBOUNCE_MS;
  const buildView = options.buildView ?? buildProjectGraphView;

  let lastInput: GraphViewModelInput | null = null;
  let view: ProjectGraphView | null = null;
  let appliedQuery = "";
  let pendingQuery: string | null = null;
  let timer: unknown = null;
  let searchResult: GraphSearchResult = { query: "", matched: EMPTY_MATCHED };

  const runPass = (): void => {
    timer = null;
    const query = pendingQuery;
    pendingQuery = null;
    if (query === null) return;
    appliedQuery = query;
    searchResult = {
      query,
      matched: view === null ? EMPTY_MATCHED : matchGraphNodes(view.nodes, query),
    };
    options.onSearch(searchResult);
  };

  return {
    update(input) {
      if (input.graph === null) {
        lastInput = input;
        view = null;
        searchResult = { query: appliedQuery, matched: EMPTY_MATCHED };
        return null;
      }
      if (lastInput !== null && sameModelInput(lastInput, input)) return view;
      lastInput = input;
      view = buildView({
        graph: input.graph,
        positions: input.positions,
        hiddenEdgeKinds: input.hiddenEdgeKinds,
        tableVisibility: input.tableVisibility,
        collapsed: input.collapsed,
      });
      // A dataset change re-runs the ACTIVE query over the new nodes in the same pass; a
      // keystroke still never rebuilds anything.
      searchResult = { query: appliedQuery, matched: matchGraphNodes(view.nodes, appliedQuery) };
      return view;
    },
    pushQuery(query) {
      const normalized = normalizeGraphQuery(query);
      if (normalized === appliedQuery) {
        // Typed back to the applied value: cancel the pending pass, nothing to recompute.
        pendingQuery = null;
        if (timer !== null) {
          timers.clear(timer);
          timer = null;
        }
        return;
      }
      pendingQuery = normalized;
      if (timer !== null) timers.clear(timer);
      timer = timers.set(runPass, delayMs);
    },
    flush() {
      if (timer !== null) {
        timers.clear(timer);
        timer = null;
      }
      runPass();
    },
    dispose() {
      if (timer !== null) {
        timers.clear(timer);
        timer = null;
      }
      pendingQuery = null;
    },
    get searchResult() {
      return searchResult;
    },
  };
}
