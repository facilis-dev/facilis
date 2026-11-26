/**
 * D-217: import cycles over the project's static module graph. A cycle is a strongly
 * connected component of the import/re-export edges (Tarjan), so one diagnostic covers a
 * whole knot of files instead of one per edge. The analyzer never executes the project: the
 * graph resolution it already does for bindings is the only input.
 *
 * Framework sources are merged under `node_modules/` (D-130) and are shipped code, not
 * project code: both their files and the edges that reach them are excluded, so a framework
 * package that re-exports itself never becomes a project warning. Dynamic `import()` and
 * `require()` are not edges here: they are deferred, so they do not create a load-order
 * cycle (the file facts' static imports and re-exports are the edge set).
 */

import type { ModuleGraph } from "./module-graph.ts";
import type { FileFacts, ImportFact, SourceRef } from "./types.ts";

export interface ImportCycle {
  /** Every file in the strongly connected component, sorted by path. */
  readonly files: readonly string[];
  /** A real closed path: the first file repeats at the end. */
  readonly path: readonly string[];
  /** The import (or re-export) edge that opens `path`, used as the diagnostic source. */
  readonly source: SourceRef;
  /** True for a one-file component whose only edge is a self-import. */
  readonly selfImport: boolean;
}

interface Edge {
  readonly to: string;
  readonly source: SourceRef;
}

interface Reference {
  readonly specifier: string;
  readonly source: SourceRef;
}

/** The static reference kinds: dynamic imports and `require` are deferred, not load edges. */
function isStaticImport(entry: ImportFact): boolean {
  return entry.kind !== "dynamic" && entry.kind !== "require";
}

function projectNodes(graph: ModuleGraph): string[] {
  return [...graph.files.keys()]
    .filter((path) => !path.startsWith("node_modules/"))
    .toSorted((left, right) => left.localeCompare(right));
}

/** Static specifiers of a file: imports, side-effect imports and re-exports. */
function references(facts: FileFacts | undefined): Reference[] {
  if (facts === undefined) return [];
  return facts.imports
    .filter(isStaticImport)
    .map((entry) => ({ specifier: entry.specifier, source: entry.source }));
}

function adjacencyOf(
  graph: ModuleGraph,
  fileFacts: ReadonlyMap<string, FileFacts>,
  nodes: readonly string[],
): Map<string, readonly Edge[]> {
  const adjacency = new Map<string, readonly Edge[]>();
  for (const node of nodes) {
    const byTarget = new Map<string, Edge>();
    for (const reference of references(fileFacts.get(node))) {
      const target = graph.resolve(node, reference.specifier);
      if (target === null || target.startsWith("node_modules/")) continue;
      if (!graph.files.has(target) || byTarget.has(target)) continue;
      byTarget.set(target, { to: target, source: reference.source });
    }
    adjacency.set(
      node,
      [...byTarget.values()].toSorted((left, right) => left.to.localeCompare(right.to)),
    );
  }
  return adjacency;
}

interface Frame {
  readonly node: string;
  next: number;
}

/** Tarjan's SCC algorithm, iterative so a long import chain cannot overflow the stack. */
function stronglyConnectedComponents(
  nodes: readonly string[],
  adjacency: ReadonlyMap<string, readonly Edge[]>,
): string[][] {
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let nextIndex = 0;

  const push = (node: string): void => {
    indices.set(node, nextIndex);
    lowlinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);
  };

  for (const root of nodes) {
    if (indices.has(root)) continue;
    const frames: Frame[] = [{ node: root, next: 0 }];
    push(root);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame === undefined) break;
      const edges = adjacency.get(frame.node) ?? [];
      if (frame.next < edges.length) {
        const target = edges[frame.next]?.to;
        frame.next += 1;
        if (target === undefined) continue;
        if (!indices.has(target)) {
          push(target);
          frames.push({ node: target, next: 0 });
        } else if (onStack.has(target)) {
          lowlinks.set(
            frame.node,
            Math.min(lowlinks.get(frame.node) ?? 0, indices.get(target) ?? 0),
          );
        }
        continue;
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent !== undefined) {
        lowlinks.set(
          parent.node,
          Math.min(lowlinks.get(parent.node) ?? 0, lowlinks.get(frame.node) ?? 0),
        );
      }
      if ((lowlinks.get(frame.node) ?? 0) === (indices.get(frame.node) ?? 0)) {
        const component: string[] = [];
        for (;;) {
          const member = stack.pop();
          if (member === undefined) break;
          onStack.delete(member);
          component.push(member);
          if (member === frame.node) break;
        }
        components.push(component);
      }
    }
  }
  return components;
}

/** Shortest cycle from `start` back to itself inside the component (BFS over sorted edges). */
function representativePath(
  start: string,
  members: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, readonly Edge[]>,
): string[] {
  const parent = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current === undefined) continue;
    for (const edge of adjacency.get(current) ?? []) {
      if (!members.has(edge.to)) continue;
      // A self-loop on the start would close a one-file path and hide the rest of the
      // component; the component has another way back, so skip it here.
      if (current === start && edge.to === start) continue;
      if (edge.to === start) {
        const reversed = [current];
        let cursor = parent.get(current) ?? null;
        while (cursor !== null) {
          reversed.push(cursor);
          cursor = parent.get(cursor) ?? null;
        }
        reversed.reverse();
        return [...reversed, start];
      }
      if (!parent.has(edge.to)) {
        parent.set(edge.to, current);
        queue.push(edge.to);
      }
    }
  }
  // A strongly connected component always has a path back; the guard keeps the type honest.
  return [start, start];
}

/** Every import cycle in the project, deterministically ordered by its first path. */
export function findImportCycles(
  graph: ModuleGraph,
  fileFacts: readonly FileFacts[],
): ImportCycle[] {
  const nodes = projectNodes(graph);
  const byPath = new Map(fileFacts.map((facts) => [facts.path, facts]));
  const adjacency = adjacencyOf(graph, byPath, nodes);
  const cycles: ImportCycle[] = [];
  for (const component of stronglyConnectedComponents(nodes, adjacency)) {
    const files = component.toSorted((left, right) => left.localeCompare(right));
    const start = files[0];
    if (start === undefined) continue;
    if (files.length === 1) {
      const self = adjacency.get(start)?.find((edge) => edge.to === start);
      if (self === undefined) continue;
      cycles.push({ files, path: [start, start], source: self.source, selfImport: true });
      continue;
    }
    const path = representativePath(start, new Set(files), adjacency);
    const opening = adjacency.get(start)?.find((edge) => edge.to === path[1]);
    if (opening === undefined) continue;
    cycles.push({ files, path, source: opening.source, selfImport: false });
  }
  return cycles.toSorted((left, right) =>
    (left.files[0] ?? "").localeCompare(right.files[0] ?? ""),
  );
}
