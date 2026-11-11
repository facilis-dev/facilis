import { describe, expect, it } from "vitest";

import { create, rulesOf, SCHEMA, update, validate } from "./testing/fixtures.ts";

const ROUTE = "server/routes/api/";
const QUERY = "sql`select id, done from todos`";
const VIEW_SOURCE =
  'import { sql } from "drizzle-orm";\n' +
  'import { defineView } from "@facilis.dev/db";\n' +
  'import { text } from "drizzle-orm/pg-core";\n' +
  "export const activeTodos = defineView({\n" +
  '  name: "active_todos",\n' +
  '  columns: { id: text("id") },\n' +
  "  query: " +
  QUERY +
  ",\n" +
  "});\n";

const VIEW_ROUTE =
  'import { defineAuthorizedHandler } from "@facilis.dev/core";\n' +
  'import { activeTodos } from "~/db/views/active-todos";\n' +
  "export default defineAuthorizedHandler(\n" +
  '  { permission: ["todos:read"], dbTables: ["active_todos"] },\n' +
  "  async (_event, { db }) => db.select().from(activeTodos),\n" +
  ");\n";

function findings(result: { errors: readonly { rule: string; message: string }[] }): string[] {
  return result.errors
    .filter((entry) => entry.rule === "route-table-declared")
    .map((entry) => entry.message);
}

function rawRoute(config: string): string {
  return (
    'import { defineAuthorizedHandler } from "@facilis.dev/core";\n' +
    "export default defineAuthorizedHandler(\n" +
    "  { permission: [], dbTables: [], " +
    config +
    " },\n" +
    '  async (_event, { db }) => db.execute("select 1"),\n' +
    ");\n"
  );
}

describe("rule 4 db-tables-valid accepts a view (D-157)", () => {
  it("accepts the view's SQL name in dbTables", () => {
    const { result } = validate([create(ROUTE + "active.get.ts", VIEW_ROUTE)], {
      sources: { "db/views/active-todos.ts": VIEW_SOURCE },
    });
    expect(rulesOf(result.errors)).not.toContain("db-tables-valid");
    expect(rulesOf(result.errors)).not.toContain("route-table-declared");
  });
});

describe("rule 18 route-table-declared", () => {
  it("rejects a used relation that dbTables does not declare", () => {
    const route =
      'import { defineAuthorizedHandler } from "@facilis.dev/core";\n' +
      'import { notes } from "~/db/schema";\n' +
      "export default defineAuthorizedHandler(\n" +
      '  { permission: ["todos:read"], dbTables: ["todos"] },\n' +
      "  async (_event, { db }) => db.select().from(notes),\n" +
      ");\n";
    const { result } = validate([
      create(ROUTE + "notes.get.ts", route),
      update(
        "db/schema.ts",
        SCHEMA + '\nexport const notes = pgTable("notes", { id: uuid("id").primaryKey() });\n',
      ),
    ]);
    expect(findings(result).join("\n")).toContain('Relation "notes" is used through the route db');
  });

  it("warns about a declared relation the handler never uses", () => {
    const route =
      'import { defineAuthorizedHandler } from "@facilis.dev/core";\n' +
      "export default defineAuthorizedHandler(\n" +
      '  { permission: ["todos:read"], dbTables: ["todos"], description: "Unused declaration." },\n' +
      "  async () => null,\n" +
      ");\n";
    const { result } = validate([create(ROUTE + "unused.get.ts", route)]);
    const warning = result.warnings.find((entry) => entry.rule === "route-table-declared");
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toContain('"todos"');
    expect(result.ok).toBe(true);
  });

  it("rejects db.execute without rawSql: true and accepts it with the flag", () => {
    const withoutFlag = validate([create(ROUTE + "raw.get.ts", rawRoute(""))]);
    expect(findings(withoutFlag.result).join("\n")).toContain("rawSql: true");
    const withFlag = validate([create(ROUTE + "raw.get.ts", rawRoute("rawSql: true"))]);
    expect(findings(withFlag.result)).toEqual([]);
  });

  it("rejects a relation used inside an elevation outside its tables option", () => {
    const route =
      'import { defineAuthorizedHandler } from "@facilis.dev/core";\n' +
      'import { notes } from "~/db/schema";\n' +
      "export default defineAuthorizedHandler(\n" +
      '  { permission: [], dbTables: ["todos", "notes"] },\n' +
      "  async (_event, { sudo }) =>\n" +
      '    sudo({ operation: "x", reason: "y", tables: ["todos"] }, (systemDb) => systemDb.delete(notes)),\n' +
      ");\n";
    const { result } = validate([
      create(ROUTE + "elevation.post.ts", route),
      update(
        "db/schema.ts",
        SCHEMA + '\nexport const notes = pgTable("notes", { id: uuid("id").primaryKey() });\n',
      ),
    ]);
    expect(findings(result).join("\n")).toContain('"sudo" elevation');
  });

  it("catches a helper-only patch that changes an untouched route's usage", () => {
    const helper =
      'import { todos } from "~/db/schema";\n' +
      "export function listTodos(db: { select: () => { from: (relation: unknown) => unknown } }): unknown {\n" +
      "  return db.select().from(todos);\n" +
      "}\n";
    const route =
      'import { defineAuthorizedHandler } from "@facilis.dev/core";\n' +
      'import { listTodos } from "~/server/utils/db";\n' +
      "export default defineAuthorizedHandler(\n" +
      '  { permission: ["todos:read"], dbTables: ["todos"] },\n' +
      "  async (_event, { db }) => listTodos(db),\n" +
      ");\n";
    const sources = {
      "server/utils/db.ts": helper,
      "server/routes/api/todos/index.get.ts": route,
    };
    const base = validate([], { sources });
    expect(rulesOf(base.result.errors)).not.toContain("route-table-declared");
    const patchedHelper =
      'import { notes } from "~/db/schema";\n' +
      "export function listTodos(db: { select: () => { from: (relation: unknown) => unknown } }): unknown {\n" +
      "  return db.select().from(notes);\n" +
      "}\n";
    const patchedSchema =
      SCHEMA + '\nexport const notes = pgTable("notes", { id: uuid("id").primaryKey() });\n';
    const { result } = validate(
      [update("server/utils/db.ts", patchedHelper), update("db/schema.ts", patchedSchema)],
      { sources },
    );
    const finding = result.errors.find((entry) => entry.rule === "route-table-declared");
    expect(finding?.message).toContain('Relation "notes"');
    expect(finding?.file).toBe("server/utils/db.ts");
  });
});
