// The node mapping's isolation contract (issue #63): a card recedes to 10% when no isolated
// edge touches it, but its position, selection and identity never change — opacity only.
import { describe, expect, it } from "vitest";
import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import type { ProjectGraphEdge } from "@/facilis/graph-types";
import { INACTIVE_TURN_DIFF, type GraphTurnDiff } from "@/facilis/graph-turn-diff";
import { buildProjectGraphFlowNodes } from "./project-graph-flow-nodes";
import { NOTE_NODE_TYPE } from "./ProjectGraphNote";
import type { ProjectAnalysisFlowNode, ProjectFlowNode } from "./ProjectGraphNodes";
import { TURN_NODE_TYPE, type ProjectTurnFlowNode } from "./ProjectGraphTurnNode";

const node = (id: string, x: number): ProjectGraphNode => ({
  id,
  kind: "table",
  label: id,
  sourceFile: null,
  position: { x, y: 10 },
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
});

const edge = (
  id: string,
  kind: ProjectGraphEdge["kind"],
  source: string,
  target: string,
): ProjectGraphEdge => ({
  id,
  kind,
  source,
  target,
  label: null,
});

const view: ProjectGraphView = {
  nodes: [node("a", 0), node("b", 100), node("c", 200)],
  edges: [edge("e1", "fk", "a", "b"), edge("e2", "relation", "b", "c")],
  stats: {
    pages: 0,
    routes: 0,
    tables: 3,
    views: 0,
    workflows: 0,
    edges: 2,
    hiddenEdges: 0,
    hiddenNodes: 0,
    matches: 3,
    unknownNodes: 0,
    pageLinks: 0,
    elevatedEdges: 0,
  },
};

const build = (isolatedEdgeKinds: readonly ("fk" | "relation")[]) =>
  buildProjectGraphFlowNodes({
    view,
    notes: [{ id: "note-1", x: 5, y: 5, text: "hello" }],
    previous: [],
    selectedNodeId: "c",
    focus: null,
    isolatedEdgeKinds,
    onToggleCollapse: () => {},
    onEditNote: () => {},
    onDeleteNote: () => {},
  });

describe("buildProjectGraphFlowNodes isolation", () => {
  it("marks nothing isolated when no kind is isolated", () => {
    const nodes = build([]);
    expect(nodes.every((node) => node.data.isolated === false)).toBe(true);
  });

  it("dims only the cards no isolated edge touches, keeping positions and selection", () => {
    const nodes = build(["fk"]);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    expect(byId.get("a")?.data.isolated).toBe(false);
    expect(byId.get("b")?.data.isolated).toBe(false);
    expect(byId.get("c")?.data.isolated).toBe(true);
    // Opacity only: positions and selection survive the isolation untouched.
    expect(byId.get("c")?.position).toEqual({ x: 200, y: 10 });
    expect(byId.get("c")?.selected).toBe(true);
    expect(nodes).toHaveLength(4);
  });

  it("recedes notes with the graph while isolation is active", () => {
    expect(build(["fk"]).find((node) => node.id === "note-1")?.data.isolated).toBe(true);
    expect(build([]).find((node) => node.id === "note-1")?.data.isolated).toBe(false);
  });

  it("keeps every analysis card bright when all kinds are isolated; notes still recede", () => {
    const nodes = build(["fk", "relation"]);
    const cards = nodes.filter((node) => node.id !== "note-1");
    expect(cards.every((node) => node.data.isolated === false)).toBe(true);
    expect(nodes.find((node) => node.id === "note-1")?.data.isolated).toBe(true);
  });
});

// The turn-diff overlay (issue #73): chrome and tombstones are data here, and a lens never
// moves a live node (epic rule 2). An absent/inactive diff must render exactly as without it.
// Stable callbacks: two builds must compare equal when the lens adds nothing.
const noop = () => {};
const buildTurn = (turnDiff: GraphTurnDiff | null, turnSecondary = false) =>
  buildProjectGraphFlowNodes({
    view,
    notes: [],
    previous: [],
    selectedNodeId: null,
    focus: null,
    isolatedEdgeKinds: [],
    turn: turnDiff === null ? null : { diff: turnDiff, secondary: turnSecondary },
    onToggleCollapse: noop,
    onEditNote: noop,
    onDeleteNote: noop,
  });

const TURN: GraphTurnDiff = {
  ...INACTIVE_TURN_DIFF,
  active: true,
  nodeKinds: new Map([
    ["a", "modified"],
    ["b", "added"],
  ]),
  tombstones: [node("c", 200)],
  tombstoneIds: new Set(["c"]),
};

function cardOf(nodes: readonly ProjectFlowNode[], id: string): ProjectAnalysisFlowNode {
  const found = nodes.find((node) => node.id === id);
  if (found === undefined || found.type === TURN_NODE_TYPE || found.type === NOTE_NODE_TYPE) {
    throw new Error("expected an analysis card: " + id);
  }
  return found;
}

function turnOf(nodes: readonly ProjectFlowNode[], id: string): ProjectTurnFlowNode {
  const found = nodes.find((node) => node.id === id);
  if (found === undefined || found.type !== TURN_NODE_TYPE) {
    throw new Error("expected a turn-diff card: " + id);
  }
  return found;
}

describe("buildProjectGraphFlowNodes turn-diff", () => {
  it("renders exactly as without the lens when the diff is absent or inactive", () => {
    const plain = buildTurn(null);
    expect(buildTurn(INACTIVE_TURN_DIFF)).toEqual(plain);
    expect(plain.every((node) => node.type !== TURN_NODE_TYPE)).toBe(true);
    for (const id of ["a", "b", "c"]) {
      expect(cardOf(plain, id).data.turn).toBeNull();
    }
  });

  it("badges changed and added cards and tombstones the stale deleted card in place", () => {
    const nodes = buildTurn(TURN);
    expect(cardOf(nodes, "a").data.turn).toEqual({ kind: "modified", secondary: false });
    expect(cardOf(nodes, "b").data.turn).toEqual({ kind: "added", secondary: false });
    const tombstone = turnOf(nodes, "c");
    // Same id, same position: the hole is visible without re-layout or a duplicate card.
    expect(tombstone.position).toEqual({ x: 200, y: 10 });
    expect(tombstone.draggable).toBe(false);
    expect(tombstone.selectable).toBe(false);
    expect(nodes.filter((node) => node.id === "c")).toHaveLength(1);
    expect(cardOf(nodes, "a").position).toEqual({ x: 0, y: 10 });
    expect(cardOf(nodes, "b").position).toEqual({ x: 100, y: 10 });
  });

  it("appends a base-only tombstone at its last-known position, moving nothing", () => {
    const diff: GraphTurnDiff = {
      ...INACTIVE_TURN_DIFF,
      active: true,
      tombstones: [node("gone", 500)],
      tombstoneIds: new Set(["gone"]),
    };
    const nodes = buildTurn(diff);
    expect(turnOf(nodes, "gone").position).toEqual({ x: 500, y: 10 });
    expect(cardOf(nodes, "a").position).toEqual({ x: 0, y: 10 });
  });

  it("fades the chrome when the lens is secondary (epic rule 3)", () => {
    const nodes = buildTurn(TURN, true);
    expect(cardOf(nodes, "a").data.turn).toEqual({ kind: "modified", secondary: true });
    expect(turnOf(nodes, "c").data.secondary).toBe(true);
  });

  it("parks phase-2 ghosts below the graph and never invents them without a plan", () => {
    const without = buildTurn(TURN);
    expect(without.some((node) => node.id.startsWith("turn-ghost:"))).toBe(false);
    const diff: GraphTurnDiff = { ...TURN, ghosts: [{ path: "src/pages/planned.tsx" }] };
    const ghost = turnOf(buildTurn(diff), "turn-ghost:src/pages/planned.tsx");
    expect(ghost.position.y).toBeGreaterThan(10);
    expect(ghost.data.turnKind).toBe("planned");
  });
});
