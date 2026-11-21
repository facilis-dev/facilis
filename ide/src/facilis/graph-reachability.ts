// The selection's reachability closure (issue #66, epic #56): "what reaches this, and what
// does this reach?". Pure like graph-paths.ts, but direction matters here: the closure is the
// union of a DOWNSTREAM walk (following directed edges source → target) and an UPSTREAM walk
// (against them), so a route that writes the same table as the selection is only in context
// when it actually connects to it. fk/relation are undirected schema links (owner decision,
// D-171): they connect both ways inside either walk.
//
// The closure runs over the VISIBLE view's edges — hidden kinds, filtered cards and collapsed
// state are already applied by graph-model.ts, so a tool-free user action and the canvas agree
// on what exists. Cycle-safe (visited sets), deterministic (sorted ids), never throws.

import type { ProjectGraphEdge } from "./graph-types";

/** The slice of the visible view the traversal needs; ProjectGraphView satisfies it. */
export interface ReachabilityInput {
  readonly nodes: readonly { readonly id: string }[];
  readonly edges: readonly ProjectGraphEdge[];
}

export interface GraphReachability {
  /** Sorted closure ids, including the start node. */
  readonly nodeIds: readonly string[];
  /** Sorted ids of the edges whose two endpoints are both in the closure. */
  readonly edgeIds: readonly string[];
}

/** fk/relation connect both ways; every other kind keeps its direction. */
function isUndirected(kind: ProjectGraphEdge["kind"]): boolean {
  return kind === "fk" || kind === "relation";
}

interface Walks {
  readonly downstream: ReadonlyMap<string, readonly string[]>;
  readonly upstream: ReadonlyMap<string, readonly string[]>;
}

function walksOf(input: ReachabilityInput): Walks {
  const known = new Set(input.nodes.map((node) => node.id));
  const downstream = new Map<string, string[]>(input.nodes.map((node) => [node.id, []]));
  const upstream = new Map<string, string[]>(input.nodes.map((node) => [node.id, []]));
  for (const edge of input.edges) {
    // A self-loop reaches nothing new, and an edge with a filtered endpoint does not exist.
    if (edge.source === edge.target) continue;
    if (!known.has(edge.source) || !known.has(edge.target)) continue;
    if (isUndirected(edge.kind)) {
      downstream.get(edge.source)?.push(edge.target);
      downstream.get(edge.target)?.push(edge.source);
      upstream.get(edge.source)?.push(edge.target);
      upstream.get(edge.target)?.push(edge.source);
    } else {
      downstream.get(edge.source)?.push(edge.target);
      upstream.get(edge.target)?.push(edge.source);
    }
  }
  return { downstream, upstream };
}

/** One breadth-first flood; the visited set is what makes a schema cycle terminate. */
function flood(start: string, neighbours: ReadonlyMap<string, readonly string[]>): Set<string> {
  const visited = new Set<string>([start]);
  const queue: string[] = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current === undefined) continue;
    for (const next of neighbours.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

/**
 * The closure of one node, or null when the id is not in the visible view (a stale deep link
 * or an analysis refresh must degrade to "no focus", never dim against a ghost).
 */
export function reachabilityClosure(
  input: ReachabilityInput,
  fromId: string,
): GraphReachability | null {
  if (!input.nodes.some((node) => node.id === fromId)) return null;
  const walks = walksOf(input);
  const reached = flood(fromId, walks.downstream);
  for (const id of flood(fromId, walks.upstream)) reached.add(id);
  const nodeIds = [...reached].toSorted((a, b) => a.localeCompare(b));
  const edgeIds = input.edges
    .filter((edge) => reached.has(edge.source) && reached.has(edge.target))
    .map((edge) => edge.id)
    .toSorted((a, b) => a.localeCompare(b));
  return { nodeIds, edgeIds };
}
