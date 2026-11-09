import { describe, expect, it } from "vitest";
import { buildProjectGraphView, sourcePathFor } from "./graph-model";
import {
  GET,
  PAGE,
  PROJECTS,
  TODOS,
  graphOf,
  pageNode,
  routeNode,
  tableNode,
} from "./graph-model.test-fixtures";

describe("buildProjectGraphView data", () => {
  it("maps the three node kinds and their fact data", () => {
    const view = buildProjectGraphView({ graph: graphOf([PAGE, GET, TODOS]) });
    expect(view.nodes.map((node) => [node.id, node.kind])).toEqual([
      ["page:src/pages/todos.tsx", "page"],
      ["route:GET /api/todos", "route"],
      ["table:todos", "table"],
    ]);
    const page = view.nodes.find((node) => node.kind === "page");
    expect(page?.data).toEqual({
      kind: "page",
      pagePath: "src/pages/todos.tsx",
      pageKind: "page",
      callCount: 2,
    });
    const route = view.nodes.find((node) => node.kind === "route");
    expect(route?.data).toMatchObject({
      method: "GET",
      path: "/api/todos",
      permission: ["todos:read"],
      wrapper: "valid",
      description: null,
      input: { body: false, form: false, query: false, params: false },
      pathParams: [],
      unknown: false,
    });
  });

  it("gives table nodes columns with name, type and markers, plus RLS/scope/unknown", () => {
    const owner = tableNode("projects", {
      scope: { column: "ownerId", kind: "owner" },
      unknown: true,
    });
    const view = buildProjectGraphView({ graph: graphOf([TODOS, owner]) });
    const todos = view.nodes.find((node) => node.id === "table:todos");
    if (todos?.data.kind !== "table") throw new Error("expected a table node");
    expect(todos.data.rlsEnabled).toBe(true);
    expect(todos.data.scope).toBeNull();
    expect(todos.data.unknown).toBe(false);
    expect(todos.data.columns).toEqual([
      { property: "id", name: "id", type: "text", markers: ["primaryKey", "notNull"] },
      { property: "title", name: "title", type: "text", markers: ["unique"] },
      { property: "createdAt", name: "created_at", type: "timestamp", markers: ["default"] },
      { property: "staging", name: "staging", type: "text", markers: ["unknown"] },
    ]);
    const projects = view.nodes.find((node) => node.id === "table:projects");
    if (projects?.data.kind !== "table") throw new Error("expected a table node");
    expect(projects.data.scope).toEqual({ column: "ownerId", kind: "owner" });
    expect(projects.data.unknown).toBe(true);
    expect(view.stats.unknownNodes).toBe(1);
  });

  it("keeps a route's invalid wrapper and unknown badge", () => {
    const invalid = routeNode("POST", "/api/todos", {
      permission: [],
      wrapper: "invalid",
      unknown: true,
    });
    const view = buildProjectGraphView({ graph: graphOf([invalid]) });
    expect(view.nodes[0]?.data).toMatchObject({
      wrapper: "invalid",
      permission: [],
      unknown: true,
    });
    expect(view.stats.unknownNodes).toBe(1);
  });

  it("maps the input flags and template path parameters onto the route card", () => {
    const templated = routeNode("POST", "/api/todos/{id}", {
      input: { body: true, form: false, query: false, params: true },
    });
    const view = buildProjectGraphView({ graph: graphOf([templated]) });
    expect(view.nodes[0]?.data).toMatchObject({
      kind: "route",
      path: "/api/todos/{id}",
      input: { body: true, form: false, query: false, params: true },
      pathParams: ["id"],
    });
  });

  it("maps the route description and tolerates a payload from before it existed", () => {
    const described = routeNode("GET", "/api/todos", {
      description: "List todos visible to the current user.",
    });
    const view = buildProjectGraphView({ graph: graphOf([described]) });
    expect(view.nodes[0]?.data).toMatchObject({
      kind: "route",
      description: "List todos visible to the current user.",
    });

    // An analyzer worker started before the description existed (or a Fast-Refresh-preserved
    // view) delivers the old RouteNodeData shape: the card must render without a quote.
    const legacy = routeNode("GET", "/api/todos");
    const data = { ...legacy.data } as Record<string, unknown>;
    delete data.description;
    const legacyView = buildProjectGraphView({
      graph: graphOf([{ ...legacy, data } as unknown as typeof legacy]),
    });
    expect(legacyView.nodes[0]?.data).toMatchObject({ kind: "route", description: null });
  });

  it("tolerates a route payload from an analyzer that predates the input facts", () => {
    const legacy = routeNode("GET", "/api/todos");
    // An analyzer worker started before the field existed (or a Fast-Refresh-preserved view)
    // delivers the old RouteNodeData shape without causing a crash.
    const data = { ...legacy.data } as Record<string, unknown>;
    delete data.input;
    const graph = graphOf([{ ...legacy, data } as unknown as typeof legacy]);
    const view = buildProjectGraphView({ graph });
    expect(view.nodes[0]?.data).toMatchObject({
      kind: "route",
      input: { body: false, form: false, query: false, params: false },
      pathParams: [],
    });
  });
});

describe("buildProjectGraphView edges and filters", () => {
  const graph = graphOf(
    [PAGE, GET, TODOS, PROJECTS],
    [
      { id: "page-route:1", kind: "page-route", source: PAGE.id, target: GET.id, label: null },
      {
        id: "route-table:1",
        kind: "route-table",
        source: GET.id,
        target: TODOS.id,
        label: "dbTables",
      },
      {
        id: "fk:1",
        kind: "fk",
        source: TODOS.id,
        target: PROJECTS.id,
        label: "todos -> projects.id",
      },
      { id: "relation:1", kind: "relation", source: TODOS.id, target: PROJECTS.id, label: "one" },
    ],
  );

  it("passes every edge through when nothing is hidden", () => {
    const view = buildProjectGraphView({ graph });
    expect(view.edges.map((edge) => edge.kind)).toEqual([
      "page-route",
      "route-table",
      "fk",
      "relation",
    ]);
    expect(view.stats).toMatchObject({ edges: 4, hiddenEdges: 0, pages: 1, routes: 1, tables: 2 });
  });

  it("drops hidden edge kinds and counts them", () => {
    const view = buildProjectGraphView({ graph, hiddenEdgeKinds: ["fk", "relation"] });
    expect(view.edges.map((edge) => edge.kind)).toEqual(["page-route", "route-table"]);
    expect(view.stats.hiddenEdges).toBe(2);
    expect(view.stats.edges).toBe(2);
  });

  it("drops edges whose endpoints the graph does not contain", () => {
    const view = buildProjectGraphView({
      graph: graphOf(
        [GET],
        [
          {
            id: "page-route:ghost",
            kind: "page-route",
            source: "page:gone.tsx",
            target: GET.id,
            label: null,
          },
        ],
      ),
    });
    expect(view.edges).toEqual([]);
    expect(view.nodes.map((node) => node.id)).toEqual([GET.id]);
  });

  it("defensively drops a page with no calls", () => {
    const empty = pageNode("src/pages/empty.tsx", 0);
    const view = buildProjectGraphView({
      graph: graphOf(
        [empty, GET],
        [
          {
            id: "page-route:empty",
            kind: "page-route",
            source: empty.id,
            target: GET.id,
            label: null,
          },
        ],
      ),
    });
    expect(view.nodes.map((node) => node.id)).toEqual([GET.id]);
    expect(view.edges).toEqual([]);
    expect(view.stats.pages).toBe(0);
  });
});

describe("sourcePathFor", () => {
  it("resolves project-relative sources against the root", () => {
    expect(sourcePathFor("/w/app", "db/schema.ts")).toBe("/w/app/db/schema.ts");
    expect(sourcePathFor("/w/app", "/abs/file.ts")).toBe("/abs/file.ts");
    expect(sourcePathFor(null, "db/schema.ts")).toBeNull();
    expect(sourcePathFor("/w/app", null)).toBeNull();
  });
});
