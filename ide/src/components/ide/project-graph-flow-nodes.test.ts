// The node mapping's isolation contract (issue #63): a card recedes to 10% when no isolated
// edge touches it, but its position, selection and identity never change — opacity only.
// The focus-channel composition (issue #66) lives in project-graph-flow-focus.test.ts.
// The data lens (issue #70) composes the same way: marks and roles never move a card (epic
// rule 2), and the lens-role mechanism proves stacking with the contract lens (criterion 5).
import { describe, expect, it } from "vitest";
import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import type { ProjectGraphEdge } from "@/facilis/graph-types";
import { reachabilityClosure } from "@/facilis/graph-reachability";
import { fkNeighbourhood } from "@/facilis/graph-data-lens";
import { buildProjectGraphFlowNodes, type ProjectFlowDataState } from "./project-graph-flow-nodes";
import type { ProjectAnalysisFlowNode } from "./ProjectGraphNodes";

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
// ── data lens composition (issue #70, epic #56 rules 2-3) ─────────────────────────────────

const routeNode: ProjectGraphNode = {
  id: "r",
  kind: "route",
  label: "GET /api/a",
  sourceFile: null,
  position: { x: 300, y: 10 },
  data: {
    kind: "route",
    method: "GET",
    path: "/api/a",
    permission: [],
    wrapper: "valid",
    description: null,
    input: { body: false, form: false, query: false, params: false },
    pathParams: [],
    dbTables: ["a"],
    elevations: [],
    unknown: false,
  },
  matched: true,
  collapsed: false,
};

// The route writes a: it is in a's FULL closure but outside the FK neighbourhood, so the
// data-lens highlight is strictly stricter than #66's default — and still opacity only.
const dataView: ProjectGraphView = {
  nodes: [...view.nodes, routeNode],
  edges: [...view.edges, edge("e3", "route-table", "r", "a")],
  stats: { ...view.stats, routes: 1, edges: 3 },
};

const buildData = (
  data: ProjectFlowDataState | undefined,
  userFocus = null as ReturnType<typeof fkNeighbourhood>,
  isolatedEdgeKinds: readonly ProjectGraphEdge["kind"][] = [],
) =>
  buildProjectGraphFlowNodes({
    view: dataView,
    notes: [{ id: "note-1", x: 5, y: 5, text: "hello" }],
    previous: [],
    selectedNodeId: "a",
    focus: null,
    userFocus,
    isolatedEdgeKinds,
    data,
    onToggleCollapse: () => {},
    onEditNote: () => {},
    onDeleteNote: () => {},
  });

const cardsOf = (nodes: ReturnType<typeof buildData>): ProjectAnalysisFlowNode[] =>
  nodes.filter((entry): entry is ProjectAnalysisFlowNode => entry.id !== "note-1");

const positionsOf = (nodes: ReturnType<typeof buildData>) =>
  nodes.map((entry) => entry.id + "@" + entry.position.x + "," + entry.position.y).toSorted();

describe("buildProjectGraphFlowNodes data lens", () => {
  it("carries no data role when the lens is inactive or absent", () => {
    for (const entry of cardsOf(buildData(undefined))) {
      expect(entry.data.dataRole).toBeNull();
      expect(entry.data.compactData).toBe(false);
    }
    for (const entry of cardsOf(buildData({ activeLenses: ["contract"], compactData: true }))) {
      expect(entry.data.dataRole).toBeNull();
    }
  });

  it("assigns the dominant and secondary roles through the shared lens mechanism", () => {
    const dominant = buildData({ activeLenses: ["data", "contract"], compactData: false });
    for (const entry of cardsOf(dominant)) expect(entry.data.dataRole).toBe("dominant");
    const secondary = buildData({ activeLenses: ["contract", "data"], compactData: true });
    for (const entry of cardsOf(secondary)) {
      expect(entry.data.dataRole).toBe("secondary");
      expect(entry.data.compactData).toBe(true);
    }
  });

  it("keeps the data marks off the notes: annotations are not schema subjects", () => {
    const note = buildData({ activeLenses: ["data"], compactData: false }).find(
      (entry) => entry.id === "note-1",
    );
    expect(note?.data).not.toHaveProperty("dataRole");
  });

  it("dims the FK neighbourhood's outsiders without removing cards or moving positions", () => {
    const fkFocus = fkNeighbourhood(dataView, "a");
    // The route is in the full closure but not in the FK mesh: the lens highlight is stricter.
    const full = reachabilityClosure(dataView, "a");
    expect(full?.nodeIds).toContain("r");
    expect(fkFocus?.nodeIds).not.toContain("r");

    const baseline = buildData(undefined);
    const highlighted = buildData({ activeLenses: ["data"], compactData: false }, fkFocus);
    const byId = new Map(highlighted.map((entry) => [entry.id, entry]));
    expect(byId.get("a")?.data.focused).toBe(true);
    expect(byId.get("b")?.data.focused).toBe(true);
    expect(byId.get("c")?.data.focused).toBe(true);
    expect(byId.get("r")?.data.focused).toBe(false);
    // Dimming only: every card survives, at its exact baseline position, selection intact.
    expect(highlighted).toHaveLength(baseline.length);
    expect(positionsOf(highlighted)).toEqual(positionsOf(baseline));
    expect(byId.get("a")?.selected).toBe(true);
  });

  it("holds positions under data lens + edge isolation + lens stacking (criterion 5)", () => {
    const baseline = buildData(undefined);
    const fkFocus = fkNeighbourhood(dataView, "a");
    const composed = buildData({ activeLenses: ["contract", "data"], compactData: true }, fkFocus, [
      "fk",
    ]);
    expect(positionsOf(composed)).toEqual(positionsOf(baseline));
    expect(composed).toHaveLength(baseline.length);
    // Isolation still dims independently: c touches no fk edge, the route neither.
    const byId = new Map(composed.map((entry) => [entry.id, entry]));
    expect(byId.get("c")?.data.isolated).toBe(true);
    expect(byId.get("r")?.data.isolated).toBe(true);
    expect(byId.get("a")?.data.isolated).toBe(false);
    // The data lens is secondary while contract dominates; both flags coexist on one card.
    expect(cardsOf(composed).find((entry) => entry.id === "a")?.data.dataRole).toBe("secondary");
  });
});
