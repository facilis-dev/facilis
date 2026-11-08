import { describe, expect, it } from "vitest";

import { loadFixtureProject } from "../test-fixtures/load.ts";
import { buildProjectGraph, type GraphInput } from "./graph.ts";
import { createModuleGraph } from "./module-graph.ts";
import { createOxcParser } from "./node.ts";
import { buildSchemaFacts } from "./passes/schema.ts";
import type { ConfigFacts, PageFact, RouteFact, SourceRef } from "./types.ts";

const parser = createOxcParser();

function fixtureConfig(): ConfigFacts {
  return {
    parsed: true,
    source: null,
    permissions: [],
    roles: {},
    defaultRole: null,
    defaultLocale: null,
    locales: [],
    migrationsDir: "db/migrations",
    tenantColumns: ["tenantId"],
    ownerColumns: ["ownerId"],
    blocksPackages: [],
    unknown: [],
  };
}

function ref(file: string): SourceRef {
  return { file, line: 1 };
}

function route(overrides: Partial<RouteFact> & Pick<RouteFact, "method" | "path">): RouteFact {
  return {
    sourceFile: "server/routes/api/todos/index.get.ts",
    source: ref("server/routes/api/todos/index.get.ts"),
    wrapper: "valid",
    permission: ["todos:read"],
    dbTables: ["todos"],
    dbColumns: null,
    description: null,
    input: { body: false, form: false, query: false, params: false },
    handlerBodyRead: false,
    handlerFormRead: false,
    unknown: [],
    ...overrides,
  };
}

function fixtureInput(): GraphInput {
  const graph = createModuleGraph({ files: loadFixtureProject(), parser });
  const schema = buildSchemaFacts(graph, fixtureConfig());
  const pages: PageFact[] = [
    {
      path: "src/pages/todos.tsx",
      kind: "page",
      source: ref("src/pages/todos.tsx"),
      unknown: [],
      calls: [
        {
          expression: '"/api/todos"',
          kind: "literal",
          staticPrefix: "/api/todos",
          matchedRouteIds: ["route:GET /api/todos"],
          source: ref("src/pages/todos.tsx"),
          unknown: [],
        },
        {
          expression: "unknownPath",
          kind: "dynamic",
          staticPrefix: null,
          matchedRouteIds: [],
          source: ref("src/pages/todos.tsx"),
          unknown: [],
        },
      ],
    },
  ];
  const routes: RouteFact[] = [
    route({ method: "GET", path: "/api/todos", dbColumns: ["todos.title"] }),
    route({ method: "POST", path: "/api/todos" }),
    route({
      method: "PATCH",
      path: "/api/todos/{id}",
      wrapper: "invalid",
      permission: null,
      dbTables: null,
      unknown: [
        {
          code: "route-wrapper",
          reason: "raw handler",
          source: ref("server/routes/api/todos/[id].patch.ts"),
        },
      ],
    }),
    route({ method: "GET", path: "/api/ghosts", dbTables: ["ghosts"], dbColumns: ["todos.nope"] }),
  ];
  return { routes, tables: schema.tables, relations: schema.relations, pages };
}

function countByKind(input: GraphInput): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const edge of buildProjectGraph(input).edges) {
    counts[edge.kind] = (counts[edge.kind] ?? 0) + 1;
  }
  return counts;
}

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
      unknown: false,
    });
    const getRoute = graph.nodes.find((node) => node.id === "route:GET /api/todos");
    expect(getRoute?.data).toMatchObject({
      kind: "route",
      method: "GET",
      path: "/api/todos",
      permission: ["todos:read"],
      wrapper: "valid",
      dbTables: ["todos"],
      dbColumns: ["todos.title"],
      unknown: false,
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

  it("is deterministic and handles an empty project", () => {
    expect(buildProjectGraph(fixtureInput())).toEqual(graph);
    expect(buildProjectGraph({ routes: [], tables: [], relations: [], pages: [] })).toEqual({
      nodes: [],
      edges: [],
    });
  });
});
