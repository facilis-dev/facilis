// The node mapping's isolation contract (issue #63): a card recedes to 10% when no isolated
// edge touches it, but its position, selection and identity never change — opacity only.
// The focus-channel composition (issue #66) lives in project-graph-flow-focus.test.ts.
import { describe, expect, it } from "vitest";
import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import type { ProjectGraphEdge } from "@/facilis/graph-types";
import type { ImpactOverlay } from "@/facilis/graph-impact";
import { buildProjectGraphFlowNodes } from "./project-graph-flow-nodes";

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
    userFocus: null,
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

describe("buildProjectGraphFlowNodes impact simulation (issue #74)", () => {
  const overlay = {
    targetId: "a",
    keepNodeIds: new Set(["a", "b"]),
    brokenEdgeIds: new Set(["e1"]),
    neverReadTableIds: new Set(["c"]),
  };
  const withImpact = (impact: ImpactOverlay | null) =>
    buildProjectGraphFlowNodes({
      view,
      notes: [{ id: "note-1", x: 5, y: 5, text: "hello" }],
      previous: [],
      selectedNodeId: "a",
      focus: null,
      userFocus: null,
      isolatedEdgeKinds: [],
      impact,
      onToggleCollapse: () => {},
      onEditNote: () => {},
      onDeleteNote: () => {},
    });

  it("badges the target, keeps dependents bright and dims the rest — positions untouched", () => {
    const nodes = withImpact(overlay);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    expect(byId.get("a")?.data).toMatchObject({ impactTarget: true, impactDimmed: false });
    expect(byId.get("b")?.data).toMatchObject({ impactTarget: false, impactDimmed: false });
    expect(byId.get("c")?.data).toMatchObject({ impactDimmed: true, neverRead: true });
    // Spatial constancy (epic rule 2): the overlay never moves or removes a card.
    expect(nodes).toHaveLength(4);
    expect(byId.get("c")?.position).toEqual({ x: 200, y: 10 });
    expect(byId.get("a")?.selected).toBe(true);
    const note = byId.get("note-1");
    if (note === undefined || "node" in note.data) throw new Error("note card missing");
    expect(note.data.impactDimmed).toBe(true);
  });

  it("without a target only badges never-read tables: nothing dims against a ghost", () => {
    const nodes = withImpact({ ...overlay, targetId: null, keepNodeIds: new Set<string>() });
    const cards = nodes.filter((node) => node.id !== "note-1");
    expect(cards.every((node) => node.data.impactDimmed === false)).toBe(true);
    const c = nodes.find((node) => node.id === "c");
    if (c === undefined || !("node" in c.data)) throw new Error("table card missing");
    expect(c.data.neverRead).toBe(true);
  });

  it("restores the exact pre-simulation rendering inputs when the lens exits (criterion 5)", () => {
    // Stable callbacks: two builds must differ only in the overlay, not in function identity.
    const noop = () => {};
    const base = {
      view,
      notes: [{ id: "note-1", x: 5, y: 5, text: "hello" }],
      previous: [],
      selectedNodeId: "c",
      focus: null,
      userFocus: null,
      onToggleCollapse: noop,
      onEditNote: noop,
      onDeleteNote: noop,
    };
    const before = buildProjectGraphFlowNodes({ ...base, isolatedEdgeKinds: [] });
    buildProjectGraphFlowNodes({ ...base, isolatedEdgeKinds: [], impact: overlay });
    expect(buildProjectGraphFlowNodes({ ...base, isolatedEdgeKinds: [] })).toEqual(before);
    // The overlay composes with the other dimming channels without mutating them: removing it
    // returns the identical isolation-only picture, byte for byte.
    const isolatedBefore = buildProjectGraphFlowNodes({ ...base, isolatedEdgeKinds: ["fk"] });
    const isolatedDuring = buildProjectGraphFlowNodes({
      ...base,
      isolatedEdgeKinds: ["fk"],
      impact: overlay,
    });
    expect(isolatedDuring).not.toEqual(isolatedBefore);
    expect(
      buildProjectGraphFlowNodes({ ...base, isolatedEdgeKinds: ["fk"], impact: null }),
    ).toEqual(isolatedBefore);
  });
});
