// The node mapping's isolation contract (issue #63): a card recedes to 10% when no isolated
// edge touches it, but its position, selection and identity never change — opacity only.
// The contract lens (issue #69) composes the same way: marks, audit dimming and attached
// diagnostics never move a card (epic rule 2).
import { describe, expect, it } from "vitest";
import type { Diagnostic } from "@facilis.dev/analyze";
import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import type { ProjectGraphEdge, RouteGraphData } from "@/facilis/graph-types";
import { NOTE_NODE_TYPE } from "./ProjectGraphNote";
import type { ProjectAnalysisFlowNode, ProjectFlowNode } from "./ProjectGraphNodes";
import {
  buildProjectGraphFlowNodes,
  type ProjectFlowContractState,
} from "./project-graph-flow-nodes";

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
// ── contract lens composition (issue #69, epic #56 rule 2) ─────────────────────────────────

const routeData = (overrides: Partial<RouteGraphData> = {}): RouteGraphData => ({
  kind: "route",
  method: "GET",
  path: "/api/todos",
  permission: ["todos:read"],
  wrapper: "valid",
  description: null,
  input: { body: false, form: false, query: true, params: false },
  pathParams: [],
  dbTables: ["todos"],
  elevations: [],
  unknown: false,
  ...overrides,
});

const routeNode = (
  id: string,
  x: number,
  overrides: Partial<RouteGraphData> = {},
): ProjectGraphNode => ({
  id,
  kind: "route",
  label: id,
  sourceFile: null,
  position: { x, y: 20 },
  data: routeData(overrides),
  matched: true,
  collapsed: false,
});

const unknownTable: ProjectGraphNode = {
  ...node("u", 300),
  data: {
    ...(node("u", 300).data as Extract<ProjectGraphNode["data"], { kind: "table" }>),
    unknown: true,
  },
};

const contractView: ProjectGraphView = {
  nodes: [
    routeNode("r-protected", 0),
    routeNode("r-noinput", 100, {
      permission: [],
      input: { body: false, form: false, query: false, params: false },
    }),
    unknownTable,
    node("t", 400),
  ],
  edges: [edge("e1", "route-table", "r-protected", "t"), edge("e2", "fk", "t", "u")],
  stats: { ...view.stats, routes: 2, tables: 2 },
};

const warning: Diagnostic = {
  code: "route-direct-db",
  severity: "warning",
  message: "direct db",
  source: { file: "server/routes/todos.get.ts", line: 5 },
};

const contract: ProjectFlowContractState = {
  activeLenses: ["contract"],
  auditFilters: ["unknown"],
  nodeDiagnostics: new Map([["r-protected", [warning]]]),
  compactContract: false,
};

const buildContract = (overrides: Partial<Parameters<typeof buildProjectGraphFlowNodes>[0]> = {}) =>
  buildProjectGraphFlowNodes({
    view: contractView,
    notes: [{ id: "note-1", x: 5, y: 5, text: "hello" }],
    previous: [],
    selectedNodeId: "r-protected",
    focus: null,
    isolatedEdgeKinds: ["route-table"],
    contract,
    onToggleCollapse: () => {},
    onEditNote: () => {},
    onDeleteNote: () => {},
    ...overrides,
  });

/** The analysis cards only: notes carry a different data shape (no contract fields). */
const cardsOf = (nodes: readonly ProjectFlowNode[]) =>
  nodes.filter((entry): entry is ProjectAnalysisFlowNode => entry.type !== NOTE_NODE_TYPE);

const cardById = (nodes: readonly ProjectFlowNode[]) =>
  new Map(cardsOf(nodes).map((entry) => [entry.id, entry]));

describe("buildProjectGraphFlowNodes contract lens composition", () => {
  it("leaves positions, selection and identity unchanged when lens, isolation and audit stack", () => {
    const base = buildContract({ isolatedEdgeKinds: [], contract: undefined });
    const stacked = buildContract();
    expect(stacked.map((entry) => [entry.id, entry.position, entry.selected])).toEqual(
      base.map((entry) => [entry.id, entry.position, entry.selected]),
    );
    expect(stacked).toHaveLength(base.length);
  });

  it("dims only the nodes matching no active counter, keeping the matching ones bright", () => {
    const byId = cardById(buildContract());
    expect(byId.get("u")?.data.auditDimmed).toBe(false); // unknown counter matches
    expect(byId.get("r-protected")?.data.auditDimmed).toBe(true);
    expect(byId.get("r-noinput")?.data.auditDimmed).toBe(true);
    expect(byId.get("t")?.data.auditDimmed).toBe(true);
    // Isolation still applies independently: u touches no route-table edge, t does.
    expect(byId.get("u")?.data.isolated).toBe(true);
    expect(byId.get("t")?.data.isolated).toBe(false);
    expect(byId.get("r-protected")?.data.isolated).toBe(false);
  });

  it("unions the active counters: protected OR unknown stays bright", () => {
    const byId = cardById(
      buildContract({ contract: { ...contract, auditFilters: ["protected", "unknown"] } }),
    );
    expect(byId.get("r-protected")?.data.auditDimmed).toBe(false);
    expect(byId.get("u")?.data.auditDimmed).toBe(false);
    expect(byId.get("r-noinput")?.data.auditDimmed).toBe(true);
  });

  it("dims nothing when the filter set is empty, and attaches the diagnostics per node", () => {
    const byId = cardById(buildContract({ contract: { ...contract, auditFilters: [] } }));
    for (const entry of byId.values()) expect(entry.data.auditDimmed).toBe(false);
    expect(byId.get("r-protected")?.data.diagnostics).toEqual([warning]);
    expect(byId.get("r-noinput")?.data.diagnostics).toEqual([]);
  });

  it("carries the lens role and the compact LOD to every card", () => {
    for (const entry of cardsOf(buildContract())) {
      expect(entry.data.contractRole).toBe("dominant");
      expect(entry.data.compactContract).toBe(false);
    }
    const secondary = buildContract({
      contract: { ...contract, activeLenses: ["data", "contract"], compactContract: true },
    });
    for (const entry of cardsOf(secondary)) {
      expect(entry.data.contractRole).toBe("secondary");
      expect(entry.data.compactContract).toBe(true);
    }
    const inactive = buildContract({ contract: { ...contract, activeLenses: ["data"] } });
    for (const entry of cardsOf(inactive)) expect(entry.data.contractRole).toBeNull();
  });

  it("keeps the audit dimming off the notes: annotations are not contract subjects", () => {
    const note = buildContract().find((entry) => entry.id === "note-1");
    expect(note?.data).not.toHaveProperty("auditDimmed");
  });
});
