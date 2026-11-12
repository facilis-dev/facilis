// The graph_paths search: shortest paths over the project graph's visible edges (D-171).
//
// The graph is a mesh of typed relations, not a tree: an fk edge points from the referencing
// table to its target, but for "how are these two things connected" either direction reads the
// same. The search is therefore UNDIRECTED (owner decision, 2026-11-12): a route reaches a
// table through its fk/route-table edge regardless of which end is the source.
//
// BFS, not Dijkstra: every hop is one connection and the caps are tiny (<=5 paths, <=12 hops),
// so the fewest-hop answer is the useful one. Ties are broken by sorted ids at every step, so
// the same view always returns the same paths instead of a walk that depends on edge order.

/** The slice of an edge the search needs: direction is discarded on purpose. */
export interface GraphPathEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
}

export interface GraphPathInput {
  readonly nodeIds: readonly string[];
  readonly edges: readonly GraphPathEdge[];
}

export interface GraphPathQuery {
  readonly from: string;
  /** When absent, one path per closest reachable node is returned (see findGraphPaths). */
  readonly to?: string;
  readonly maxPaths: number;
  readonly maxHops: number;
}

export interface GraphPath {
  readonly nodes: readonly string[];
  readonly edges: readonly string[];
}

export interface GraphPathsResult {
  readonly paths: readonly GraphPath[];
  /** Requested ids that are not in the visible view. */
  readonly unknown: readonly string[];
}

/** Caps shared with the tool schema: a larger answer is a guess, not an inspection. */
export const MAX_PATHS = 5;
export const MAX_HOPS = 12;

interface Neighbour {
  readonly id: string;
  readonly edgeId: string;
}

interface Step {
  readonly previous: string;
  readonly edgeId: string;
}

interface Walk {
  readonly distance: Map<string, number>;
  readonly parents: Map<string, Step>;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** Undirected adjacency, one entry per direction, sorted so BFS visits neighbours stably. */
function adjacencyOf(input: GraphPathInput): Map<string, readonly Neighbour[]> {
  const byId = new Map<string, Neighbour[]>();
  for (const id of input.nodeIds) byId.set(id, []);
  for (const edge of input.edges) {
    // A self-loop cannot shorten a path, and an edge with a filtered endpoint does not exist.
    if (edge.source === edge.target) continue;
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (source === undefined || target === undefined) continue;
    source.push({ id: edge.target, edgeId: edge.id });
    target.push({ id: edge.source, edgeId: edge.id });
  }
  for (const list of byId.values()) {
    list.sort(
      (left, right) => left.id.localeCompare(right.id) || left.edgeId.localeCompare(right.edgeId),
    );
  }
  return byId;
}

function walkFrom(input: GraphPathInput, from: string, maxHops: number): Walk {
  const neighbours = adjacencyOf(input);
  const distance = new Map<string, number>([[from, 0]]);
  const parents = new Map<string, Step>();
  const queue: string[] = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current === undefined) continue;
    const hops = distance.get(current) ?? 0;
    if (hops >= maxHops) continue;
    for (const neighbour of neighbours.get(current) ?? []) {
      if (distance.has(neighbour.id)) continue;
      distance.set(neighbour.id, hops + 1);
      parents.set(neighbour.id, { previous: current, edgeId: neighbour.edgeId });
      queue.push(neighbour.id);
    }
  }
  return { distance, parents };
}

/** The chain from `from` to `target`; null when the BFS did not actually reach the target. */
function pathTo(
  from: string,
  target: string,
  parents: ReadonlyMap<string, Step>,
): GraphPath | null {
  const nodes: string[] = [target];
  const edges: string[] = [];
  let current = target;
  while (current !== from) {
    const step = parents.get(current);
    if (step === undefined) return null;
    edges.push(step.edgeId);
    current = step.previous;
    nodes.push(current);
  }
  return { nodes: nodes.reverse(), edges: edges.reverse() };
}

/**
 * Shortest undirected paths over the visible graph.
 *
 * With `to`: the single fewest-hop path (empty when unreachable within maxHops). Without:
 * the shortest path to each of the closest maxPaths reachable nodes, ordered by hop count and
 * then by id. The "no target" form is the one a model uses for "what talks to this table"; the
 * single-node path is used when from === to (no target form), not for an absent target.
 */
export function findGraphPaths(input: GraphPathInput, query: GraphPathQuery): GraphPathsResult {
  const known = new Set(input.nodeIds);
  const requested = query.to === undefined ? [query.from] : [query.from, query.to];
  const unknown = requested.filter(
    (id, index) => !known.has(id) && requested.indexOf(id) === index,
  );
  if (unknown.length > 0) return { paths: [], unknown: unknown.toSorted() };
  const maxHops = clamp(query.maxHops, 0, MAX_HOPS);
  const maxPaths = clamp(query.maxPaths, 1, MAX_PATHS);
  const { distance, parents } = walkFrom(input, query.from, maxHops);
  if (query.to !== undefined) {
    const target = query.to;
    if (!distance.has(target)) return { paths: [], unknown: [] };
    const path = pathTo(query.from, target, parents);
    return { paths: path === null ? [] : [path], unknown: [] };
  }
  const reachable = [...distance.entries()]
    .filter(([id]) => id !== query.from)
    .toSorted((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
    .slice(0, maxPaths);
  const paths: GraphPath[] = [];
  for (const [id] of reachable) {
    const path = pathTo(query.from, id, parents);
    if (path !== null) paths.push(path);
  }
  return { paths, unknown: [] };
}
