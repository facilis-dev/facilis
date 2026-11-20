// Merging the graph view state into the tab URL (issue #58). Pure string helpers: the hook
// owns location/history, this module owns the parameter semantics so they are unit-testable
// without a browser (D-173). Every write is a read-modify-write of URLSearchParams: the
// ?project= identity, ?net= and any future parameter keep their value and position.

import { encodeGraphViewState, type GraphViewState } from "./graph-view-state";

export const GRAPH_VIEW_PARAM = "gv";
/** Debounce for URL writes: shareable promptly, without churning the URL on every keystroke. */
export const GRAPH_VIEW_URL_DELAY_MS = 250;
/** The whole tab URL stays under 2 KB (issue #58 criterion 4). */
export const GRAPH_VIEW_URL_MAX_LENGTH = 2048;

export function readGraphViewParam(search: string): string | null {
  return new URLSearchParams(search).get(GRAPH_VIEW_PARAM);
}

/** Set or remove only gv; an empty value removes it (the default view is a clean URL). */
export function withGraphViewParam(search: string, value: string | null): string {
  const params = new URLSearchParams(search);
  if (value === null || value === "") params.delete(GRAPH_VIEW_PARAM);
  else params.set(GRAPH_VIEW_PARAM, value);
  return params.toString();
}

export type GraphViewRootAction = "adopt" | "reset" | "none";

/**
 * Which root the URL state belongs to decides the transition: the first project adopts the
 * deep link, a different root resets it (criterion 5), and a tab that never had a project
 * leaves the URL alone — a cold boot's ?project=&gv= must survive until the project opens.
 */
export function graphViewRootAction(
  urlRoot: string | null,
  root: string | null,
): GraphViewRootAction {
  if (root === null) return urlRoot === null ? "none" : "reset";
  if (urlRoot === null) return "adopt";
  return urlRoot === root ? "none" : "reset";
}

/**
 * The search string to write for a state, keeping the URL under maxLength (the caller passes
 * the budget left after origin + pathname + hash). When the full snapshot does not fit, the
 * bulkiest view-only fields are shed in order — collapsed ids, then user focus, then query —
 * so a 500-node project's URL stays shareable; shed fields degrade to defaults on the
 * receiving tab. Ids only, never coordinates.
 */
export function graphViewSearch(
  search: string,
  state: GraphViewState,
  maxLength: number = GRAPH_VIEW_URL_MAX_LENGTH,
): string {
  const full = withGraphViewParam(search, encodeGraphViewState(state));
  if (full.length <= maxLength) return full;
  const shed: readonly GraphViewState[] = [
    { ...state, collapsed: [] },
    { ...state, collapsed: [], focus: [] },
    { ...state, collapsed: [], focus: [], query: "" },
  ];
  for (const step of shed) {
    const next = withGraphViewParam(search, encodeGraphViewState(step));
    if (next.length <= maxLength) return next;
  }
  return withGraphViewParam(search, null);
}
