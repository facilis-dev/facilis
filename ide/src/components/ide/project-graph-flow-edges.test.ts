// The edge mapping's dimming contract (issue #63): isolation is a data flag, never a removal,
// so the canvas cannot move a node or change the bounds when a chip isolates a kind.
import { describe, expect, it } from "vitest";
import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import type { ProjectGraphEdge } from "@/facilis/graph-types";
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
// ── data lens composition (issue #70): stroke data, never a removal ──────────────────────

describe("buildProjectGraphFlowEdges data lens", () => {
  const buildWith = (data?: {
    activeLenses: readonly ("contract" | "data")[];
    compactData: boolean;
  }) =>
    buildProjectGraphFlowEdges({
      view,
      edgeCurves: {},
      selectedEdgeId: null,
      focus: null,
      userFocus: null,
      isolatedEdgeKinds: [],
      data,
      onEdgeCurveChange: () => {},
    });

  it("carries no data role when the lens is inactive or absent", () => {
    for (const edge of buildWith()) expect(edge.data?.dataRole).toBeUndefined();
    for (const edge of buildWith({ activeLenses: ["contract"], compactData: false })) {
      expect(edge.data?.dataRole).toBeUndefined();
    }
  });

  it("stamps the lens role and LOD on every edge without changing identity or endpoints", () => {
    const baseline = buildWith();
    const edges = buildWith({ activeLenses: ["contract", "data"], compactData: true });
    expect(edges).toHaveLength(baseline.length);
    expect(edges.map((edge) => edge.id)).toEqual(baseline.map((edge) => edge.id));
    expect(edges.map((edge) => [edge.source, edge.target])).toEqual(
      baseline.map((edge) => [edge.source, edge.target]),
    );
    for (const edge of edges) {
      expect(edge.data?.dataRole).toBe("secondary");
      expect(edge.data?.compactData).toBe(true);
    }
    const dominant = buildWith({ activeLenses: ["data"], compactData: false });
    for (const edge of dominant) {
      expect(edge.data?.dataRole).toBe("dominant");
      expect(edge.data?.compactData).toBe(false);
    }
  });

  it("composes with isolation: both flags ride the same edge", () => {
    const edges = buildProjectGraphFlowEdges({
      view,
      edgeCurves: {},
      selectedEdgeId: null,
      focus: null,
      userFocus: null,
      isolatedEdgeKinds: ["fk"],
      data: { activeLenses: ["data"], compactData: false },
      onEdgeCurveChange: () => {},
    });
    expect(edges.map((edge) => edge.data?.dimmed)).toEqual([false, true, true]);
    expect(edges.every((edge) => edge.data?.dataRole === "dominant")).toBe(true);
  });
});
