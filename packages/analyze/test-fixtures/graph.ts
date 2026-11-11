// Shared fixtures for the project-graph tests, split out of graph.test.ts so both the base
// tests and the view tests stay under the 300-line source limit. Not a test file itself.
import { loadFixtureProject } from "./load.ts";
import { buildProjectGraph, type GraphInput } from "../src/graph.ts";
import { createModuleGraph } from "../src/module-graph.ts";
import { createOxcParser } from "../src/node.ts";
import { buildSchemaFacts } from "../src/passes/schema.ts";
import { EMPTY_ROUTE_RELATIONS } from "../src/types-relations.ts";
import type { ConfigFacts, PageFact, RouteFact, SourceRef, ViewFact } from "../src/types.ts";

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
    unknown: [],
  };
}

export function ref(file: string): SourceRef {
  return { file, line: 1 };
}

export function view(overrides: Partial<ViewFact> & Pick<ViewFact, "name">): ViewFact {
  return {
    binding: null,
    tables: [],
    permission: null,
    access: "invoker",
    source: ref("db/views/" + overrides.name + ".ts"),
    unknown: [],
    ...overrides,
  };
}

export function route(
  overrides: Partial<RouteFact> & Pick<RouteFact, "method" | "path">,
): RouteFact {
  return {
    sourceFile: "server/routes/api/todos/index.get.ts",
    source: ref("server/routes/api/todos/index.get.ts"),
    wrapper: "valid",
    permission: ["todos:read"],
    crossSite: false,
    dbTables: ["todos"],
    dbColumns: null,
    rawSql: false,
    relations: EMPTY_ROUTE_RELATIONS,
    description: null,
    input: { body: false, form: false, query: false, params: false },
    handlerBodyRead: false,
    handlerFormRead: false,
    elevations: [],
    unknown: [],
    ...overrides,
  };
}

export function fixtureInput(): GraphInput {
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
    route({
      method: "GET",
      path: "/api/todos",
      dbColumns: ["todos.title"],
      description: "List the current user's todos.",
    }),
    route({
      method: "POST",
      path: "/api/todos",
      input: { body: true, form: false, query: true, params: false },
    }),
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
  return { routes, tables: schema.tables, relations: schema.relations, pages, views: [] };
}

export function countByKind(input: GraphInput): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const edge of buildProjectGraph(input).edges) {
    counts[edge.kind] = (counts[edge.kind] ?? 0) + 1;
  }
  return counts;
}
