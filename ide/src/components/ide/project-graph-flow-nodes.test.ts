// The node mapping's isolation contract (issue #63): a card recedes to 10% when no isolated
// edge touches it, but its position, selection and identity never change — opacity only.
// The focus-channel composition (issue #66) lives in project-graph-flow-focus.test.ts.
import { describe, expect, it } from "vitest";
import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import type { ProjectGraphEdge } from "@/facilis/graph-types";
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
