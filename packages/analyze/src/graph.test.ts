import { describe, expect, it } from "vitest";

import { buildProjectGraph } from "./graph.ts";
import { countByKind, fixtureInput, ref, route } from "../test-fixtures/graph.ts";
import type { TableFact } from "./types.ts";

describe("buildProjectGraph", () => {
  const input = fixtureInput();
  const graph = buildProjectGraph(input);

  it("builds table, route and page nodes with stable sorted ids", () => {
    expect(graph.nodes.map((node) => node.id)).toEqual([
      "page:src/pages/todos.tsx",
      "route:GET /api/ghosts",
      "route:GET /api/todos",
      "route:PATCH /api/todos/{id}",
      "route:POST /api/todos",
      "table:projects",
      "table:sessions",
      "table:todos",
      "table:users",
    ]);
  });

  it("builds fk, relation, route-table and page-route edges", () => {
    expect(graph.edges).toHaveLength(7);
    expect(countByKind(input)).toEqual({
      fk: 1,
      relation: 2,
      "page-route": 1,
      "route-table": 3,
    });
    expect(graph.edges.map((edge) => edge.id)).toEqual(
      graph.edges.map((edge) => edge.id).toSorted((left, right) => left.localeCompare(right)),
    );
  });

  it("labels table edges with the physical/logical meaning", () => {
    const fk = graph.edges.find((edge) => edge.kind === "fk");
    expect(fk).toMatchObject({ source: "table:todos", target: "table:projects" });
    expect(fk?.label).toContain("cascade");
    const relationLabels = graph.edges
      .filter((edge) => edge.kind === "relation")
      .map((edge) => edge.label)
      .toSorted();
    expect(relationLabels).toEqual(["many", "one"]);
    expect(graph.edges.filter((edge) => edge.label === "dbTables").map((edge) => edge.id)).toEqual([
      "route-table:route:GET /api/todos:dbTables:todos",
      "route-table:route:POST /api/todos:dbTables:todos",
    ]);
    expect(graph.edges.find((edge) => edge.label === "dbColumns")?.id).toBe(
      "route-table:route:GET /api/todos:dbColumns:todos",
    );
  });

  it("does not invent edges for unknown tables or columns", () => {
    expect(graph.edges.some((edge) => edge.target === "table:ghosts")).toBe(false);
    expect(graph.edges.some((edge) => edge.source === "route:GET /api/ghosts")).toBe(false);
  });

  it("carries node data including unknown flags", () => {
    const todos = graph.nodes.find((node) => node.id === "table:todos");
    expect(todos?.data).toMatchObject({
      kind: "table",
      table: "todos",
      rlsEnabled: true,
      policies: [
        { name: "tenant_isolation", restrictive: true },
        { name: "owner_isolation", restrictive: false },
      ],
      framework: false,
      unknown: false,
    });
    const getRoute = graph.nodes.find((node) => node.id === "route:GET /api/todos");
    expect(getRoute?.data).toMatchObject({
      kind: "route",
      method: "GET",
      path: "/api/todos",
      permission: ["todos:read"],
      wrapper: "valid",
      input: { body: false, form: false, query: false, params: false },
      dbTables: ["todos"],
      dbColumns: ["todos.title"],
      description: "List the current user's todos.",
      unknown: false,
    });
    const postRoute = graph.nodes.find((node) => node.id === "route:POST /api/todos");
    expect(postRoute?.data).toMatchObject({
      kind: "route",
      input: { body: true, form: false, query: true, params: false },
    });
    const invalidRoute = graph.nodes.find((node) => node.id === "route:PATCH /api/todos/{id}");
    expect(invalidRoute?.data).toMatchObject({
      kind: "route",
      wrapper: "invalid",
      permission: [],
      unknown: true,
    });
    const page = graph.nodes.find((node) => node.id === "page:src/pages/todos.tsx");
    expect(page?.data).toMatchObject({
      kind: "page",
      pagePath: "src/pages/todos.tsx",
      pageKind: "page",
      callCount: 2,
    });
  });

  it("marks tables declared by an installed package and re-exported by the project", () => {
    // db/schema.ts re-exports users from "@facilis.dev/auth"; the analyzer follows the module
    // and collects the package's tables (users, sessions), whose source is under node_modules.
    const frameworkOf = (id: string): boolean | undefined => {
      const data = graph.nodes.find((node) => node.id === id)?.data;
      return data?.kind === "table" ? data.framework : undefined;
    };
    expect(frameworkOf("table:users")).toBe(true);
    expect(frameworkOf("table:sessions")).toBe(true);
    expect(frameworkOf("table:todos")).toBe(false);
    expect(frameworkOf("table:projects")).toBe(false);
    expect(graph.nodes.find((node) => node.id === "table:users")?.sourceFile).toBe(
      "node_modules/@facilis.dev/auth/src/index.ts",
    );
  });

  it("keeps framework tables as ordinary nodes with FK and route-table edges", () => {
    const base = fixtureInput();
    const tables: TableFact[] = base.tables.map((table) =>
      table.name === "sessions"
        ? {
            ...table,
            foreignKeys: [
              {
                columns: ["userId"],
                targetTable: "users",
                targetColumns: ["id"],
                onDelete: null,
                onUpdate: null,
                source: table.source,
              },
            ],
          }
        : table,
    );
    const routes = [...base.routes, route({ method: "GET", path: "/api/me", dbTables: ["users"] })];
    const withEdges = buildProjectGraph({ ...base, tables, routes });
    expect(withEdges.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "fk", source: "table:sessions", target: "table:users" }),
        expect.objectContaining({
          kind: "route-table",
          source: "route:GET /api/me",
          target: "table:users",
        }),
      ]),
    );
  });

  it("marks route-table edges that touch an elevated table", () => {
    const elevated = route({
      method: "POST",
      path: "/api/users",
      dbTables: ["users", "todos"],
      elevations: [
        {
          kind: "system",
          tables: ["users"],
          operation: null,
          source: ref("server/routes/api/users.post.ts"),
          unknown: [],
        },
      ],
    });
    const withElevation = buildProjectGraph({ ...fixtureInput(), routes: [elevated] });
    const edges = withElevation.edges.filter((edge) => edge.kind === "route-table");
    expect(edges.find((edge) => edge.target === "table:users")?.access).toBe("elevated");
    expect(edges.find((edge) => edge.target === "table:todos")?.access).toBeUndefined();
  });

  it("is deterministic and handles an empty project", () => {
    expect(buildProjectGraph(fixtureInput())).toEqual(graph);
    expect(
      buildProjectGraph({ routes: [], tables: [], relations: [], pages: [], views: [] }),
    ).toEqual({
      nodes: [],
      edges: [],
    });
  });
});
