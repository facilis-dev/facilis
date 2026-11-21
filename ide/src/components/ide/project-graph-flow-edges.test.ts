// The edge mapping's dimming contract (issue #63): isolation is a data flag, never a removal,
// so the canvas cannot move a node or change the bounds when a chip isolates a kind.
import { describe, expect, it } from "vitest";
import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import type { ProjectGraphEdge } from "@/facilis/graph-types";
import type { ImpactOverlay } from "@/facilis/graph-impact";
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
    userFocus: null,
    isolatedEdgeKinds,
    onEdgeCurveChange: () => {},
  });

describe("buildProjectGraphFlowEdges", () => {
  it("keeps every edge and adds no dimming without isolation or focus", () => {
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
      nodeIds: new Set(["a"]),
      edgeIds: new Set(["e2"]),
      zoom: false,
    };
    const edges = build(["fk"], focus);
    expect(edges.map((edge) => edge.data?.aiOutlined)).toEqual([false, true, false]);
    expect(edges.map((edge) => edge.data?.dimmed)).toEqual([false, true, true]);
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

describe("buildProjectGraphFlowEdges impact simulation (issue #74)", () => {
  const overlay = {
    targetId: "a",
    keepNodeIds: new Set(["a", "b"]),
    brokenEdgeIds: new Set(["e1"]),
    neverReadTableIds: new Set<string>(),
  };
  const withImpact = (impact: ImpactOverlay | null, isolated: readonly ("fk" | "relation")[] = []) =>
    buildProjectGraphFlowEdges({
      view,
      edgeCurves: {},
      selectedEdgeId: null,
      focus: null,
      userFocus: null,
      isolatedEdgeKinds: isolated,
      impact,
      onEdgeCurveChange: () => {},
    });

  it("marks broken edges for the danger stroke and dims the rest, removing nothing", () => {
    const edges = withImpact(overlay);
    expect(edges).toHaveLength(3);
    expect(edges.map((edge) => edge.data?.impactBroken)).toEqual([true, undefined, undefined]);
    expect(edges.map((edge) => edge.data?.impactDimmed)).toEqual([undefined, true, true]);
    expect(edges[0]?.markerEnd).toMatchObject({ color: "var(--destructive)" });
    expect(edges[1]?.markerEnd).toMatchObject({ color: "var(--info)" });
  });

  it("without a target no edge is broken or dimmed", () => {
    const edges = withImpact({ ...overlay, targetId: null, brokenEdgeIds: new Set<string>() });
    for (const edge of edges) {
      expect(edge.data?.impactBroken).toBeUndefined();
      expect(edge.data?.impactDimmed).toBeUndefined();
    }
  });

  it("composes with isolation: both flags travel, the renderer lets danger win", () => {
    const edges = withImpact(overlay, ["relation"]);
    expect(edges[0]?.data?.dimmed).toBe(true);
    expect(edges[0]?.data?.impactBroken).toBe(true);
    expect(edges[1]?.data?.dimmed).toBe(false);
    expect(edges[1]?.data?.impactDimmed).toBe(true);
  });

  it("restores the exact pre-simulation edge inputs when the lens exits (criterion 5)", () => {
    // Stable callback: two builds must differ only in the overlay, not in function identity.
    const noop = () => {};
    const base = {
      view,
      edgeCurves: {},
      selectedEdgeId: null,
      focus: null,
      userFocus: null,
      onEdgeCurveChange: noop,
    };
    const before = buildProjectGraphFlowEdges({ ...base, isolatedEdgeKinds: [] });
    buildProjectGraphFlowEdges({ ...base, isolatedEdgeKinds: [], impact: overlay });
    expect(buildProjectGraphFlowEdges({ ...base, isolatedEdgeKinds: [] })).toEqual(before);
    const isolatedBefore = buildProjectGraphFlowEdges({ ...base, isolatedEdgeKinds: ["fk"] });
    buildProjectGraphFlowEdges({ ...base, isolatedEdgeKinds: ["fk"], impact: overlay });
    expect(buildProjectGraphFlowEdges({ ...base, isolatedEdgeKinds: ["fk"] })).toEqual(
      isolatedBefore,
    );
  });
});
