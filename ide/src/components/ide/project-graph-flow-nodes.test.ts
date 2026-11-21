// The chip's edge count is derived from the visible view (issue #60, epic rule 5): each edge
// counts once per endpoint and a self-loop once; an unconnected node reads zero, never a guess.
// Edge-kind isolation (issue #63) is opacity only: cards no isolated edge touches recede to 10%,
// notes always recede, and positions/selection never move (epic rule 2).
// The focus-channel composition (issue #66) lives in project-graph-flow-focus.test.ts.
import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphEdgeKind } from "@facilis.dev/analyze";
import { buildProjectGraphView } from "@/facilis/graph-model";
import { GET, PAGE, TODOS, WORKFLOW, graphOf } from "@/facilis/graph-model.test-fixtures";
import { DETAILS_NODE_TYPE } from "./ProjectGraphDetailsNode";
import type { ProjectFlowNode } from "./ProjectGraphNodes";
import { buildProjectGraphFlowNodes } from "./project-graph-flow-nodes";

const EDGES: GraphEdge[] = [
  { id: "page-route:1", kind: "page-route", source: PAGE.id, target: GET.id, label: null },
  { id: "route-table:1", kind: "route-table", source: GET.id, target: TODOS.id, label: null },
  { id: "fk:self", kind: "fk", source: TODOS.id, target: TODOS.id, label: null },
];

const NOOP = () => {};

function dataOf(id: string) {
  const view = buildProjectGraphView({ graph: graphOf([PAGE, GET, TODOS, WORKFLOW], EDGES) });
  const nodes = buildProjectGraphFlowNodes({
    view,
    notes: [],
    previous: [],
    selectedNodeId: null,
    focus: null,
    userFocus: null,
    isolatedEdgeKinds: [],
    onToggleCollapse: NOOP,
    onEditNote: NOOP,
    onDeleteNote: NOOP,
  });
  const node = nodes.find((entry) => entry.id === id);
  // Notes and the details satellite carry their own data shapes; only analysis cards have counts.
  if (node === undefined || node.type === "note" || node.type === DETAILS_NODE_TYPE)
    throw new Error("missing node " + id);
  return node.data;
}

describe("buildProjectGraphFlowNodes edgeCount", () => {
  it("counts each edge once per endpoint and a self-loop once", () => {
    expect(dataOf(PAGE.id).edgeCount).toBe(1);
    expect(dataOf(GET.id).edgeCount).toBe(2);
    expect(dataOf(TODOS.id).edgeCount).toBe(2);
  });

  it("reads zero for an unconnected node", () => {
    expect(dataOf(WORKFLOW.id).edgeCount).toBe(0);
  });
});

const VIEW = buildProjectGraphView({ graph: graphOf([PAGE, GET, TODOS, WORKFLOW], EDGES) });

function buildNodes(isolatedEdgeKinds: readonly GraphEdgeKind[], selectedNodeId: string | null) {
  return buildProjectGraphFlowNodes({
    view: VIEW,
    notes: [{ id: "note-1", x: 5, y: 5, text: "hello" }],
    previous: [],
    selectedNodeId,
    focus: null,
    userFocus: null,
    isolatedEdgeKinds,
    onToggleCollapse: NOOP,
    onEditNote: NOOP,
    onDeleteNote: NOOP,
  });
}

function cardData(nodes: readonly ProjectFlowNode[], id: string) {
  const node = nodes.find((entry) => entry.id === id);
  if (node === undefined || node.type === DETAILS_NODE_TYPE) throw new Error("missing " + id);
  return node.data;
}

describe("buildProjectGraphFlowNodes isolation", () => {
  it("marks nothing isolated when no kind is isolated", () => {
    const nodes = buildNodes([], null);
    expect(nodes.every((node) => node.type !== DETAILS_NODE_TYPE && node.data.isolated === false)).toBe(true);
  });

  it("dims only the cards no isolated edge touches, keeping positions and selection", () => {
    const nodes = buildNodes(["fk"], WORKFLOW.id);
    // The fk self-loop touches only TODOS; every other card recedes.
    expect(cardData(nodes, TODOS.id).isolated).toBe(false);
    expect(cardData(nodes, PAGE.id).isolated).toBe(true);
    expect(cardData(nodes, GET.id).isolated).toBe(true);
    expect(cardData(nodes, WORKFLOW.id).isolated).toBe(true);
    // Opacity only: positions and selection survive the isolation untouched (epic rule 2).
    const plain = buildNodes([], WORKFLOW.id);
    for (const node of nodes) {
      const before = plain.find((entry) => entry.id === node.id);
      expect(node.position).toEqual(before?.position);
      expect(node.selected).toBe(before?.selected);
    }
    expect(nodes).toHaveLength(5);
  });

  it("recedes notes with the graph while isolation is active", () => {
    expect(cardData(buildNodes(["fk"], null), "note-1").isolated).toBe(true);
    expect(cardData(buildNodes([], null), "note-1").isolated).toBe(false);
  });

  it("keeps every connected card bright when all kinds are isolated; notes still recede", () => {
    const nodes = buildNodes(["page-route", "route-table", "fk"], null);
    expect(cardData(nodes, PAGE.id).isolated).toBe(false);
    expect(cardData(nodes, GET.id).isolated).toBe(false);
    expect(cardData(nodes, TODOS.id).isolated).toBe(false);
    // An unconnected card is touched by no isolated edge, so it still recedes.
    expect(cardData(nodes, WORKFLOW.id).isolated).toBe(true);
    expect(cardData(nodes, "note-1").isolated).toBe(true);
  });
});
