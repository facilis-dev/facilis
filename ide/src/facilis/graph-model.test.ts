import { describe, expect, it } from "vitest";
import { buildProjectGraphView, sourcePathFor } from "./graph-model";
import {
  ACTIVE_TODOS,
  GET,
  PAGE,
  TODOS,
  WORKFLOW,
  graphOf,
  ref,
  routeNode,
  tableNode,
} from "./graph-model.test-fixtures";

describe("buildProjectGraphView data", () => {
  it("maps the four node kinds and their fact data", () => {
    const view = buildProjectGraphView({ graph: graphOf([PAGE, GET, TODOS, ACTIVE_TODOS]) });
    expect(view.nodes.map((node) => [node.id, node.kind])).toEqual([
      ["page:src/pages/todos.tsx", "page"],
      ["route:GET /api/todos", "route"],
      ["table:todos", "table"],
      ["view:active_todos", "view"],
    ]);
    const page = view.nodes.find((node) => node.kind === "page");
    expect(page?.data).toEqual({
      kind: "page",
      pagePath: "src/pages/todos.tsx",
      pageKind: "page",
      callCount: 2,
      routePaths: [],
      preview: null,
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
    expect(view.nodes.find((node) => node.kind === "view")?.data).toMatchObject({
      kind: "view",
      view: "active_todos",
      access: "definer",
    });
  });

  it("maps workflow definitions and their steps", () => {
    const view = buildProjectGraphView({ graph: graphOf([WORKFLOW]) });
    expect(view.nodes[0]?.data).toEqual({
      kind: "workflow",
      name: "purge",
      unknown: false,
      steps: [
        { index: 0, kind: "job", name: "purge-todos", permission: null, onRejectStep: null },
        {
          index: 1,
          kind: "approval",
          name: "workflows.purge.approval",
          permission: "tasks:decide",
          onRejectStep: 2,
        },
      ],
    });
    expect(view.stats.workflows).toBe(1);
  });

  it("maps route paths and the static page structure onto a page card", () => {
    const page = {
      ...PAGE,
      data: {
        ...PAGE.data,
        routePaths: ["/todos"],
        preview: {
          routePaths: ["/todos"],
          nodes: [
            {
              id: "p0",
              parentId: null,
              name: "TodosPage",
              kind: "component" as const,
              file: "src/pages/todos.tsx",
              source: ref("src/pages/todos.tsx"),
              dynamic: false,
            },
          ],
          truncated: false,
        },
      },
    };
    const view = buildProjectGraphView({ graph: graphOf([page, GET, TODOS]) });
    const data = view.nodes.find((node) => node.id === PAGE.id)?.data;
    expect(data?.kind === "page" ? data.routePaths : undefined).toEqual(["/todos"]);
    expect(data?.kind === "page" ? data.preview?.nodes[0]?.name : undefined).toBe("TodosPage");
  });

  it("gives table nodes columns with name, type and markers, plus RLS/scope/unknown", () => {
    const owner = tableNode("projects", {
      scope: { column: "ownerId", kind: "owner" },
      policies: [
        { name: "tenant_isolation", restrictive: true },
        { name: "owner_isolation", restrictive: false },
      ],
      unknown: true,
    });
    const view = buildProjectGraphView({ graph: graphOf([TODOS, owner]) });
    const todos = view.nodes.find((node) => node.id === "table:todos");
    if (todos?.data.kind !== "table") throw new Error("expected a table node");
    expect(todos.data.rlsEnabled).toBe(true);
    expect(todos.data.scope).toBeNull();
    expect(todos.data.policies).toEqual([]);
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
    expect(projects.data.policies).toEqual([
      { name: "tenant_isolation", restrictive: true },
      { name: "owner_isolation", restrictive: false },
    ]);
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

describe("sourcePathFor", () => {
  it("resolves project-relative sources against the root", () => {
    expect(sourcePathFor("/w/app", "db/schema.ts")).toBe("/w/app/db/schema.ts");
    expect(sourcePathFor("/w/app", "/abs/file.ts")).toBe("/abs/file.ts");
    expect(sourcePathFor(null, "db/schema.ts")).toBeNull();
    expect(sourcePathFor("/w/app", null)).toBeNull();
  });
});
