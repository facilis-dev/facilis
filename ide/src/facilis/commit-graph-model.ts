// Pure view model and deterministic lane layout for the commit-graph tab (D-088).
//
// The read layer (ide/src/vv/commit-graph-session.ts) hands raw git data in here; this
// module knows nothing about isomorphic-git or React, so the layout is unit-testable and
// the UI can re-render a cached graph without touching git again.
//
// Lane assignment follows gitk: commits arrive newest-first, each one continues the lane
// already waiting for its oid (so a branch is one straight line), and a merge opens a lane
// per extra parent so parallel lines stay parallel until they meet at their shared parent.

export interface CommitInput {
  oid: string;
  parents: readonly string[];
  message: string;
  author: string;
  timestamp: number;
}

export interface BranchInput {
  name: string;
  oid: string;
}

export interface CommitGraphInput {
  commits: readonly CommitInput[];
  branches: readonly BranchInput[];
  head: string | null;
}

export interface CommitGraphNodeData {
  oid: string;
  short: string;
  message: string;
  author: string;
  timestamp: number;
  parents: string[];
  lane: number;
  branches: string[];
  head: boolean;
}

export interface CommitGraphNode {
  id: string;
  data: CommitGraphNodeData;
  position: { x: number; y: number };
}

export interface CommitGraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface CommitGraph {
  nodes: CommitGraphNode[];
  edges: CommitGraphEdge[];
  branches: BranchInput[];
  head: string | null;
  headOid: string | null;
  lanes: number;
  stats: { commits: number; branches: number; lanes: number };
}

/**
 * Sizes the canvas uses, in CSS pixels. Positions are derived from these instead of being
 * hard-coded per node, so the UI can change the look by drawing with the same values.
 */
export const GRAPH_LAYOUT = {
  nodeWidth: 260,
  nodeHeight: 56,
  laneGap: 40,
  rowGap: 24,
} as const;

/** git shows only the subject: a multi-line commit message must stay a single node line. */
function firstLine(message: string): string {
  const end = message.indexOf("\n");
  return end === -1 ? message : message.slice(0, end);
}

/** Edge ids are stable and derived, so React Flow can diff them across refreshes. */
function edgeId(source: string, target: string): string {
  return source + "->" + target;
}

export function buildCommitGraph(input: CommitGraphInput): CommitGraph {
  const present = new Set(input.commits.map((commit) => commit.oid));
  const branchesByOid = new Map<string, string[]>();
  for (const branch of input.branches) {
    const names = branchesByOid.get(branch.oid);
    if (names) names.push(branch.name);
    else branchesByOid.set(branch.oid, [branch.name]);
  }
  const headOid =
    input.head === null
      ? null
      : (input.branches.find((branch) => branch.name === input.head)?.oid ?? null);

  // waiting[lane] is the oid whose row will land in that lane next; null means the lane
  // is free. Lanes are allocated lazily and never with a hole before a later one.
  const waiting: (string | null)[] = [];
  const placed = new Set<string>();
  const nodes: CommitGraphNode[] = [];
  const edges: CommitGraphEdge[] = [];
  const laneWidth = GRAPH_LAYOUT.nodeWidth + GRAPH_LAYOUT.laneGap;
  const rowHeight = GRAPH_LAYOUT.nodeHeight + GRAPH_LAYOUT.rowGap;

  input.commits.forEach((commit, row) => {
    let lane = waiting.indexOf(commit.oid);
    if (lane === -1) {
      lane = waiting.indexOf(null);
      if (lane === -1) {
        lane = waiting.length;
        waiting.push(null);
      }
    }
    // Free the lane before handing it to a parent: a commit whose parents are all
    // already placed (or absent from a truncated read) must not keep it reserved.
    waiting[lane] = null;
    placed.add(commit.oid);

    const branches = branchesByOid.get(commit.oid) ?? [];
    nodes.push({
      id: commit.oid,
      data: {
        oid: commit.oid,
        short: commit.oid.slice(0, 7),
        message: firstLine(commit.message),
        author: commit.author,
        timestamp: commit.timestamp,
        parents: [...commit.parents],
        lane,
        branches,
        head: headOid !== null && commit.oid === headOid,
      },
      position: { x: lane * laneWidth, y: row * rowHeight },
    });

    // One child -> parent edge per parent the graph actually contains. The read limit
    // truncates history, and a missing parent must not produce a dangling edge.
    for (const parent of commit.parents) {
      if (!present.has(parent)) continue;
      edges.push({ id: edgeId(commit.oid, parent), source: commit.oid, target: parent });
    }

    // The first parent keeps this commit's lane; every further parent opens the first
    // free lane unless it is already waiting somewhere (a merge's lines then converge).
    // Parents already placed above (an out-of-order log) are only edges, never lanes —
    // waiting for them would reserve a lane that no later row can ever claim.
    commit.parents.forEach((parent, index) => {
      if (!present.has(parent) || placed.has(parent) || waiting.includes(parent)) return;
      if (index === 0) {
        waiting[lane] = parent;
        return;
      }
      const free = waiting.indexOf(null);
      if (free === -1) waiting.push(parent);
      else waiting[free] = parent;
    });
  });

  // A lane that was opened for a parent still ahead of the read limit has no node yet;
  // counting nodes keeps "lanes" the width the UI actually has to draw.
  let lanes = 0;
  for (const node of nodes) lanes = Math.max(lanes, node.data.lane + 1);

  return {
    nodes,
    edges,
    branches: input.branches.map((branch) => ({ name: branch.name, oid: branch.oid })),
    head: input.head,
    headOid,
    lanes,
    stats: { commits: nodes.length, branches: input.branches.length, lanes },
  };
}
