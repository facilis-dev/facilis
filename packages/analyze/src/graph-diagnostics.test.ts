// The analyzer's lens facts (D-212, #189): every code, its structured params and a clean case.
// The graph is built from the same facts fixture the graph tests use, so ids stay identical.

import { describe, expect, it } from "vitest";
import { buildProjectGraph } from "./graph.ts";
import { buildGraphDiagnostics, type GraphDiagnostic } from "./graph-diagnostics.ts";
import { fixtureInput, ref, route } from "../test-fixtures/graph.ts";
import type { TableFact } from "./types.ts";

function diagnosticsOf(
  routes: Parameters<typeof route>[0][],
  tables: readonly TableFact[] = fixtureInput().tables,
  base = fixtureInput(),
): readonly GraphDiagnostic[] {
  const facts = routes.map((entry) => route(entry));
  const graph = buildProjectGraph({ ...base, routes: facts, tables });
  return buildGraphDiagnostics({ graph, routes: facts, tables });
}

function codesOf(diagnostics: readonly GraphDiagnostic[]): string[] {
  return diagnostics.map((entry) => entry.code);
}

describe("buildGraphDiagnostics", () => {
  it("emits no diagnostics for a clean project", () => {
    const base = fixtureInput();
    const facts = [
      route({ method: "GET", path: "/api/todos", permission: ["todos:read"], dbTables: ["todos"] }),
    ];
    const graph = buildProjectGraph({ ...base, routes: facts });
    expect(buildGraphDiagnostics({ graph, routes: facts, tables: base.tables })).toEqual([]);
  });

  it("flags a public route that writes, with the method as a param", () => {
    const diagnostics = diagnosticsOf([{ method: "POST", path: "/api/todos", permission: [] }]);
    expect(diagnostics).toEqual([
      { nodeId: "route:POST /api/todos", code: "publicWrite", params: { method: "POST" } },
    ]);
  });

  it("does not flag a public read", () => {
    expect(codesOf(diagnosticsOf([{ method: "GET", path: "/api/todos", permission: [] }]))).toEqual(
      [],
    );
  });

  it("flags a public route that exposes /admin", () => {
    const diagnostics = diagnosticsOf([
      { method: "GET", path: "/api/admin/users", permission: [] },
    ]);
    expect(diagnostics).toEqual([
      { nodeId: "route:GET /api/admin/users", code: "publicAdmin", params: {} },
    ]);
  });

  it("does not flag an admin path that requires a permission", () => {
    expect(
      codesOf(diagnosticsOf([{ method: "GET", path: "/api/admin/users", permission: ["a"] }])),
    ).toEqual([]);
  });

  it("flags a project-owned table without RLS, with the table as a param", () => {
    const base = fixtureInput();
    const tables = base.tables.map((table) =>
      table.name === "todos" ? { ...table, rlsEnabled: false } : table,
    );
    const diagnostics = diagnosticsOf([], tables, base);
    expect(diagnostics).toContainEqual({
      nodeId: "table:todos",
      code: "tableNoRls",
      params: { table: "todos" },
    });
  });

  it("never flags a framework table's missing RLS", () => {
    const base = fixtureInput();
    const tables = base.tables.map((table) =>
      table.name === "users" ? { ...table, rlsEnabled: false } : table,
    );
    expect(codesOf(diagnosticsOf([], tables, base))).not.toContain("tableNoRls");
  });

  it("flags a route that touches data through sudo/system elevation", () => {
    const diagnostics = diagnosticsOf([
      {
        method: "GET",
        path: "/api/system/users",
        elevations: [
          {
            kind: "sudo",
            tables: ["users"],
            operation: null,
            source: ref("server/routes/api/system/users.get.ts"),
            unknown: [],
          },
        ],
      },
    ]);
    expect(diagnostics).toContainEqual({
      nodeId: "route:GET /api/system/users",
      code: "elevated",
      params: {},
    });
  });

  it("flags a node referenced by two other domains, with count and sorted domains", () => {
    const base = fixtureInput();
    const routes = [
      route({
        method: "GET",
        path: "/todos",
        sourceFile: "server/routes/todos/index.get.ts",
        source: ref("server/routes/todos/index.get.ts"),
        dbTables: ["projects"],
        dbColumns: [],
      }),
      route({
        method: "GET",
        path: "/billing",
        sourceFile: "server/routes/billing/index.get.ts",
        source: ref("server/routes/billing/index.get.ts"),
        dbTables: ["projects"],
        dbColumns: [],
      }),
      route({
        method: "GET",
        path: "/reports",
        sourceFile: "server/routes/reports/index.get.ts",
        source: ref("server/routes/reports/index.get.ts"),
        dbTables: ["projects"],
        dbColumns: [],
      }),
    ];
    const graph = buildProjectGraph({ ...base, routes });
    const diagnostics = buildGraphDiagnostics({ graph, routes, tables: base.tables }).filter(
      (entry) => entry.code === "shared",
    );
    expect(diagnostics).toEqual([
      {
        nodeId: "table:projects",
        code: "shared",
        params: { count: 2, domains: ["reports", "todos"] },
      },
    ]);
  });

  it("flags declarations the analyzer could not read", () => {
    const diagnostics = diagnosticsOf([
      {
        method: "PATCH",
        path: "/api/todos/{id}",
        wrapper: "invalid",
        permission: null,
        dbTables: null,
        unknown: [
          { code: "route-wrapper", reason: "raw handler", source: ref("server/routes/x.ts") },
        ],
      },
    ]);
    expect(diagnostics).toContainEqual({
      nodeId: "route:PATCH /api/todos/{id}",
      code: "unknown",
      params: {},
    });
  });
});
