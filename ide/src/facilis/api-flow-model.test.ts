import { describe, expect, it } from "vitest";
import type { ApiFlowConsumers } from "./api-flow-consumers";
import type { ApiFlowData, ApiMethod, ApiOperation } from "./api-flow-client";
import { FLOW_NODE_SIZE, buildApiFlowGraph } from "./api-flow-model";

function operation(
  method: ApiMethod,
  path: string,
  metadata: Partial<Pick<ApiOperation, "dbTables" | "dbColumns" | "sourceFile">> = {},
): ApiOperation {
  return {
    method,
    path,
    summary: null,
    description: null,
    permission: [],
    dbTables: metadata.dbTables ?? [],
    dbColumns: metadata.dbColumns ?? [],
    sourceFile: metadata.sourceFile ?? null,
    warnings: [],
  };
}

const OPERATIONS: ApiOperation[] = [
  operation("GET", "/api/todos", { dbTables: ["todos"], dbColumns: ["todos.title"] }),
  operation("POST", "/api/todos", { dbTables: ["todos"] }),
  operation("GET", "/api/todos/{id}", { dbColumns: ["todos.id"] }),
  operation("GET", "/api/users", { dbTables: ["users"] }),
  operation("PATCH", "/api/users", { dbColumns: ["users.name"] }),
  operation("GET", "/health"),
  operation("POST", "/api"),
];

function data(operations: ApiOperation[] = OPERATIONS): ApiFlowData {
  return { operations, warnings: [] };
}

function consumers(): ApiFlowConsumers {
  return {
    byRoute: {
      "route:GET /api/todos": [
        { path: "src/pages/todos.tsx", kind: "page", via: "src/lib/api.ts" },
        { path: "src/lib/api.ts", kind: "lib", via: null },
      ],
      "route:POST /api/todos": [
        { path: "src/pages/todos.tsx", kind: "page", via: "src/lib/api.ts" },
      ],
    },
    unusedRoutes: [],
  };
}

function route(graph: ReturnType<typeof buildApiFlowGraph>, method: string, path: string) {
  const id = "route:" + method + " " + path;
  const found = graph.routes.find((node) => node.id === id);
  if (found === undefined) throw new Error(id + " missing from the graph");
  return found;
}

describe("buildApiFlowGraph", () => {
  it("keeps the resource/route ordering of the OpenAPI operations", () => {
    const graph = buildApiFlowGraph(data());
    expect(graph.routes.map((node) => node.id)).toEqual([
      "route:POST /api",
      "route:GET /health",
      "route:GET /api/todos",
      "route:POST /api/todos",
      "route:GET /api/todos/{id}",
      "route:GET /api/users",
      "route:PATCH /api/users",
    ]);
    expect(route(graph, "GET", "/api/todos").data.resource).toBe("todos");
    expect(route(graph, "GET", "/health").data.resource).toBe("root");
  });

  it("lays pages, routes and tables out in three separated columns", () => {
    const graph = buildApiFlowGraph(data(), consumers());
    const page = graph.pages[0];
    const firstRoute = route(graph, "POST", "/api").position;
    const rightmostRoute = Math.max(...graph.routes.map((node) => node.position.x));
    const table = graph.tables[0];
    expect(page?.position.x).toBe(0);
    expect(firstRoute.x).toBeGreaterThan(FLOW_NODE_SIZE.page.width);
    expect(table?.position.x).toBeGreaterThan(rightmostRoute + FLOW_NODE_SIZE.route.width);
    // Routes in the same resource lane stack downwards.
    expect(route(graph, "POST", "/api/todos").position.y).toBeGreaterThan(
      route(graph, "GET", "/api/todos").position.y,
    );
  });

  it("never overlaps two node rectangles", () => {
    // Many more routes than a single lane fits, so the multi-lane layout is exercised.
    const operations = Array.from({ length: 26 }, (_, index) =>
      operation("GET", "/api/resource-" + Math.floor(index / 7) + "/item-" + index),
    );
    const graph = buildApiFlowGraph(data(operations), consumers());
    const rects = [
      ...graph.pages.map((node) => ({ ...node.position, ...FLOW_NODE_SIZE.page })),
      ...graph.routes.map((node) => ({ ...node.position, ...FLOW_NODE_SIZE.route })),
      ...graph.tables.map((node) => ({ ...node.position, ...FLOW_NODE_SIZE.table })),
    ];
    for (let left = 0; left < rects.length; left += 1) {
      for (let right = left + 1; right < rects.length; right += 1) {
        const a = rects[left];
        const b = rects[right];
        if (a === undefined || b === undefined) continue;
        const overlaps =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("builds one page node per client file and a consumer edge per route", () => {
    const graph = buildApiFlowGraph(data(), consumers());
    expect(graph.pages.map((node) => node.id)).toEqual([
      "page:src/pages/todos.tsx",
      "page:src/lib/api.ts",
    ]);
    expect(graph.pages[0]?.data).toEqual({
      path: "src/pages/todos.tsx",
      kind: "page",
      via: "src/lib/api.ts",
      routeCount: 2,
    });
    const pageEdges = graph.edges.filter((edge) => edge.source.startsWith("page:"));
    expect(pageEdges.map((edge) => edge.id)).toEqual([
      "edge:page:src/pages/todos.tsx->route:GET /api/todos",
      "edge:page:src/lib/api.ts->route:GET /api/todos",
      "edge:page:src/pages/todos.tsx->route:POST /api/todos",
    ]);
    expect(pageEdges.find((edge) => edge.source === "page:src/lib/api.ts")?.dashed).toBe(false);
    expect(pageEdges.find((edge) => edge.source === "page:src/pages/todos.tsx")?.dashed).toBe(true);
    expect(graph.stats.pages).toBe(2);
  });

  it("carries the consumers on the route node for the inspector", () => {
    const graph = buildApiFlowGraph(data(), consumers());
    expect(route(graph, "GET", "/api/todos").data.consumers).toHaveLength(2);
    expect(route(graph, "GET", "/api/users").data.consumers).toEqual([]);
  });

  it("puts every table in one column to the right of the routes", () => {
    const graph = buildApiFlowGraph(data());
    expect(graph.tables.map((node) => node.id)).toEqual(["table:todos", "table:users"]);
    expect(graph.tables[0]?.position.y).toBe(0);
    expect(graph.tables[0]?.data).toEqual({ name: "todos", columnCount: 2, routeCount: 3 });
    expect(graph.tables[1]?.data).toEqual({ name: "users", columnCount: 1, routeCount: 2 });
  });

  it("links routes to tables through dbTables and dbColumns without duplicates", () => {
    const graph = buildApiFlowGraph(data());
    expect(graph.edges.map((edge) => edge.id)).toEqual([
      "edge:route:GET /api/todos->table:todos",
      "edge:route:POST /api/todos->table:todos",
      "edge:route:GET /api/todos/{id}->table:todos",
      "edge:route:GET /api/users->table:users",
      "edge:route:PATCH /api/users->table:users",
    ]);
    expect(graph.edges.find((edge) => edge.source === "route:GET /api/todos")?.dashed).toBe(false);
    expect(graph.edges.find((edge) => edge.source === "route:GET /api/todos/{id}")?.dashed).toBe(
      true,
    );
    expect(route(graph, "GET", "/health").data.tableCount).toBe(0);
  });

  it("counts routes, tables, pages, edges and the methods", () => {
    const graph = buildApiFlowGraph(data(), consumers());
    expect(graph.stats).toEqual({
      routes: 7,
      tables: 2,
      pages: 2,
      edges: 8,
      byMethod: { GET: 4, POST: 2, PUT: 0, PATCH: 1, DELETE: 0 },
    });
  });

  it("is deterministic for the same input in a different order", () => {
    const forward = buildApiFlowGraph(data(), consumers());
    const reversed = buildApiFlowGraph(data(OPERATIONS.toReversed()), consumers());
    expect(reversed).toEqual(forward);
  });

  it("carries the facade warnings and flags an unavailable OpenAPI document", () => {
    const graph = buildApiFlowGraph({
      operations: [],
      warnings: [{ code: "openapi-unavailable", message: "no spec" }],
    });
    expect(graph.stats).toEqual({
      routes: 0,
      tables: 0,
      pages: 0,
      edges: 0,
      byMethod: { GET: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0 },
    });
    expect(graph.warnings).toHaveLength(1);
    expect(graph.openapiUnavailable).toBe(true);
  });
});
