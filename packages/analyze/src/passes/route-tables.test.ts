import { describe, expect, it } from "vitest";

import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import { emptyConfigFacts } from "./config.ts";
import { routeSystemTableDiagnostics } from "./route-tables.ts";
import { buildRouteFacts } from "./routes.ts";
import { buildSchemaFacts } from "./schema.ts";

const parser = createOxcParser();

const SCHEMA = `import { pgTable, text, uuid } from "drizzle-orm/pg-core";

export const todos = pgTable("todos", {
  id: uuid("id").primaryKey(),
}).enableRLS();

export const roles = pgTable("roles", {
  name: text("name").primaryKey(),
});
`;

const CORE_IMPORT = 'import { defineAuthorizedHandler } from "@facilis.dev/core";\n';

function diagnosticsOf(routeFile: string) {
  const graph = createModuleGraph({
    files: new Map([
      ["db/schema.ts", SCHEMA],
      ["server/routes/users.post.ts", routeFile],
    ]),
    parser,
  });
  const config = emptyConfigFacts();
  const schema = buildSchemaFacts(graph, config);
  const routes = buildRouteFacts(graph, config);
  expect(schema.tables.map((table) => table.name).sort()).toEqual(["roles", "todos"]);
  return routeSystemTableDiagnostics(routes.routes, schema.tables);
}

describe("routeSystemTableDiagnostics", () => {
  it("warns when a route declares a system-only table", () => {
    const diagnostics = diagnosticsOf(
      CORE_IMPORT +
        'export default defineAuthorizedHandler({ permission: [], dbTables: ["todos", "roles"] }, async () => null);\n',
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: "route-system-table", severity: "warning" });
    expect(diagnostics[0]?.message).toContain('"roles"');
  });

  it("accepts a system-only table reached through an audited elevation", () => {
    const diagnostics = diagnosticsOf(
      CORE_IMPORT +
        'export default defineAuthorizedHandler({ permission: [], dbTables: ["todos", "roles"] }, async (_event, { system }) => {\n' +
        '  await system({ actor: "system:auth", operation: "roles:read", reason: "bootstrap", tables: ["roles"] }, async (db) => db);\n' +
        "});\n",
    );
    expect(diagnostics).toEqual([]);
  });

  it("reads the table side of dbColumns too", () => {
    const diagnostics = diagnosticsOf(
      CORE_IMPORT +
        'export default defineAuthorizedHandler({ permission: [], dbTables: ["todos"], dbColumns: ["roles.name"] }, async () => null);\n',
    );
    expect(diagnostics.map((entry) => entry.code)).toEqual(["route-system-table"]);
  });

  it("stays quiet about a table it does not know (db-tables-known owns that)", () => {
    const diagnostics = diagnosticsOf(
      CORE_IMPORT +
        'export default defineAuthorizedHandler({ permission: [], dbTables: ["ghosts"] }, async () => null);\n',
    );
    expect(diagnostics).toEqual([]);
  });
});
