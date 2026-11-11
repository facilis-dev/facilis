import { describe, expect, it } from "vitest";

import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import { emptyConfigFacts } from "./config.ts";
import { buildRouteRelationFacts } from "./route-relations.ts";
import { buildRouteFacts } from "./routes.ts";
import { buildSchemaFacts } from "./schema.ts";
import { buildViewFacts } from "./views.ts";

const CORE = 'import { defineAuthorizedHandler } from "@facilis.dev/core";\n';
const SCHEMA =
  'import { pgTable, uuid } from "drizzle-orm/pg-core";\n' +
  'export const todos = pgTable("todos", { id: uuid("id").primaryKey() });\n' +
  'export const notes = pgTable("notes", { id: uuid("id").primaryKey() });\n';
const QUERY = "sql`select * from notes`";

function scan(routeFile: string, source: string, extra: Record<string, string> = {}) {
  const files = new Map(Object.entries({ "db/schema.ts": SCHEMA, ...extra, [routeFile]: source }));
  const graph = createModuleGraph({ files, parser: createOxcParser() });
  const config = emptyConfigFacts();
  const facts = buildRouteFacts(graph, config);
  const schema = buildSchemaFacts(graph, config);
  const views = buildViewFacts(graph);
  return {
    routeFacts: facts,
    relations: buildRouteRelationFacts(graph, facts.routes, schema.tables, views.views),
  };
}

function handler(config: string, body: string): string {
  return CORE + "export default defineAuthorizedHandler(" + config + ", " + body + ");\n";
}

function codes(diagnostics: readonly { code: string }[]): string[] {
  return diagnostics.map((entry) => entry.code).toSorted();
}

const IMPORT_TODOS = 'import { todos, notes } from "~/db/schema";\n';

describe("route relation usage (D-157)", () => {
  it("records a declared table used through the destructured client", () => {
    const { relations } = scan(
      "server/routes/api/todos.get.ts",
      IMPORT_TODOS +
        handler(
          '{ permission: [], dbTables: ["todos"] }',
          "async (_event, { db }) => db.select().from(todos)",
        ),
    );
    expect(relations.diagnostics).toEqual([]);
    expect(relations.routes[0]?.relations.used.map((use) => use.name)).toEqual(["todos"]);
  });

  it("follows a chain that starts at ctx.db and records joins", () => {
    const { relations } = scan(
      "server/routes/api/todos.get.ts",
      IMPORT_TODOS +
        handler(
          '{ permission: [], dbTables: ["todos", "notes"] }',
          "async (_event, ctx) => ctx.db.select().from(todos).innerJoin(notes, eq(todos.id, notes.id))",
        ),
    );
    expect(codes(relations.diagnostics)).toEqual([]);
    expect(relations.routes[0]?.relations.used.map((use) => use.name).toSorted()).toEqual([
      "notes",
      "todos",
    ]);
  });

  it("errors when a used relation is not declared", () => {
    const { relations } = scan(
      "server/routes/api/todos.get.ts",
      IMPORT_TODOS +
        handler(
          '{ permission: [], dbTables: ["todos"] }',
          "async (_event, { db }) => db.select().from(notes)",
        ),
    );
    expect(codes(relations.diagnostics)).toContain("route-table-undeclared");
    expect(relations.diagnostics[0]?.severity).toBe("error");
    expect(relations.diagnostics[0]?.message).toContain('"notes"');
  });

  it("records insert, update, delete and the relational query API", () => {
    const { relations } = scan(
      "server/routes/api/todos.post.ts",
      IMPORT_TODOS +
        handler(
          '{ permission: [], dbTables: ["todos", "notes"] }',
          "async (_event, { db }) => {\n" +
            "  await db.insert(todos).values({});\n" +
            "  await db.update(notes).set({});\n" +
            "  await db.delete(todos);\n" +
            "  return db.query.notes.findMany();\n" +
            "}",
        ),
    );
    expect(codes(relations.diagnostics)).toEqual([]);
    expect(relations.routes[0]?.relations.used.map((use) => use.name)).toEqual(["todos", "notes"]);
  });

  it("reports a dynamic relation as unresolved, never as a guess", () => {
    const { relations } = scan(
      "server/routes/api/todos.get.ts",
      CORE +
        handler(
          "{ permission: [], dbTables: [] }",
          "async (_event, { db }) => db.select().from(loadTable())",
        ) +
        "function loadTable(): unknown { return null; }\n",
    );
    expect(codes(relations.diagnostics)).toContain("route-table-unresolved");
    expect(
      relations.diagnostics.find((entry) => entry.code === "route-table-unresolved")?.severity,
    ).toBe("error");
  });

  it("requires rawSql: true for db.execute and suppresses the unused warning then", () => {
    const source = handler(
      '{ permission: [], dbTables: ["todos"] }',
      "async (_event, { db }) => db.execute(" + JSON.stringify(QUERY) + ")",
    );
    const withoutFlag = scan("server/routes/api/raw.get.ts", source);
    expect(codes(withoutFlag.relations.diagnostics)).toEqual(["route-raw-sql"]);
    const withFlag = scan(
      "server/routes/api/raw.get.ts",
      IMPORT_TODOS.replace("todos, notes", "todos") +
        handler(
          '{ permission: [], dbTables: ["todos"], rawSql: true }',
          "async (_event, { db }) => db.execute(" + JSON.stringify(QUERY) + ")",
        ),
    );
    expect(codes(withFlag.relations.diagnostics)).toEqual([]);
    expect(withFlag.routeFacts.routes[0]?.rawSql).toBe(true);
  });

  it("warns about a declared relation the route never uses", () => {
    const { relations } = scan(
      "server/routes/api/todos.get.ts",
      IMPORT_TODOS + handler('{ permission: [], dbTables: ["todos"] }', "async () => null"),
    );
    expect(codes(relations.diagnostics)).toEqual(["route-table-unused"]);
    expect(relations.diagnostics[0]?.severity).toBe("warning");
  });

  it("suppresses the unused warning when a package helper receives the client", () => {
    const { relations } = scan(
      "server/routes/api/todos.post.ts",
      'import { destroySession } from "@facilis.dev/auth";\n' +
        handler(
          '{ permission: [], dbTables: ["todos"] }',
          'async (_event, { db }) => destroySession(db, "session-id")',
        ),
    );
    expect(codes(relations.diagnostics)).toEqual([]);
  });

  it("follows a project-local helper with the db client as argument", () => {
    const { relations } = scan(
      "server/routes/api/todos.get.ts",
      CORE +
        handler(
          '{ permission: [], dbTables: ["todos"] }',
          "async (_event, { db }) => loadNotes(db)",
        ) +
        'import { notes } from "~/db/schema";\n' +
        "function loadNotes(client: unknown): unknown {\n" +
        "  return (client as { select: () => { from: (relation: unknown) => unknown } }).select().from(notes);\n" +
        "}\n",
    );
    expect(codes(relations.diagnostics)).toContain("route-table-undeclared");
    expect(
      relations.diagnostics.find((entry) => entry.code === "route-table-undeclared")?.source?.file,
    ).toBe("server/routes/api/todos.get.ts");
  });

  it("checks elevation usage against the elevation tables option", () => {
    const { relations } = scan(
      "server/routes/api/todos.post.ts",
      IMPORT_TODOS +
        handler(
          '{ permission: [], dbTables: ["todos", "notes"] }',
          "async (_event, { db, sudo }) => {\n" +
            "  await db.select().from(todos);\n" +
            '  return sudo({ operation: "x", reason: "y", tables: ["todos"] }, ' +
            "(systemDb) => systemDb.delete(notes));\n" +
            "}",
        ),
    );
    expect(codes(relations.diagnostics)).toEqual(["route-elevation-undeclared"]);
    expect(relations.routes[0]?.relations.elevations[0]).toMatchObject({
      kind: "sudo",
      tables: ["todos"],
      tablesUnknown: false,
    });
  });

  it("keeps a dynamic elevation tables option unknown instead of guessing", () => {
    const { relations } = scan(
      "server/routes/api/todos.post.ts",
      IMPORT_TODOS +
        handler(
          '{ permission: [], dbTables: ["todos", "notes"] }',
          'async (_event, { system }) => system({ actor: "system:x", operation: "x", reason: "y", tables: loadTables() }, ' +
            "(systemDb) => systemDb.delete(notes))",
        ) +
        "function loadTables(): unknown { return []; }\n",
    );
    expect(codes(relations.diagnostics)).toEqual([]);
    expect(relations.routes[0]?.relations.elevations[0]?.tablesUnknown).toBe(true);
  });

  it("resolves a view declared under db/views as a relation", () => {
    const view =
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
    const { relations } = scan(
      "server/routes/api/active.get.ts",
      'import { activeTodos } from "~/db/views/active-todos";\n' +
        handler(
          '{ permission: [], dbTables: ["active_todos"] }',
          "async (_event, { db }) => db.select().from(activeTodos)",
        ),
      { "db/views/active-todos.ts": view },
    );
    expect(codes(relations.diagnostics)).toEqual([]);
    expect(relations.routes[0]?.relations.used.map((use) => use.name)).toEqual(["active_todos"]);
  });

  it("terminates on a recursive helper with a db client", () => {
    const { relations } = scan(
      "server/routes/api/todos.get.ts",
      IMPORT_TODOS +
        handler(
          '{ permission: [], dbTables: ["todos"] }',
          "async (_event, { db }) => walk(db, 3)",
        ) +
        "function walk(client: { select: () => { from: (relation: unknown) => unknown } }, depth: number): unknown {\n" +
        "  return depth > 0 ? walk(client, depth - 1) : client.select().from(todos);\n" +
        "}\n",
    );
    expect(codes(relations.diagnostics)).toEqual([]);
  });
});
