import { describe, expect, it } from "vitest";
import {
  buildCommitGraph,
  GRAPH_LAYOUT,
  type BranchInput,
  type CommitGraphInput,
  type CommitInput,
} from "./commit-graph-model";

const commit = (
  oid: string,
  parents: readonly string[],
  extra: Partial<CommitInput> = {},
): CommitInput => ({
  oid,
  parents,
  message: "msg " + oid,
  author: "Ada",
  timestamp: 0,
  ...extra,
});

function graphOf(
  commits: readonly CommitInput[],
  branches: readonly BranchInput[] = [],
  head: string | null = null,
) {
  return buildCommitGraph({ commits, branches, head });
}

const laneWidth = GRAPH_LAYOUT.nodeWidth + GRAPH_LAYOUT.laneGap;
const rowHeight = GRAPH_LAYOUT.nodeHeight + GRAPH_LAYOUT.rowGap;

describe("buildCommitGraph layout", () => {
  it("keeps a linear history on one lane with a child -> parent edge each", () => {
    const graph = graphOf([commit("c3", ["c2"]), commit("c2", ["c1"]), commit("c1", [])]);
    expect(graph.nodes.map((node) => [node.id, node.data.lane])).toEqual([
      ["c3", 0],
      ["c2", 0],
      ["c1", 0],
    ]);
    expect(graph.nodes.map((node) => node.position)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: rowHeight },
      { x: 0, y: 2 * rowHeight },
    ]);
    expect(graph.edges.map((edge) => [edge.id, edge.source, edge.target])).toEqual([
      ["c3->c2", "c3", "c2"],
      ["c2->c1", "c2", "c1"],
    ]);
    expect(graph.lanes).toBe(1);
    expect(graph.stats).toEqual({ commits: 3, branches: 0, lanes: 1 });
    expect(graph.head).toBeNull();
    expect(graph.headOid).toBeNull();
  });

  it("opens a lane per merge parent and converges them on the shared ancestor", () => {
    const graph = graphOf([
      commit("m", ["a", "b"]),
      commit("a", ["r"]),
      commit("b", ["r"]),
      commit("r", []),
    ]);
    expect(graph.nodes.map((node) => [node.id, node.data.lane])).toEqual([
      ["m", 0],
      ["a", 0],
      ["b", 1],
      ["r", 0],
    ]);
    expect(graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["m", "a"],
      ["m", "b"],
      ["a", "r"],
      ["b", "r"],
    ]);
    expect(graph.lanes).toBe(2);
  });

  it("never gives two commits the same (lane, row) cell", () => {
    const graph = graphOf([
      commit("m", ["a", "b"]),
      commit("a", ["r"]),
      commit("b", ["r"]),
      commit("r", []),
    ]);
    const cells = new Set(graph.nodes.map((node) => node.data.lane + ":" + node.position.y));
    expect(cells.size).toBe(graph.nodes.length);
    for (const node of graph.nodes) {
      expect(node.position).toEqual({
        x: node.data.lane * laneWidth,
        y: graph.nodes.indexOf(node) * rowHeight,
      });
    }
  });

  it("reuses a lane after a branch dies", () => {
    const graph = graphOf([
      commit("m", ["a", "b"]),
      commit("a", ["r"]),
      commit("b", ["r"]),
      commit("x", []),
      commit("r", []),
    ]);
    // b's lane is released when its only parent already waits in a's lane, so the
    // unrelated tip x can take lane 1 instead of opening lane 2.
    expect(graph.nodes.find((node) => node.id === "x")?.data.lane).toBe(1);
    expect(graph.nodes.find((node) => node.id === "r")?.data.lane).toBe(0);
    expect(graph.lanes).toBe(2);
  });
});

describe("buildCommitGraph data", () => {
  it("marks branch tips and the current branch's HEAD", () => {
    const branches: BranchInput[] = [
      { name: "main", oid: "tip" },
      { name: "feature", oid: "base" },
      { name: "ghost", oid: "not-in-the-graph" },
    ];
    const graph = graphOf([commit("tip", ["base"]), commit("base", [])], branches, "main");
    const tip = graph.nodes[0];
    const base = graph.nodes[1];
    expect(tip.data.branches).toEqual(["main"]);
    expect(tip.data.head).toBe(true);
    expect(base.data.branches).toEqual(["feature"]);
    expect(base.data.head).toBe(false);
    expect(graph.head).toBe("main");
    expect(graph.headOid).toBe("tip");
    expect(graph.branches).toEqual(branches);
    expect(graph.branches).not.toBe(branches);
    expect(graph.stats).toEqual({ commits: 2, branches: 3, lanes: 1 });
  });

  it("has no headOid when HEAD is detached or the branch is unknown", () => {
    const detached = graphOf([commit("x", [])], [{ name: "main", oid: "x" }], null);
    expect(detached.head).toBeNull();
    expect(detached.headOid).toBeNull();
    expect(detached.nodes[0].data.head).toBe(false);

    const unknown = graphOf([commit("x", [])], [{ name: "main", oid: "x" }], "gone");
    expect(unknown.headOid).toBeNull();
    expect(unknown.nodes[0].data.head).toBe(false);
  });

  it("derives the short id, the subject line and the author fields", () => {
    const oid = "0123456789abcdef0123456789abcdef01234567";
    const graph = graphOf([
      commit(oid, [], { message: "Subject line\n\nBody text", author: "Ada", timestamp: 1234 }),
    ]);
    const node = graph.nodes[0];
    expect(node.id).toBe(oid);
    expect(node.data.oid).toBe(oid);
    expect(node.data.short).toBe("0123456");
    expect(node.data.message).toBe("Subject line");
    expect(node.data.author).toBe("Ada");
    expect(node.data.timestamp).toBe(1234);
  });

  it("drops the edge of a parent cut off by the read limit but keeps a valid graph", () => {
    const graph = graphOf([commit("c2", ["c1"]), commit("c1", ["gone"])]);
    expect(graph.edges.map((edge) => edge.id)).toEqual(["c2->c1"]);
    expect(graph.nodes[1].data.parents).toEqual(["gone"]);
    const ids = new Set(graph.nodes.map((node) => node.id));
    for (const edge of graph.edges) {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
    }
    expect(graph.lanes).toBe(1);
  });

  it("is deterministic and does not mutate its input", () => {
    const input: CommitGraphInput = {
      commits: [commit("m", ["a", "b"]), commit("a", ["r"]), commit("b", ["r"]), commit("r", [])],
      branches: [{ name: "main", oid: "m" }],
      head: "main",
    };
    expect(buildCommitGraph(input)).toEqual(buildCommitGraph(input));
    expect(input.commits[0].parents).toEqual(["a", "b"]);
    expect(input.commits).toHaveLength(4);
    expect(input.branches).toHaveLength(1);
  });

  it("returns an empty graph for empty input", () => {
    expect(buildCommitGraph({ commits: [], branches: [], head: null })).toEqual({
      nodes: [],
      edges: [],
      branches: [],
      head: null,
      headOid: null,
      lanes: 0,
      stats: { commits: 0, branches: 0, lanes: 0 },
    });
  });
});
