// The project-graph search popup's keyboard and selection model (issue #220), kept pure so the
// behaviour is testable without a DOM. The search control owns one disclosure list: it is open
// while the control has focus and the query is not blank, Up/Down move a roving focus (real DOM
// focus on the option), Enter activates the active option, and Escape clears or closes the popup
// itself so the global Escape ladder never has to know about it.

export interface GraphSearchKeyInput {
  readonly key: string;
  /** The keydown came from the text input, not from one of the options. */
  readonly fromInput: boolean;
  readonly query: string;
  readonly activeIndex: number;
  readonly resultCount: number;
}

export type GraphSearchKeyAction =
  | { readonly kind: "move"; readonly index: number }
  | { readonly kind: "jump"; readonly index: number }
  | { readonly kind: "submit" }
  | { readonly kind: "clear" }
  | { readonly kind: "close" }
  | { readonly kind: "none" };

/** The popup lives while the search control owns focus and the query can match a node. */
export function isGraphSearchOpen(query: string, focusWithin: boolean): boolean {
  return focusWithin && query.trim().length > 0;
}

/**
 * The next roving index. Wrapping keeps the first Down from the input and the first Up from it
 * meaningful; an empty list parks the focus at -1.
 */
export function moveGraphSearchIndex(
  activeIndex: number,
  delta: 1 | -1,
  resultCount: number,
): number {
  if (resultCount === 0) return -1;
  const inRange = activeIndex >= 0 && activeIndex < resultCount;
  const current = inRange ? activeIndex : delta > 0 ? -1 : 0;
  return (current + delta + resultCount) % resultCount;
}

export function resolveGraphSearchKey(input: GraphSearchKeyInput): GraphSearchKeyAction {
  const { key, fromInput, query, activeIndex, resultCount } = input;
  if (key === "ArrowDown" || key === "ArrowUp") {
    if (resultCount === 0) return { kind: "none" };
    const delta = key === "ArrowDown" ? 1 : -1;
    return { kind: "move", index: moveGraphSearchIndex(activeIndex, delta, resultCount) };
  }
  if (key === "Enter") {
    // The active option wins; from the input with no active option Enter keeps its old job
    // (flush the debounce and jump to the first match).
    if (activeIndex >= 0 && activeIndex < resultCount) return { kind: "jump", index: activeIndex };
    return fromInput ? { kind: "submit" } : { kind: "none" };
  }
  if (key === "Escape") return query.length > 0 ? { kind: "clear" } : { kind: "close" };
  return { kind: "none" };
}
