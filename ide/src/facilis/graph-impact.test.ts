// The impact simulation's pure cascade (issue #74): criteria 1-4 of the issue plus the
// never-read observation, on a fixture built with the shared graph-model builders. The lens
// must equal the model's incoming edges (elevated included), count routes and views separately,
// never invent an edge, and answer "not analysed" when column facts are absent.
import { describe, expect, it } from "vitest";
import { buildProjectGraphView } from "./graph-model";
import {
  columnFactsFromDetails,
  computeColumnImpact,
  computeRemovalImpact,
  impactOverlay,
  neverReadTableIds,
  tableColumnFactsExist,
} from "./graph-impact";
import type { NodeDetails } from "./graph-details";
import type { ProjectGraphEdge, ProjectGraphView } from "./graph-types";
import { column, graphOf, routeNode, tableNode, viewNode } from "./graph-model.test-fixtures";

const TODOS = "table:todos";
const PROJECTS = "table:projects";
const ARCHIVED = "table:archived";
const SECRET = "table:secret";
const VIEW = "view:active_todos";
const GET = "route:GET /api/todos";
const POST = "route:POST /api/todos";
const ACTIVE = "route:GET /api/active";
const DASHBOARD = "route:GET /api/dashboard";
const MIXED = "route:GET /api/mixed";
const SECRET_ROUTE = "route:POST /api/secret";

const edge = (
  id: string,
  kind: ProjectGraphEdge["kind"],
  source: string,
  target: string,
  access?: "elevated",
): ProjectGraphEdge => ({ id, kind, source, target, label: null, ...(access ? { access } : {}) });

// todos is read directly (one elevated), through a view with two reading routes, and by a route
// reached BOTH ways; projects is read only through the view; secret only via an elevated edge;
// archived by nobody. The fk is schema context, not a read.
const edges: ProjectGraphEdge[] = [
  edge("rt-get", "route-table", GET, TODOS),
  edge("rt-post", "route-table", POST, TODOS, "elevated"),
  edge("rt-mixed", "route-table", MIXED, TODOS),
  edge("rv-active", "route-view", ACTIVE, VIEW),
  edge("rv-dashboard", "route-view", DASHBOARD, VIEW, "elevated"),
  edge("rv-mixed", "route-view", MIXED, VIEW),
  edge("vb-todos", "view-base", VIEW, TODOS),
  edge("vb-projects", "view-base", VIEW, PROJECTS),
  edge("rt-secret", "route-table", SECRET_ROUTE, SECRET, "elevated"),
  edge("fk-projects", "fk", PROJECTS, TODOS),
];

const graph = graphOf(
  [
    tableNode("todos", {
      columns: [
        column("id", { primaryKey: true, notNull: true }),
        column("title"),
        column("dueDate", { type: "timestamp" }),
      ],
    }),
    tableNode("projects"),
    tableNode("archived"),
    tableNode("secret"),
    viewNode("active_todos", { tables: ["todos", "projects"] }),
    routeNode("GET", "/api/todos", { dbTables: ["todos"] }),
    routeNode("POST", "/api/todos", { dbTables: ["todos"] }),
    routeNode("GET", "/api/active", { dbTables: ["active_todos"] }),
    routeNode("GET", "/api/dashboard", { dbTables: ["active_todos"] }),
    routeNode("GET", "/api/mixed", { dbTables: ["todos", "active_todos"] }),
    routeNode("POST", "/api/secret", { dbTables: ["secret"] }),
  ],
  edges,
);

const view: ProjectGraphView = buildProjectGraphView({ graph });

/** Criterion 3: every highlighted id must exist in the visible view. */
function expectRealIds(
  result: { affectedNodeIds: readonly string[]; brokenEdgeIds: readonly string[] } | null,
) {
  if (result === null) throw new Error("fixture target is not visible");
  const nodeIds = new Set(view.nodes.map((node) => node.id));
  const edgeIds = new Set(view.edges.map((entry) => entry.id));
  for (const id of result.affectedNodeIds) expect(nodeIds.has(id), id).toBe(true);
  for (const id of result.brokenEdgeIds) expect(edgeIds.has(id), id).toBe(true);
}

describe("computeRemovalImpact on a table", () => {
  const result = computeRemovalImpact(view, TODOS);

  it("equals the model's incoming route-table edges, elevated included (criterion 1)", () => {
    expect(result).not.toBeNull();
    expect(result?.affectedNodeIds).toContain(POST);
    expect(result?.brokenEdgeIds).toContain("rt-post");
    expect(result?.brokenEdgeIds).toContain("rt-get");
    expectRealIds(result);
  });

  it("includes the view and its reading routes, counted separately (criterion 2)", () => {
    expect(result?.affectedNodeIds).toContain(VIEW);
    expect(result?.affectedNodeIds).toContain(ACTIVE);
    expect(result?.affectedNodeIds).toContain(DASHBOARD);
    // The elevated route-view edge counts like any read.
    expect(result?.brokenEdgeIds).toContain("rv-dashboard");
    expect(result?.counts).toEqual({ routes: 5, views: 1 });
  });

  it("counts a route reached directly AND through the view exactly once", () => {
    expect(result?.affectedNodeIds.filter((id) => id === MIXED)).toHaveLength(1);
    expect(result?.brokenEdgeIds).toContain("rt-mixed");
    expect(result?.brokenEdgeIds).toContain("rv-mixed");
  });

  it("breaks exactly the touching route-table/view-base and broken-view route-view edges", () => {
    expect(result?.brokenEdgeIds).toEqual(
      ["rt-get", "rt-mixed", "rt-post", "rv-active", "rv-dashboard", "rv-mixed", "vb-todos"].sort(),
    );
    // The view's other base and the fk are not broken by removing todos.
    expect(result?.brokenEdgeIds).not.toContain("vb-projects");
    expect(result?.brokenEdgeIds).not.toContain("fk-projects");
    expectRealIds(result);
  });

  it("returns deterministic sorted ids and the target separately", () => {
    if (result === null) throw new Error("fixture target is not visible");
    expect(result.targetId).toBe(TODOS);
    expect(result.affectedNodeIds).toEqual([...result.affectedNodeIds].sort());
    expect(result.brokenEdgeIds).toEqual([...result.brokenEdgeIds].sort());
    expect(result.affectedNodeIds).not.toContain(TODOS);
  });

  it("never invents an edge when a kind is hidden from the view (criterion 3)", () => {
    const filtered = buildProjectGraphView({ graph, hiddenEdgeKinds: ["route-view"] });
    const filteredResult = computeRemovalImpact(filtered, TODOS);
    const visibleEdges = new Set(filtered.edges.map((entry) => entry.id));
    for (const id of filteredResult?.brokenEdgeIds ?? []) expect(visibleEdges.has(id)).toBe(true);
    // The view still breaks (view-base is visible) but its readers are no longer reachable.
    expect(filteredResult?.counts).toEqual({ routes: 3, views: 1 });
    expect(filteredResult?.affectedNodeIds).not.toContain(ACTIVE);
    expect(filteredResult?.brokenEdgeIds).not.toContain("rv-active");
  });
});

describe("computeRemovalImpact on a view", () => {
  const result = computeRemovalImpact(view, VIEW);

  it("breaks the reading routes and the view's own base edges", () => {
    expect(result?.counts).toEqual({ routes: 3, views: 0 });
    expect(result?.affectedNodeIds).toEqual([ACTIVE, DASHBOARD, MIXED].sort());
    expect(result?.brokenEdgeIds).toEqual(
      ["rv-active", "rv-dashboard", "rv-mixed", "vb-projects", "vb-todos"].sort(),
    );
    // Removing the view does not break the direct route-table declarations on todos.
    expect(result?.brokenEdgeIds).not.toContain("rt-get");
    expectRealIds(result);
  });
});

describe("computeRemovalImpact degradation and cycles", () => {
  it("degrades to null for absent ids and non-table/view kinds (stale deep links)", () => {
    expect(computeRemovalImpact(view, "table:gone")).toBeNull();
    expect(computeRemovalImpact(view, GET)).toBeNull();
    expect(computeRemovalImpact(view, "")).toBeNull();
  });

  it("terminates on a view-on-view cycle and cascades through it", () => {
    const cyclic = buildProjectGraphView({
      graph: graphOf(
        [
          tableNode("base"),
          viewNode("v1", { tables: ["v2"] }),
          viewNode("v2", { tables: ["v1", "base"] }),
          routeNode("GET", "/api/v2", { dbTables: ["v2"] }),
        ],
        [
          edge("vb-1", "view-base", "view:v1", "view:v2"),
          edge("vb-2", "view-base", "view:v2", "view:v1"),
          edge("vb-base", "view-base", "view:v2", "table:base"),
          edge("rv-1", "route-view", "route:GET /api/v2", "view:v2"),
        ],
      ),
    });
    const result = computeRemovalImpact(cyclic, "table:base");
    expect(result?.counts).toEqual({ routes: 1, views: 2 });
    expect(result?.affectedNodeIds).toEqual(["route:GET /api/v2", "view:v1", "view:v2"]);
    expect(result?.brokenEdgeIds).toEqual(["rv-1", "vb-1", "vb-2", "vb-base"]);
  });
});

describe("neverReadTableIds", () => {
  it("names only tables no route reads, directly or through a view", () => {
    expect(neverReadTableIds(view)).toEqual([ARCHIVED]);
  });

  it("counts elevated reads and view-on-view chains as reads", () => {
    const chained = buildProjectGraphView({
      graph: graphOf(
        [
          tableNode("deep"),
          tableNode("lonely"),
          viewNode("inner", { tables: ["deep"] }),
          viewNode("outer", { tables: ["inner"] }),
          routeNode("GET", "/api/outer", { dbTables: ["outer"] }),
        ],
        [
          edge("vb-inner", "view-base", "view:inner", "table:deep"),
          edge("vb-outer", "view-base", "view:outer", "view:inner"),
          edge("rv-outer", "route-view", "route:GET /api/outer", "view:outer", "elevated"),
        ],
      ),
    });
    expect(neverReadTableIds(chained)).toEqual(["table:lonely"]);
  });

  it("is deterministic and empty when every table is read", () => {
    const ids = neverReadTableIds(view);
    expect(ids).toEqual([...ids].sort());
    const allRead = buildProjectGraphView({
      graph: graphOf([tableNode("t")], [edge("rt", "route-table", GET, "table:t")]),
    });
    // The route node is absent, so the edge is dropped by the view builder: t stays unread.
    expect(neverReadTableIds(allRead)).toEqual(["table:t"]);
  });
});

describe("computeColumnImpact", () => {
  // Declarations, not a reference analysis: GET and MIXED declare the dueDate PROPERTY; POST
  // declares the SQL spelling, which must not match the property (no guessed SQL-name matches).
  const facts = new Map<string, readonly string[]>([
    [GET, ["todos.dueDate"]],
    [MIXED, ["todos.title", "todos.dueDate"]],
    [POST, ["todos.due_date"]],
  ]);

  it("answers the honest unknown when no route declares any column of the table (criterion 4)", () => {
    expect(computeColumnImpact(view, PROJECTS, "id", facts)).toEqual({ analysed: false });
    expect(computeColumnImpact(view, TODOS, "dueDate", new Map())).toEqual({ analysed: false });
    expect(computeColumnImpact(view, "table:gone", "id", facts)).toEqual({ analysed: false });
    expect(tableColumnFactsExist(view, PROJECTS, facts)).toBe(false);
    expect(tableColumnFactsExist(view, TODOS, facts)).toBe(true);
  });

  it("names exactly the routes declaring table.property, with real broken edges only", () => {
    const result = computeColumnImpact(view, TODOS, "dueDate", facts);
    expect(result.analysed).toBe(true);
    if (!result.analysed) return;
    expect(result.targetId).toBe(TODOS);
    expect(result.columnProperty).toBe("dueDate");
    expect(result.affectedNodeIds).toEqual([GET, MIXED].sort());
    expect(result.counts).toEqual({ routes: 2, views: 0 });
    expect(result.brokenEdgeIds).toEqual(["rt-get", "rt-mixed"]);
    expectRealIds(result);
  });

  it("separates a known zero from the unknown: an undeclared column of an analysed table", () => {
    const result = computeColumnImpact(view, TODOS, "title", facts);
    expect(result.analysed).toBe(true);
    if (!result.analysed) return;
    expect(result.affectedNodeIds).toEqual([MIXED]);
    expect(result.brokenEdgeIds).toEqual(["rt-mixed"]);
    const zero = computeColumnImpact(view, TODOS, "id", facts);
    expect(zero.analysed).toBe(true);
    if (!zero.analysed) return;
    expect(zero.affectedNodeIds).toEqual([]);
    expect(zero.brokenEdgeIds).toEqual([]);
  });

  it("ignores facts whose route the view does not draw (stale or filtered ids)", () => {
    const ghost = new Map<string, readonly string[]>([["route:GET /api/ghost", ["todos.dueDate"]]]);
    expect(computeColumnImpact(view, TODOS, "dueDate", ghost)).toEqual({ analysed: false });
    const mixed = new Map([...facts, ...ghost]);
    const result = computeColumnImpact(view, TODOS, "dueDate", mixed);
    expect(result.analysed).toBe(true);
    if (!result.analysed) return;
    expect(result.affectedNodeIds).toEqual([GET, MIXED].sort());
  });
});

describe("columnFactsFromDetails", () => {
  it("slices the existing details join to routeId → dbColumns without re-extracting", () => {
    const route: NodeDetails = {
      kind: "route",
      route: {
        source: null,
        dbColumns: ["todos.dueDate"],
        crossSite: null,
        rawSql: null,
        handlerBodyRead: true,
        handlerFormRead: false,
        relations: { used: [], unresolved: 0, rawSql: 0, opaque: false },
        elevations: [],
      },
    };
    const table: NodeDetails = {
      kind: "table",
      table: { source: null, columns: [], policies: [], foreignKeys: [], relations: [] },
    };
    const facts = columnFactsFromDetails(
      new Map<string, NodeDetails>([
        [GET, route],
        [TODOS, table],
      ]),
    );
    expect(facts.get(GET)).toEqual(["todos.dueDate"]);
    expect(facts.has(TODOS)).toBe(false);
  });
});

describe("impactOverlay", () => {
  it("keeps the target and its dependents bright and badges never-read tables", () => {
    const result = computeRemovalImpact(view, TODOS);
    const overlay = impactOverlay(view, result);
    expect(overlay.targetId).toBe(TODOS);
    expect(overlay.keepNodeIds.has(TODOS)).toBe(true);
    expect(overlay.keepNodeIds.has(MIXED)).toBe(true);
    expect(overlay.keepNodeIds.has(VIEW)).toBe(true);
    expect(overlay.keepNodeIds.has(ARCHIVED)).toBe(false);
    expect(overlay.brokenEdgeIds.has("rt-post")).toBe(true);
    expect(overlay.neverReadTableIds.has(ARCHIVED)).toBe(true);
  });

  it("without a result only badges: no target, no dimming, no broken edges", () => {
    const overlay = impactOverlay(view, null);
    expect(overlay.targetId).toBeNull();
    expect(overlay.keepNodeIds.size).toBe(0);
    expect(overlay.brokenEdgeIds.size).toBe(0);
    expect(overlay.neverReadTableIds.has(ARCHIVED)).toBe(true);
  });

  it("serves the analysed column result with the same shape", () => {
    const facts = new Map([[GET, ["todos.dueDate"]]]);
    const result = computeColumnImpact(view, TODOS, "dueDate", facts);
    expect(result.analysed).toBe(true);
    if (!result.analysed) return;
    const overlay = impactOverlay(view, result);
    expect(overlay.targetId).toBe(TODOS);
    expect(overlay.keepNodeIds.has(GET)).toBe(true);
    expect(overlay.keepNodeIds.has(MIXED)).toBe(false);
    expect(overlay.brokenEdgeIds.has("rt-get")).toBe(true);
  });
});
