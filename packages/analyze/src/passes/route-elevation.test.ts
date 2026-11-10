import { describe, expect, it } from "vitest";

import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import { emptyConfigFacts } from "./config.ts";
import { buildRouteFacts } from "./routes.ts";

const CORE_IMPORT = 'import { defineAuthorizedHandler } from "@facilis/core";\n';

function routesOf(files: Record<string, string>) {
  const graph = createModuleGraph({
    files: new Map(Object.entries(files)),
    parser: createOxcParser(),
  });
  return buildRouteFacts(graph, emptyConfigFacts());
}

describe("audited elevation facts", () => {
  it("reads destructured and member sudo/system calls", () => {
    const { routes } = routesOf({
      "server/routes/users.post.ts":
        CORE_IMPORT +
        'export default defineAuthorizedHandler({ permission: [], dbTables: ["users", "user_roles"] }, async (_event, { system, sudo: elevate }) => {\n' +
        '  await system({ actor: "system:auth", operation: "user:register", reason: "bootstrap", tables: ["users"] }, async (db) => db);\n' +
        '  await elevate({ operation: "roles:grant", reason: "bootstrap", tables: ["user_roles"] }, async (db) => db);\n' +
        "});",
    });
    expect(
      routes[0]?.elevations.map((entry) => ({
        kind: entry.kind,
        tables: entry.tables,
        operation: entry.operation,
      })),
    ).toEqual([
      { kind: "system", tables: ["users"], operation: "user:register" },
      { kind: "sudo", tables: ["user_roles"], operation: "roles:grant" },
    ]);
  });

  it("reads ctx.sudo member calls", () => {
    const { routes } = routesOf({
      "server/routes/users.post.ts":
        CORE_IMPORT +
        'export default defineAuthorizedHandler({ permission: [], dbTables: ["users"] }, async (_event, ctx) => {\n' +
        '  await ctx.sudo({ operation: "users:purge", reason: "admin", tables: ["users"] }, async (db) => db);\n' +
        "});",
    });
    expect(routes[0]?.elevations).toHaveLength(1);
    expect(routes[0]?.elevations[0]).toMatchObject({ kind: "sudo", tables: ["users"] });
  });

  it("keeps a dynamic tables list explicit instead of guessing", () => {
    const { routes, diagnostics } = routesOf({
      "server/routes/users.post.ts":
        CORE_IMPORT +
        'export default defineAuthorizedHandler({ permission: [], dbTables: ["users"] }, async (_event, { system }) => {\n' +
        '  await system({ actor: "system:auth", operation: "x", reason: "y", tables: loadTables() }, async (db) => db);\n' +
        "});",
    });
    expect(routes[0]?.elevations[0]).toMatchObject({ kind: "system", tables: [] });
    expect(routes[0]?.elevations[0]?.unknown.length).toBeGreaterThan(0);
    expect(diagnostics.map((entry) => entry.code)).toContain("route-elevation-static");
  });
});
