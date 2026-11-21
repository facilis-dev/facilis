// The edge mapping's dimming contract (issue #63): isolation is a data flag, never a removal,
// so the canvas cannot move a node or change the bounds when a chip isolates a kind.
import { describe, expect, it } from "vitest";
import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import type { ProjectGraphEdge } from "@/facilis/graph-types";
import { INACTIVE_TURN_DIFF, type GraphTurnDiff } from "@/facilis/graph-turn-diff";
import { buildProjectGraphFlowEdges } from "./project-graph-flow-edges";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

const node = (id: string): ProjectGraphNode => ({
  id,
  kind: "table",
  label: id,
  sourceFile: null,
  position: { x: 0, y: 0 },
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

const edge = (id: string, kind: ProjectGraphEdge["kind"]): ProjectGraphEdge => ({
  id,
  kind,
  source: "a",
  target: "b",
  label: null,
});

const view: ProjectGraphView = {
  nodes: [node("a"), node("b")],
  edges: [edge("e1", "fk"), edge("e2", "relation"), edge("e3", "route-table")],
  stats: {
    pages: 0,
    routes: 0,
    tables: 2,
    views: 0,
    workflows: 0,
    edges: 3,
    hiddenEdges: 0,
    hiddenNodes: 0,
    matches: 2,
    unknownNodes: 0,
    pageLinks: 0,
    elevatedEdges: 0,
  },
};

const build = (
  isolatedEdgeKinds: readonly ("fk" | "relation" | "route-table")[],
  focus: ProjectGraphFocusState | null = null,
) =>
  buildProjectGraphFlowEdges({
    view,
    edgeCurves: {},
    selectedEdgeId: null,
    focus,
    isolatedEdgeKinds,
    onEdgeCurveChange: () => {},
  });

describe("buildProjectGraphFlowEdges", () => {
  it("keeps every edge and adds no dimming without isolation or focus", () => {
    const edges = build([]);
    expect(edges).toHaveLength(3);
    for (const edge of edges) {
      expect(edge.data?.dimmed).toBeUndefined();
      expect(edge.data?.focused).toBeUndefined();
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

  it("keeps the AI focus flag independent of isolation", () => {
    const focus: ProjectGraphFocusState = {
      nodeIds: new Set(["a"]),
      edgeIds: new Set(["e2"]),
      zoom: false,
    };
    const edges = build(["fk"], focus);
    expect(edges.map((edge) => edge.data?.focused)).toEqual([false, true, false]);
    expect(edges.map((edge) => edge.data?.dimmed)).toEqual([false, true, true]);
  });

  it("marks the selected edge and keeps the kind's marker colour", () => {
    const edges = buildProjectGraphFlowEdges({
      view,
      edgeCurves: {},
      selectedEdgeId: "e1",
      focus: null,
      isolatedEdgeKinds: [],
      onEdgeCurveChange: () => {},
    });
    expect(edges[0]?.selected).toBe(true);
    expect(edges[0]?.markerEnd).toMatchObject({ color: "var(--brand)" });
  });
});

// The turn-diff overlay (issue #73): a stroke style, never a removal. Severed base edges stay
// drawn (broken, arrowless, not bendable) so a deletion visibly breaks its connections.
// A stable callback: two builds must compare equal when the lens adds nothing.
const noopCurve = () => {};
const buildTurn = (turnDiff: GraphTurnDiff | null, turnSecondary = false) =>
  buildProjectGraphFlowEdges({
    view,
    edgeCurves: {},
    selectedEdgeId: null,
    focus: null,
    isolatedEdgeKinds: [],
    turn: turnDiff === null ? null : { diff: turnDiff, secondary: turnSecondary },
    onEdgeCurveChange: noopCurve,
  });

const TURN: GraphTurnDiff = {
  ...INACTIVE_TURN_DIFF,
  active: true,
  changedEdgeIds: new Set(["e1"]),
  brokenEdgeIds: new Set(["e2"]),
  severedEdges: [edge("e-old", "fk")],
};

describe("buildProjectGraphFlowEdges turn-diff", () => {
  it("renders exactly as without the lens when the diff is absent or inactive", () => {
    expect(buildTurn(INACTIVE_TURN_DIFF)).toEqual(buildTurn(null));
    expect(buildTurn(null)).toHaveLength(3);
    expect(buildTurn(null).every((edge) => edge.data?.turn === undefined)).toBe(true);
  });

  it("styles changed and broken edges and keeps the severed base edge drawn", () => {
    const edges = buildTurn(TURN);
    expect(edges).toHaveLength(4);
    const byId = new Map(edges.map((edge) => [edge.id, edge]));
    expect(byId.get("e1")?.data?.turn).toBe("changed");
    expect(byId.get("e2")?.data?.turn).toBe("broken");
    // A broken edge points nowhere: no arrowhead.
    expect(byId.get("e2")?.markerEnd).toBeUndefined();
    expect(byId.get("e3")?.data?.turn).toBeUndefined();
    const severed = byId.get("e-old");
    expect(severed?.data?.turn).toBe("broken");
    expect(severed?.selectable).toBe(false);
    expect(severed?.markerEnd).toBeUndefined();
    expect(severed?.data?.curve).toBeNull();
  });

  it("fades only the turn stroke when the lens is secondary (epic rule 3)", () => {
    const edges = buildTurn(TURN, true);
    const byId = new Map(edges.map((edge) => [edge.id, edge]));
    expect(byId.get("e1")?.data?.turnSecondary).toBe(true);
    expect(byId.get("e3")?.data?.turnSecondary).toBeUndefined();
  });
});
