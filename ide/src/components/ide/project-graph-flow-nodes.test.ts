// The chip's edge count is derived from the visible view (issue #60, epic rule 5): each edge
// counts once per endpoint and a self-loop once; an unconnected node reads zero, never a guess.
import { describe, expect, it } from "vitest";
import type { GraphEdge } from "@facilis.dev/analyze";
import { buildProjectGraphView } from "@/facilis/graph-model";
import { GET, PAGE, TODOS, WORKFLOW, graphOf } from "@/facilis/graph-model.test-fixtures";
import { DETAILS_NODE_TYPE } from "./ProjectGraphDetailsNode";
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
