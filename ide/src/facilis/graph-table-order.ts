// Linear table ordering for the schema column (issue #186): one Kahn pass over the FK/relation
// DAG with a rank-ordered ready heap. The previous implementation re-sorted every remaining id
// on each iteration (O(T^2 log T)); this one sorts once and keeps the ready set in a min-heap
// keyed by lexicographic rank, so the whole pass is O(T log T + E). Behaviour is unchanged:
// a table comes before the tables it points at, ties break lexicographically, and cycles —
// legal in a schema — fall back to the lexicographically first remaining id.

import type { ProjectGraphEdge, ProjectGraphNode } from "./graph-types.ts";

export function isTableEdge(edge: ProjectGraphEdge): boolean {
  return edge.kind === "fk" || edge.kind === "relation";
}

/** Sift a rank up the min-heap; ranks compare numerically because they index the sorted ids. */
function pushRank(heap: number[], value: number): void {
  heap.push(value);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    const a = heap[parent];
    const b = heap[i];
    if (a === undefined || b === undefined || a <= b) break;
    heap[parent] = b;
    heap[i] = a;
    i = parent;
  }
}

function popRank(heap: number[]): number | undefined {
  if (heap.length === 0) return undefined;
  const top = heap[0];
  const last = heap.pop();
  if (heap.length > 0 && last !== undefined) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let best = i;
      const bestValue = heap[best];
      const leftValue = heap[left];
      const rightValue = heap[right];
      if (leftValue !== undefined && (bestValue === undefined || leftValue < bestValue)) best = left;
      const bestNow = heap[best];
      if (rightValue !== undefined && (bestNow === undefined || rightValue < bestNow)) best = right;
      if (best === i) break;
      const a = heap[best];
      const b = heap[i];
      if (a === undefined || b === undefined) break;
      heap[best] = b;
      heap[i] = a;
      i = best;
    }
  }
  return top;
}

/**
 * Order the table column by FK/relation dependency (a table before the tables it points at),
 * breaking ties lexicographically so the same graph always produces the same rows. Duplicate
 * edges count once; self-edges are ignored; an edge with an endpoint outside the column is
 * dropped. Cycles fall back to the lexicographically first remaining id, exactly as the old
 * re-sort-each-iteration did.
 */
export function orderTables(
  tables: readonly ProjectGraphNode[],
  edges: readonly ProjectGraphEdge[],
): string[] {
  const ids = tables.map((node) => node.id).toSorted();
  const rank = new Map(ids.map((id, index) => [id, index] as const));
  const outgoing = new Map<string, string[]>(ids.map((id) => [id, []]));
  const incoming = new Map<string, number>(ids.map((id) => [id, 0]));
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!isTableEdge(edge) || !rank.has(edge.source) || !rank.has(edge.target)) continue;
    if (edge.source === edge.target) continue;
    const pair = edge.source + "\u0000" + edge.target;
    if (seen.has(pair)) continue;
    seen.add(pair);
    outgoing.get(edge.source)?.push(edge.target);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  const heap: number[] = [];
  const placed = Array.from({ length: ids.length }, () => false);
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    if (id !== undefined && (incoming.get(id) ?? 0) === 0) pushRank(heap, i);
  }

  const order: string[] = [];
  // The fallback scan only advances, so cycle recovery costs O(T) across the whole pass.
  let scan = 0;
  while (order.length < ids.length) {
    let index = popRank(heap);
    if (index === undefined) {
      while (scan < ids.length && placed[scan]) scan += 1;
      index = scan;
    }
    const id = ids[index];
    if (id === undefined) break;
    placed[index] = true;
    order.push(id);
    for (const target of outgoing.get(id) ?? []) {
      const targetRank = rank.get(target);
      if (targetRank === undefined || placed[targetRank]) continue;
      const left = Math.max(0, (incoming.get(target) ?? 0) - 1);
      incoming.set(target, left);
      if (left === 0) pushRank(heap, targetRank);
    }
  }
  return order;
}
