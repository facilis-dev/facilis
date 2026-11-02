import { describe, expect, it } from "vitest";
import type { ApiFlowData, ApiMethod, ApiOperation } from "./api-flow-client";
import { buildApiFlowGraph } from "./api-flow-model";

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

function route(graph: ReturnType<typeof buildApiFlowGraph>, method: string, path: string) {
  const id = "route:" + method + " " + path;
  const found = graph.routes.find((node) => node.id === id);
  if (found === undefined) throw new Error(id + " missing from the graph");
  return found;
}

describe("buildApiFlowGraph", () => {
  it("groups routes by the first segment after /api, ungrouped routes in root", () => {
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
    expect(route(graph, "POST", "/api").data.resource).toBe("root");
  });

  it("lays resources out in columns and routes in rows", () => {
    const graph = buildApiFlowGraph(data());
    const rootFirst = route(graph, "POST", "/api").position;
    const rootSecond = route(graph, "GET", "/health").position;
    const todos = route(graph, "GET", "/api/todos").position;
    const users = route(graph, "GET", "/api/users").position;
    expect(rootFirst).toEqual({ x: 0, y: 0 });
    expect(rootSecond.x).toBe(rootFirst.x);
    expect(rootSecond.y).toBeGreaterThan(rootFirst.y);
    expect(todos.x).toBeGreaterThan(rootFirst.x);
    expect(users.x).toBeGreaterThan(todos.x);
    expect(route(graph, "POST", "/api/todos").position.x).toBe(todos.x);
    expect(route(graph, "POST", "/api/todos").position.y).toBeGreaterThan(todos.y);
  });

  it("puts every table in one column to the right of the route columns", () => {
    const graph = buildApiFlowGraph(data());
    const rightmostRoute = Math.max(...graph.routes.map((node) => node.position.x));
    expect(graph.tables.map((node) => node.id)).toEqual(["table:todos", "table:users"]);
    for (const table of graph.tables) expect(table.position.x).toBeGreaterThan(rightmostRoute);
    expect(graph.tables[0]?.position).toEqual({ x: graph.tables[0]?.position.x, y: 0 });
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
    expect(route(graph, "GET", "/api/todos").data.tableCount).toBe(1);
  });

  it("counts routes, tables, edges and the methods", () => {
    const graph = buildApiFlowGraph(data());
    expect(graph.stats).toEqual({
      routes: 7,
      tables: 2,
      edges: 5,
      byMethod: { GET: 4, POST: 2, PUT: 0, PATCH: 1, DELETE: 0 },
    });
  });

  it("is deterministic for the same operations in a different order", () => {
    const forward = buildApiFlowGraph(data());
    const reversed = buildApiFlowGraph(data(OPERATIONS.toReversed()));
    expect(reversed).toEqual(forward);
  });

  it("carries the facade warnings and flags an unavailable OpenAPI document", () => {
    const graph = buildApiFlowGraph({
      operations: [],
      warnings: [{ code: "openapi-unavailable", message: "no spec" }],
    });
    expect(graph.stats.routes).toBe(0);
    expect(graph.warnings).toHaveLength(1);
    expect(graph.openapiUnavailable).toBe(true);
  });
});
