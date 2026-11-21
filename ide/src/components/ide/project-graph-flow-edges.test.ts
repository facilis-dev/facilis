// The edge mapping's dimming contract (issue #63): isolation is a data flag, never a removal,
// so the canvas cannot move a node or change the bounds when a chip isolates a kind. The user
// focus (issue #66) and the AI outline are independent channels the edge composes with it.
import { describe, expect, it } from "vitest";
import type { GraphEdge } from "@facilis.dev/analyze";
import { buildProjectGraphView } from "@/facilis/graph-model";
import { GET, PROJECTS, TODOS, graphOf } from "@/facilis/graph-model.test-fixtures";
import { buildProjectGraphFlowEdges } from "./project-graph-flow-edges";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

const EDGES: GraphEdge[] = [
  { id: "e1", kind: "fk", source: TODOS.id, target: PROJECTS.id, label: null },
  { id: "e2", kind: "relation", source: PROJECTS.id, target: TODOS.id, label: null },
  { id: "e3", kind: "route-table", source: GET.id, target: TODOS.id, label: null },
];

const view = buildProjectGraphView({ graph: graphOf([GET, TODOS, PROJECTS], EDGES) });

const build = (
  isolatedEdgeKinds: readonly ("fk" | "relation" | "route-table")[],
  focus: ProjectGraphFocusState | null = null,
) =>
  buildProjectGraphFlowEdges({
    view,
    edgeCurves: {},
    selectedEdgeId: null,
    focus,
    userFocus: null,
    isolatedEdgeKinds,
    onEdgeCurveChange: () => {},
  });

describe("buildProjectGraphFlowEdges", () => {
  it("keeps every edge bright without isolation or focus", () => {
    const edges = build([]);
    expect(edges).toHaveLength(3);
    for (const edge of edges) {
      expect(edge.data?.dimmed).toBeUndefined();
      expect(edge.data?.userDimmed).toBeUndefined();
      expect(edge.data?.aiOutlined).toBeUndefined();
    }
  });

  it("dims every other kind to a flag but never removes an edge", () => {
    const edges = build(["fk"]);
    expect(edges).toHaveLength(3);
    expect(edges.map((edge) => edge.data?.dimmed)).toEqual([false, true, true]);
  });

  it("dims nothing when every kind is isolated", () => {
    const edges = build(["fk", "relation", "route-table"]);
    expect(edges.every((edge) => edge.data?.dimmed === false)).toBe(true);
  });

  it("keeps the AI outline flag independent of isolation", () => {
    const focus: ProjectGraphFocusState = {
      nodeIds: new Set([TODOS.id]),
      edgeIds: new Set(["e2"]),
      zoom: false,
    };
    const edges = build(["fk"], focus);
    expect(edges.map((edge) => edge.data?.aiOutlined)).toEqual([false, true, false]);
    expect(edges.map((edge) => edge.data?.dimmed)).toEqual([false, true, true]);
  });

  it("never moves an edge's endpoints when isolation toggles (spatial constancy)", () => {
    const plain = build([]);
    const isolated = build(["fk"]);
    expect(isolated.map((edge) => [edge.source, edge.target])).toEqual(
      plain.map((edge) => [edge.source, edge.target]),
    );
  });

  it("marks the selected edge and keeps the kind's marker colour", () => {
    const edges = buildProjectGraphFlowEdges({
      view,
      edgeCurves: {},
      selectedEdgeId: "e1",
      focus: null,
      userFocus: null,
      isolatedEdgeKinds: [],
      onEdgeCurveChange: () => {},
    });
    expect(edges[0]?.selected).toBe(true);
    expect(edges[0]?.markerEnd).toMatchObject({ color: "var(--brand)" });
  });
});
