// Issue #62 layout acceptance: frames contain their members, the clustered layout is
// deterministic, saved pins grow their frame, and the clustered build stays under the 100 ms
// budget (the median of five runs, like the flat benchmark in graph-layout-engine.test.ts).

import { describe, expect, it } from "vitest";
import type { ProjectGraph } from "@facilis.dev/analyze";
import { buildProjectGraphView } from "./graph-model";
import { GRAPH_CARD_SIZES } from "./graph-layout-engine";
import { GRAPH_FRAME_HEADER, GRAPH_FRAME_PAD } from "./graph-cluster-layout";
import { exampleProjectGraph, largeProjectGraph } from "./graph-layout.test-fixtures";

const enabled = { enabled: true, collapsed: [] as string[] };

/** The 89-node benchmark spread over six feature directories instead of one flat api/ tree. */
function clusteredBenchmarkGraph(): ProjectGraph {
  const graph = largeProjectGraph();
  let route = 0;
  const nodes = graph.nodes.map((node) => {
    if (node.kind !== "route") return node;
    const feature = "f" + String(route % 6);
    route += 1;
    return { ...node, sourceFile: "server/routes/api/" + feature + "/r" + String(route) + ".ts" };
  });
  return { nodes, edges: graph.edges };
}

describe("clustered layout", () => {
  it("every member card sits inside its frame, header and padding included", () => {
    const view = buildProjectGraphView({ graph: exampleProjectGraph(), clusters: enabled });
    expect(view.clusters.length).toBeGreaterThan(1);
    for (const cluster of view.clusters) {
      if (cluster.collapsed) continue;
      for (const id of cluster.nodeIds) {
        const node = view.nodes.find((entry) => entry.id === id);
        expect(node).toBeDefined();
        if (node === undefined) continue;
        const size = GRAPH_CARD_SIZES[node.kind];
        expect(node.position.x).toBeGreaterThanOrEqual(cluster.position.x + GRAPH_FRAME_PAD);
        expect(node.position.y).toBeGreaterThanOrEqual(cluster.position.y + GRAPH_FRAME_HEADER);
        expect(node.position.x + size.width).toBeLessThanOrEqual(
          cluster.position.x + cluster.size.width - GRAPH_FRAME_PAD + 1e-9,
        );
        expect(node.position.y + size.height).toBeLessThanOrEqual(
          cluster.position.y + cluster.size.height - GRAPH_FRAME_PAD + 1e-9,
        );
      }
    }
  });

  it("auto frames never overlap and the derivation is deterministic", () => {
    const graph = exampleProjectGraph();
    const first = buildProjectGraphView({ graph, clusters: enabled });
    const second = buildProjectGraphView({ graph, clusters: enabled });
    expect(second).toEqual(first);
    const frames = first.clusters;
    for (let i = 0; i < frames.length; i += 1) {
      for (let j = i + 1; j < frames.length; j += 1) {
        const a = frames[i];
        const b = frames[j];
        if (a === undefined || b === undefined) continue;
        const apart =
          a.position.x + a.size.width <= b.position.x ||
          b.position.x + b.size.width <= a.position.x ||
          a.position.y + a.size.height <= b.position.y ||
          b.position.y + b.size.height <= a.position.y;
        expect(apart).toBe(true);
      }
    }
  });

  it("a saved pin outside the auto box grows its frame to keep the child inside", () => {
    const graph = exampleProjectGraph();
    const base = buildProjectGraphView({ graph, clusters: enabled });
    const cluster = base.clusters.find((entry) => entry.nodeIds.length > 0);
    const memberId = cluster?.nodeIds[0];
    expect(memberId).toBeDefined();
    if (cluster === undefined || memberId === undefined) return;
    const pin = { x: cluster.position.x + cluster.size.width + 500, y: cluster.position.y + 20 };
    const pinned = buildProjectGraphView({ graph, clusters: enabled, positions: { [memberId]: pin } });
    const grown = pinned.clusters.find((entry) => entry.id === cluster.id);
    const node = pinned.nodes.find((entry) => entry.id === memberId);
    expect(node?.position).toEqual(pin);
    expect(grown).toBeDefined();
    if (grown === undefined || node === undefined) return;
    expect(node.position.x + GRAPH_CARD_SIZES[node.kind].width).toBeLessThanOrEqual(
      grown.position.x + grown.size.width,
    );
  });

  it("lays the 89-node benchmark out with clusters in under 100 ms (median of 5)", () => {
    const graph = clusteredBenchmarkGraph();
    const runs: number[] = [];
    let nodeCount = 0;
    for (let i = 0; i < 5; i += 1) {
      const started = performance.now();
      const view = buildProjectGraphView({ graph, clusters: enabled });
      runs.push(performance.now() - started);
      nodeCount = view.nodes.length;
    }
    const median = runs.toSorted((a, b) => a - b)[2] ?? Number.POSITIVE_INFINITY;
    expect(nodeCount).toBe(89);
    expect(median).toBeLessThan(100);
  });

  it("a half-collapsed benchmark stays under the same budget", () => {
    const graph = clusteredBenchmarkGraph();
    const all = buildProjectGraphView({ graph, clusters: enabled });
    const half = all.clusters.filter((_unused, index) => index % 2 === 0).map((c) => c.id);
    const runs: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const started = performance.now();
      buildProjectGraphView({ graph, clusters: { enabled: true, collapsed: half } });
      runs.push(performance.now() - started);
    }
    expect(runs.toSorted((a, b) => a - b)[2] ?? Number.POSITIVE_INFINITY).toBeLessThan(100);
  });
});
