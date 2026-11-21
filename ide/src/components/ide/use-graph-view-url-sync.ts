// The gv URL write lifecycle (issue #58), extracted from useProjectGraphViewState so the hook
// stays under the 300-line source limit: debounced replaceState writes once the restore landed
// and the layout loaded, plus the synchronous flush on unmount so closing the tab cannot drop
// the last keystroke. replaceState, never pushState: the view is not a navigation entry.

import { useCallback, useEffect, useRef } from "react";
import type { GraphViewState } from "@/facilis/graph-view-state";
import {
  GRAPH_VIEW_URL_DELAY_MS,
  GRAPH_VIEW_URL_MAX_LENGTH,
  graphViewSearch,
  withGraphViewParam,
} from "@/facilis/graph-view-state-url";

/** The URL budget left for the search string once origin, pathname and hash are accounted for. */
function searchBudget(): number {
  return GRAPH_VIEW_URL_MAX_LENGTH - (location.href.length - location.search.length);
}

function replaceSearch(search: string): void {
  const url = new URL(location.href);
  url.search = search;
  history.replaceState(history.state, "", url.toString());
}

export interface GraphViewUrlSync {
  /** Record a value already in the URL (adopt) so the writer does not echo it back. */
  readonly markWritten: (value: string) => void;
  /** Drop gv from the URL now (a different project root resets the view, criterion 5). */
  readonly reset: () => void;
}

export function useGraphViewUrlSync(
  state: GraphViewState,
  encoded: string,
  ready: boolean,
  layoutLoaded: boolean,
  root: string | null,
): GraphViewUrlSync {
  const lastWritten = useRef<string>("");
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

  const markWritten = useCallback((value: string) => {
    lastWritten.current = value;
  }, []);
  const reset = useCallback(() => {
    lastWritten.current = "";
    replaceSearch(withGraphViewParam(location.search, null));
  }, []);
  return { markWritten, reset };
}
