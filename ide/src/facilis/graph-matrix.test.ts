// The matrix derivation (issue #67): cells must agree with the topology's own edge set — the
// matrix is a pivot of the SAME ProjectGraphView, never a second analysis. The fixture covers
// all four cell states (declared, elevated, via-view, absent) including multi-kind stacks, and
// pins the inherited filters: search dims but never removes, table visibility (D-179) shrinks
// the columns upstream, hidden edge kinds drop the markers they back.
import { describe, expect, it } from "vitest";
import type { GraphNode, HttpMethod, ProjectGraph } from "@facilis.dev/analyze";
import { buildProjectGraphView } from "./graph-model";
import { buildGraphMatrix, type GraphMatrixModel } from "./graph-matrix";
import {
  PAGE,
  TODOS,
  PROJECTS,
  ACTIVE_TODOS,
  graphOf,
  routeNode,
  tableNode,
} from "./graph-model.test-fixtures";

type Edge = ProjectGraph["edges"][number];
const edge = (
  id: string,
  kind: Edge["kind"],
  source: string,
  target: string,
  elevated = false,
): Edge => ({
  id,
  kind,
  source,
  target,
  label: null,
  ...(elevated ? { access: "elevated" as const } : {}),
});

/** routeNode only spells GET/POST; the matrix groups every method, so widen it here. */
function route(method: HttpMethod, path: string, dbTables: readonly string[] = []): GraphNode {
  const base = routeNode("GET", path, { dbTables });
  if (base.data.kind !== "route") throw new Error("routeNode fixture must be a route");
  return {
    ...base,
    id: "route:" + method + " " + path,
    label: method + " " + path,
    data: { ...base.data, method },
  };
}

const GET = route("GET", "/api/todos", ["todos", "projects", "active_todos"]);
const POST = route("POST", "/api/todos", ["todos"]);
const REPORT = route("GET", "/api/reports", ["active_todos"]);
const DELETE = route("DELETE", "/api/todos/{id}");

const EDGES: Edge[] = [
  edge("page-route:1", "page-route", PAGE.id, GET.id),
  edge("page-route:2", "page-route", PAGE.id, POST.id),
  edge("route-table:1", "route-table", GET.id, TODOS.id),
  edge("route-table:2", "route-table", GET.id, PROJECTS.id, true),
  edge("route-table:3", "route-table", POST.id, TODOS.id, true),
  edge("route-view:1", "route-view", GET.id, ACTIVE_TODOS.id),
  edge("route-view:2", "route-view", REPORT.id, ACTIVE_TODOS.id, true),
  edge("view-base:1", "view-base", ACTIVE_TODOS.id, TODOS.id),
  edge("view-base:2", "view-base", ACTIVE_TODOS.id, PROJECTS.id),
];
const graph = (): ProjectGraph =>
  graphOf([PAGE, GET, POST, REPORT, DELETE, TODOS, PROJECTS, ACTIVE_TODOS], EDGES);

const cell = (model: GraphMatrixModel, routeId: string, columnId: string) => {
  const row = model.rows.find((entry) => entry.routeId === routeId);
  const index = model.columns.findIndex((column) => column.nodeId === columnId);
  return row?.cells[index];
};

describe("graph matrix cell kinds", () => {
  const model = buildGraphMatrix(buildProjectGraphView({ graph: graph() }));

  it("stacks every kind a cell carries, in canonical order", () => {
    // GET declares projects AND elevates it AND reaches it through the view: all three markers.
    expect(cell(model, GET.id, PROJECTS.id)?.kinds).toEqual(["declared", "elevated", "via-view"]);
    // GET declares todos directly and also reaches it via the view: two markers.
    expect(cell(model, GET.id, TODOS.id)?.kinds).toEqual(["declared", "via-view"]);
    // POST elevates a direct declaration.
    expect(cell(model, POST.id, TODOS.id)?.kinds).toEqual(["declared", "elevated"]);
    // REPORT only reaches the bases through an elevated route-view hop: no declaration.
    expect(cell(model, REPORT.id, TODOS.id)?.kinds).toEqual(["elevated", "via-view"]);
    expect(cell(model, REPORT.id, PROJECTS.id)?.kinds).toEqual(["elevated", "via-view"]);
    // A view column cell is the declaration of the view itself.
    expect(cell(model, GET.id, ACTIVE_TODOS.id)?.kinds).toEqual(["declared"]);
    expect(cell(model, REPORT.id, ACTIVE_TODOS.id)?.kinds).toEqual(["declared", "elevated"]);
  });

  it("marks an untouched pair absent, with no backing edges", () => {
    expect(cell(model, POST.id, PROJECTS.id)?.kinds).toEqual([]);
    expect(cell(model, POST.id, PROJECTS.id)?.edgeIds).toEqual([]);
    expect(cell(model, DELETE.id, TODOS.id)?.kinds).toEqual([]);
    expect(model.rows.find((row) => row.routeId === DELETE.id)?.degree).toBe(0);
  });

  it("names the route, the column and any intermediate view for a topology focus", () => {
    const via = cell(model, REPORT.id, TODOS.id);
    expect(via?.pathNodeIds).toEqual([REPORT.id, TODOS.id, ACTIVE_TODOS.id]);
    expect(via?.edgeIds).toEqual(["route-view:2", "view-base:1"]);
  });
});

describe("graph matrix counts agree with the topology view", () => {
  const view = buildProjectGraphView({ graph: graph() });
  const model = buildGraphMatrix(view);

  it("backs every marker with the view's own edges, and loses none", () => {
    const schemaEdges = view.edges.filter(
      (entry) =>
        entry.kind === "route-table" || entry.kind === "route-view" || entry.kind === "view-base",
    );
    const backed = new Set(
      model.rows.flatMap((row) => row.cells.flatMap((entry) => entry.edgeIds)),
    );
    expect(backed).toEqual(new Set(schemaEdges.map((entry) => entry.id)));
  });

  it("declared table cells are exactly the route-table pairs the topology draws", () => {
    const pairs = new Set(
      view.edges
        .filter((entry) => entry.kind === "route-table")
        .map((entry) => entry.source + "\u0000" + entry.target),
    );
    const declared = model.rows.flatMap((row) =>
      model.columns
        .filter(
          (column, index) =>
            column.block === "tables" && row.cells[index]?.kinds.includes("declared"),
        )
        .map((column) => row.routeId + "\u0000" + column.nodeId),
    );
    expect(new Set(declared)).toEqual(pairs);
  });

  it("via-view cells are exactly the route → view → base paths of the visible edges", () => {
    const bases = new Map<string, string[]>();
    for (const entry of view.edges) {
      if (entry.kind === "view-base")
        bases.set(entry.source, [...(bases.get(entry.source) ?? []), entry.target]);
    }
    const paths = new Set(
      view.edges
        .filter((entry) => entry.kind === "route-view")
        .flatMap((entry) =>
          (bases.get(entry.target) ?? []).map((base) => entry.source + "\u0000" + base),
        ),
    );
    const via = model.rows.flatMap((row) =>
      model.columns
        .filter((_column, index) => row.cells[index]?.kinds.includes("via-view"))
        .map((column) => row.routeId + "\u0000" + column.nodeId),
    );
    expect(new Set(via)).toEqual(paths);
  });

  it("row and column degrees count the same non-absent cells", () => {
    const rowTotal = model.rows.reduce((total, row) => total + row.degree, 0);
    const colTotal = model.columns.reduce((total, column) => total + column.degree, 0);
    const marked = model.rows
      .flatMap((row) => row.cells)
      .filter((entry) => entry.kinds.length > 0).length;
    expect(rowTotal).toBe(colTotal);
    expect(rowTotal).toBe(marked);
    expect(model.columns.find((column) => column.nodeId === TODOS.id)?.degree).toBe(3);
    expect(model.columns.find((column) => column.nodeId === ACTIVE_TODOS.id)?.degree).toBe(2);
  });
});

describe("graph matrix rows, groups and pages", () => {
  const view = buildProjectGraphView({ graph: graph() });

  it("groups rows by method in canonical order and sorts by path by default", () => {
    const model = buildGraphMatrix(view);
    expect(model.groups.map((group) => group.method)).toEqual(["GET", "POST", "DELETE"]);
    expect(model.groups[0]?.rows.map((row) => row.path)).toEqual(["/api/reports", "/api/todos"]);
    expect(model.rows.map((row) => row.routeId)).toEqual([REPORT.id, GET.id, POST.id, DELETE.id]);
  });

  it("sorts by degree descending when asked, breaking ties by path", () => {
    const model = buildGraphMatrix(view, "degree");
    // REPORT and GET both touch three columns; the path tie-break puts /api/reports first.
    expect(model.groups[0]?.rows.map((row) => row.routeId)).toEqual([REPORT.id, GET.id]);
    expect(model.groups[1]?.rows.map((row) => row.degree)).toEqual([1]);
    expect(model.groups[2]?.rows.map((row) => row.degree)).toEqual([0]);
  });

  it("omits pages from rows and columns and summarises them as route counts", () => {
    const model = buildGraphMatrix(view);
    expect(model.rows.every((row) => row.routeId.startsWith("route:"))).toBe(true);
    expect(
      model.columns.every((column) => column.block === "tables" || column.block === "views"),
    ).toBe(true);
    expect(model.pages).toEqual([
      { pageId: PAGE.id, label: PAGE.label, routeCount: 2, matched: true },
    ]);
  });

  it("puts tables before the separate views block, each in label order", () => {
    const model = buildGraphMatrix(view);
    expect(model.columns.map((column) => column.nodeId)).toEqual([
      PROJECTS.id,
      TODOS.id,
      ACTIVE_TODOS.id,
    ]);
    expect(model.columns.map((column) => column.block)).toEqual(["tables", "tables", "views"]);
  });
});

describe("graph matrix inherits the view's filters", () => {
  it("keeps every row under a search query and carries the matched flag (dim, never remove)", () => {
    const view = buildProjectGraphView({ graph: graph(), query: "reports" });
    const model = buildGraphMatrix(view);
    expect(model.rows).toHaveLength(4);
    expect(model.rows.find((row) => row.routeId === REPORT.id)?.matched).toBe(true);
    expect(model.rows.find((row) => row.routeId === GET.id)?.matched).toBe(false);
    // The counts are the topology's counts: a query dims cards, it never deletes edges.
    const unfiltered = buildGraphMatrix(buildProjectGraphView({ graph: graph() }));
    expect(model.rows.map((row) => row.degree)).toEqual(unfiltered.rows.map((row) => row.degree));
  });

  it("drops hidden edge kinds' markers exactly like the topology drops the edges", () => {
    const view = buildProjectGraphView({ graph: graph(), hiddenEdgeKinds: ["view-base"] });
    const model = buildGraphMatrix(view);
    expect(cell(model, GET.id, TODOS.id)?.kinds).toEqual(["declared"]);
    expect(cell(model, REPORT.id, TODOS.id)?.kinds).toEqual([]);
    const backed = new Set(
      model.rows.flatMap((row) => row.cells.flatMap((entry) => entry.edgeIds)),
    );
    expect(backed.has("view-base:1")).toBe(false);
    // The route-view edge survives: it still backs the view column's own declaration cell.
    expect(backed.has("route-view:2")).toBe(true);
    expect(cell(model, REPORT.id, ACTIVE_TODOS.id)?.kinds).toEqual(["declared", "elevated"]);
  });

  it("shrinks columns when table visibility hid a framework table upstream (D-179)", () => {
    const users = tableNode("users", {
      framework: true,
      sourceFile: "node_modules/@facilis.dev/auth/src/tables.ts",
    });
    const caller = route("GET", "/api/me", ["todos", "users"]);
    const local = graphOf(
      [caller, TODOS, users],
      [
        edge("route-table:a", "route-table", caller.id, TODOS.id),
        edge("route-table:b", "route-table", caller.id, users.id),
      ],
    );
    const all = buildGraphMatrix(buildProjectGraphView({ graph: local, tableVisibility: "all" }));
    const project = buildGraphMatrix(
      buildProjectGraphView({ graph: local, tableVisibility: "project" }),
    );
    expect(all.columns.map((column) => column.nodeId)).toEqual([TODOS.id, users.id]);
    expect(project.columns.map((column) => column.nodeId)).toEqual([TODOS.id]);
    // Routes are never filtered (D-179), and the counts still agree with the drawn edges.
    expect(project.rows).toHaveLength(1);
    const drawn = buildProjectGraphView({ graph: local, tableVisibility: "project" });
    expect(drawn.edges.filter((entry) => entry.kind === "route-table")).toHaveLength(1);
    expect(project.rows[0]?.degree).toBe(1);
    expect(cell(project, caller.id, users.id)).toBeUndefined();
  });

  it("derives an empty matrix from an empty view without throwing", () => {
    const model = buildGraphMatrix(buildProjectGraphView({ graph: graphOf([]) }));
    expect(model.rows).toEqual([]);
    expect(model.columns).toEqual([]);
    expect(model.pages).toEqual([]);
  });
});
