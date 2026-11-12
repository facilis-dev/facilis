import { describe, expect, it } from "vitest";
import { MAX_HOPS, MAX_PATHS, findGraphPaths, type GraphPathInput } from "./graph-paths";

const input: GraphPathInput = {
  nodeIds: ["table:a", "table:b", "table:c", "table:d"],
  edges: [
    { id: "fk:1", source: "table:a", target: "table:b" },
    { id: "relation:1", source: "table:b", target: "table:c" },
  ],
};

describe("findGraphPaths", () => {
  it("finds the fewest-hop path in either direction (undirected)", () => {
    expect(
      findGraphPaths(input, { from: "table:a", to: "table:c", maxPaths: 5, maxHops: 12 }),
    ).toEqual({
      paths: [{ nodes: ["table:a", "table:b", "table:c"], edges: ["fk:1", "relation:1"] }],
      unknown: [],
    });
    expect(
      findGraphPaths(input, { from: "table:c", to: "table:a", maxPaths: 5, maxHops: 12 }),
    ).toEqual({
      paths: [{ nodes: ["table:c", "table:b", "table:a"], edges: ["relation:1", "fk:1"] }],
      unknown: [],
    });
  });

  it("returns no path when the target is farther than maxHops", () => {
    expect(
      findGraphPaths(input, { from: "table:a", to: "table:c", maxPaths: 5, maxHops: 1 }),
    ).toEqual({ paths: [], unknown: [] });
  });

  it("returns the single-node path when from and to are the same node", () => {
    expect(
      findGraphPaths(input, { from: "table:a", to: "table:a", maxPaths: 5, maxHops: 12 }),
    ).toEqual({ paths: [{ nodes: ["table:a"], edges: [] }], unknown: [] });
  });

  it("reports requested ids that are not in the visible view, sorted", () => {
    expect(
      findGraphPaths(input, { from: "table:z", to: "table:y", maxPaths: 5, maxHops: 12 }),
    ).toEqual({ paths: [], unknown: ["table:y", "table:z"] });
    expect(
      findGraphPaths(input, { from: "table:a", to: "table:y", maxPaths: 5, maxHops: 12 }),
    ).toEqual({ paths: [], unknown: ["table:y"] });
  });

  it("without a target, walks the closest reachable nodes as shortest paths", () => {
    expect(findGraphPaths(input, { from: "table:b", maxPaths: 5, maxHops: 12 })).toEqual({
      paths: [
        { nodes: ["table:b", "table:a"], edges: ["fk:1"] },
        { nodes: ["table:b", "table:c"], edges: ["relation:1"] },
      ],
      unknown: [],
    });
  });

  it("does not include the start node in the target-less walk", () => {
    const result = findGraphPaths(input, { from: "table:a", maxPaths: 5, maxHops: 12 });
    expect(result.paths.map((path) => path.nodes)).toEqual([
      ["table:a", "table:b"],
      ["table:a", "table:b", "table:c"],
    ]);
  });

  it("breaks equal-length paths by sorted ids, deterministically", () => {
    const diamond: GraphPathInput = {
      nodeIds: ["a", "b", "c", "d"],
      edges: [
        { id: "edge:c-d", source: "c", target: "d" },
        { id: "edge:b-d", source: "b", target: "d" },
        { id: "edge:a-c", source: "a", target: "c" },
        { id: "edge:a-b", source: "a", target: "b" },
      ],
    };
    const first = findGraphPaths(diamond, { from: "a", to: "d", maxPaths: 5, maxHops: 12 });
    const second = findGraphPaths(diamond, { from: "a", to: "d", maxPaths: 5, maxHops: 12 });
    expect(first.paths).toEqual([{ nodes: ["a", "b", "d"], edges: ["edge:a-b", "edge:b-d"] }]);
    expect(second).toEqual(first);
  });

  it("caps maxPaths and maxHops instead of trusting the caller", () => {
    const star: GraphPathInput = {
      nodeIds: ["center", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"],
      edges: ["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"].map((id) => ({
        id: "edge:" + id,
        source: "center",
        target: id,
      })),
    };
    const paths = findGraphPaths(star, { from: "center", maxPaths: 99, maxHops: 99 });
    expect(paths.paths).toHaveLength(MAX_PATHS);
    expect(paths.paths[0]?.nodes).toEqual(["center", "n1"]);

    const chainNodes = Array.from({ length: MAX_HOPS + 3 }, (_value, index) => "node:" + index);
    const chain: GraphPathInput = {
      nodeIds: chainNodes,
      edges: chainNodes.slice(1).map((id, index) => ({
        id: "chain:" + index,
        source: chainNodes[index] ?? "",
        target: id,
      })),
    };
    const far = "node:" + String(MAX_HOPS + 2);
    expect(findGraphPaths(chain, { from: "node:0", to: far, maxPaths: 5, maxHops: 99 })).toEqual({
      paths: [],
      unknown: [],
    });
  });

  it("ignores self-loops and edges whose endpoint is filtered out", () => {
    const noisy: GraphPathInput = {
      nodeIds: ["a", "b"],
      edges: [
        { id: "loop", source: "a", target: "a" },
        { id: "dangling", source: "a", target: "hidden" },
        { id: "plain", source: "a", target: "b" },
      ],
    };
    expect(findGraphPaths(noisy, { from: "a", to: "b", maxPaths: 5, maxHops: 12 }).paths).toEqual([
      { nodes: ["a", "b"], edges: ["plain"] },
    ]);
    expect(findGraphPaths(noisy, { from: "a", maxPaths: 5, maxHops: 12 }).paths).toEqual([
      { nodes: ["a", "b"], edges: ["plain"] },
    ]);
  });
});
