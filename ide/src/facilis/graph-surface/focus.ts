// Selection focus for the map-and-lens surface (D-219, issue #187): selecting a node dims
// everything outside its neighbourhood. A PAGE reaches two hops (page -> routes -> tables/views)
// so its data is visible on the canvas; every other kind reaches one. The neighbourhood is
// computed from the cached adjacency index — draw state only, never a model or layout rebuild.

/** Undirected adjacency over the full graph: ports must not hide the far side of an edge. */
export function buildNeighborIndex(
  edges: readonly { readonly source: string; readonly target: string }[],
): ReadonlyMap<string, readonly string[]> {
  const sets = new Map<string, Set<string>>();
  const add = (from: string, to: string): void => {
    let set = sets.get(from);
    if (set === undefined) {
      set = new Set<string>();
      sets.set(from, set);
    }
    set.add(to);
  };
  for (const edge of edges) {
    add(edge.source, edge.target);
    add(edge.target, edge.source);
  }
  const index = new Map<string, readonly string[]>();
  for (const [id, set] of sets) index.set(id, [...set].toSorted());
  return index;
}

/** A page's neighbourhood is two hops; routes, tables, views and workflows use one. */
export function focusHops(kind: string): number {
  return kind === "page" ? 2 : 1;
}

/** Breadth-first neighbourhood around `root`, including the root itself. */
export function focusNeighborhood(
  neighbors: ReadonlyMap<string, readonly string[]>,
  root: string,
  maxHops: number,
): ReadonlySet<string> {
  const focused = new Set<string>([root]);
  let frontier: readonly string[] = [root];
  for (let hop = 0; hop < maxHops; hop += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const adjacent of neighbors.get(id) ?? []) {
        if (focused.has(adjacent)) continue;
        focused.add(adjacent);
        next.push(adjacent);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return focused;
}
