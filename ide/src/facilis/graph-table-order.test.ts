// Table ordering (issue #186): correctness against the historical quadratic semantics on a few
// hundred tables and randomized graphs, plus a deterministic operation-count guard proving the
// pass sorts O(T log T) elements instead of re-sorting the remaining set every iteration.
import { describe, expect, it } from "vitest";
import { isTableEdge, orderTables } from "./graph-table-order.ts";
import type { ProjectGraphEdge, ProjectGraphNode } from "./graph-types.ts";

function table(id: string): ProjectGraphNode {
  return {
    id,
    kind: "table",
    label: id,
    sourceFile: "db/schema.ts",
    position: { x: 0, y: 0 },
    data: {
      kind: "table",
      table: id,
      columns: [],
      rlsEnabled: true,
      framework: false,
      scope: null,
      policies: [],
      unknown: false,
    },
    matched: true,
    collapsed: false,
  };
}

function fk(source: string, target: string, id = source + "->" + target): ProjectGraphEdge {
  return { id, kind: "fk", source, target, label: null };
}

/** The historical O(T^2 log T) implementation, kept here as the correctness oracle only. */
function referenceOrder(
  tables: readonly ProjectGraphNode[],
  edges: readonly ProjectGraphEdge[],
): string[] {
  const ids = tables.map((node) => node.id).toSorted();
  const idSet = new Set(ids);
  const outgoing = new Map<string, string[]>(ids.map((id) => [id, []]));
  const incoming = new Map<string, number>(ids.map((id) => [id, 0]));
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!isTableEdge(edge) || !idSet.has(edge.source) || !idSet.has(edge.target)) continue;
    if (edge.source === edge.target) continue;
    const pair = edge.source + "\u0000" + edge.target;
    if (seen.has(pair)) continue;
    seen.add(pair);
    outgoing.get(edge.source)?.push(edge.target);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }
  const remaining = new Set(ids);
  const order: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].toSorted();
    const next = ready.find((id) => (incoming.get(id) ?? 0) === 0) ?? ready[0];
    if (next === undefined) break;
    order.push(next);
    remaining.delete(next);
    for (const target of outgoing.get(next) ?? []) {
      incoming.set(target, Math.max(0, (incoming.get(target) ?? 0) - 1));
    }
  }
  return order;
}

/** Deterministic PRNG so the fuzz comparison is reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("orderTables correctness", () => {
  it("orders a few hundred tables by dependency with lexicographic tie-break", () => {
    // One 300-table chain plus 100 independent tables: the independent ids sort first
    // ("i" < "t"), then the chain unrolls one ready table at a time.
    const chain = Array.from({ length: 300 }, (_, i) => "t" + String(i).padStart(3, "0"));
    const independent = Array.from({ length: 100 }, (_, i) => "i" + String(i).padStart(3, "0"));
    const tables = [...chain, ...independent].map(table);
    const edges = chain.slice(0, -1).map((id, i) => fk(id, chain[i + 1] ?? id));
    const order = orderTables(tables, edges);
    expect(order).toEqual([...independent.toSorted(), ...chain]);
  });

  it("breaks ready-set ties lexicographically, not by input order", () => {
    const tables = ["c", "a", "b", "d"].map(table);
    const order = orderTables(tables, [fk("a", "b")]);
    expect(order).toEqual(["a", "b", "c", "d"]);
  });

  it("falls back to the lexicographically first remaining id inside a cycle", () => {
    const tables = ["a", "b", "c", "d"].map(table);
    const edges = [fk("a", "b"), fk("b", "c"), fk("c", "a")];
    expect(orderTables(tables, edges)).toEqual(["d", "a", "b", "c"]);
  });

  it("ignores self-edges, duplicate edges and edges leaving the column", () => {
    const tables = ["a", "b"].map(table);
    const edges = [
      fk("a", "a"),
      fk("a", "b", "dup-1"),
      fk("a", "b", "dup-2"),
      fk("a", "outside"),
      fk("outside", "b"),
      { id: "rt", kind: "route-table" as const, source: "b", target: "a", label: null },
    ];
    expect(orderTables(tables, edges)).toEqual(["a", "b"]);
  });

  it("matches the historical semantics on 200 randomized graphs (cycles included)", () => {
    const random = mulberry32(186);
    for (let run = 0; run < 200; run += 1) {
      const count = 5 + Math.floor(random() * 56);
      const ids = Array.from({ length: count }, (_, i) => "tbl_" + String(i).padStart(2, "0"));
      const tables = ids.map(table);
      const edges: ProjectGraphEdge[] = [];
      const edgeCount = Math.floor(random() * count * 2);
      for (let e = 0; e < edgeCount; e += 1) {
        const source = ids[Math.floor(random() * count)] ?? "tbl_00";
        const target = ids[Math.floor(random() * count)] ?? "tbl_00";
        const kind: ProjectGraphEdge["kind"] = random() < 0.5 ? "fk" : "relation";
        edges.push({ id: "e" + e, kind, source, target, label: null });
        if (random() < 0.1) edges.push({ id: "e" + e + "_dup", kind, source, target, label: null });
      }
      expect(orderTables(tables, edges), "run " + run).toEqual(referenceOrder(tables, edges));
    }
  });
});

describe("orderTables performance guard", () => {
  it("sorts O(T log T) elements total, never the remaining set per iteration", () => {
    const n = 400;
    const ids = Array.from({ length: n }, (_, i) => "t" + String(i).padStart(4, "0"));
    const tables = ids.map(table);
    // A chain is the worst case for the old re-sort: every iteration re-sorted ~all remaining.
    const edges = ids.slice(0, -1).map((id, i) => fk(id, ids[i + 1] ?? id));
    const original = Array.prototype.toSorted;
    let sortedElements = 0;
    Array.prototype.toSorted = function patched(
      this: unknown[],
      compareFn?: (a: unknown, b: unknown) => number,
    ) {
      sortedElements += this.length;
      return original.call(this, compareFn);
    } as typeof Array.prototype.toSorted;
    try {
      expect(orderTables(tables, edges)).toHaveLength(n);
    } finally {
      Array.prototype.toSorted = original;
    }
    // One initial sort of T ids; the heap never re-sorts. The old implementation sorted
    // ~T^2/2 elements here. Allow a generous O(T log T) bound.
    expect(sortedElements).toBeLessThanOrEqual(2 * n * Math.log2(n) + n);
  });

  it("orders 3000 tables well under a quadratic time bound", () => {
    const n = 3000;
    const ids = Array.from({ length: n }, (_, i) => "t" + String(i).padStart(5, "0"));
    const tables = ids.map(table);
    const edges = ids.slice(0, -1).map((id, i) => fk(id, ids[i + 1] ?? id));
    const start = performance.now();
    const order = orderTables(tables, edges);
    const elapsed = performance.now() - start;
    expect(order).toHaveLength(n);
    expect(order[0]).toBe(ids[0]);
    // The quadratic implementation needs seconds at this size; the linear pass needs ms.
    expect(elapsed).toBeLessThan(1000);
  });
});
