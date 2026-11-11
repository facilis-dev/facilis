import { describe, expect, it } from "vitest";

import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import type { Diagnostic } from "../types.ts";
import { emptyConfigFacts } from "./config.ts";
import { buildJobRelationFacts } from "./job-relations.ts";
import { buildJobFacts } from "./jobs.ts";
import { buildSchemaFacts } from "./schema.ts";
import { buildViewFacts } from "./views.ts";

const parser = createOxcParser();
const CORE = 'import { defineJob } from "@facilis/core";\n';
const SCHEMA =
  'import { pgTable, uuid } from "drizzle-orm/pg-core";\n' +
  'export const todos = pgTable("todos", { id: uuid("id").primaryKey() });\n' +
  'export const notes = pgTable("notes", { id: uuid("id").primaryKey() });\n';
const QUERY = "sql`select * from notes`";
const IMPORT = 'import { todos, notes } from "~/db/schema";\n';

function scan(jobSource: string, extra: Record<string, string> = {}) {
  const files = new Map(
    Object.entries({ "db/schema.ts": SCHEMA, "server/jobs/purge.ts": jobSource, ...extra }),
  );
  const graph = createModuleGraph({ files, parser });
  const jobs = buildJobFacts(graph);
  const schema = buildSchemaFacts(graph, emptyConfigFacts());
  const views = buildViewFacts(graph);
  return {
    jobs,
    relations: buildJobRelationFacts(graph, jobs.jobs, schema.tables, views.views),
  };
}

/** A full definition; `fields` are the definition fields except `run`. */
function job(fields: string, run: string): string {
  return CORE + "export default defineJob({ " + fields + ", run: " + run + " });\n";
}

function codes(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((entry) => entry.code).toSorted();
}

describe("job relation usage (D-157 applied to jobs)", () => {
  it("records a declared relation used through the destructured db client", () => {
    const { relations } = scan(
      IMPORT + job('name: "purge", dbTables: ["todos"]', "async ({ db }) => db.delete(todos)"),
    );
    expect(codes(relations.diagnostics)).toEqual([]);
    expect(relations.relations["purge"]?.used.map((use) => use.name)).toEqual(["todos"]);
  });

  it("seeds the first parameter when run takes the whole context", () => {
    const { relations } = scan(
      IMPORT + job('name: "purge", dbTables: ["todos"]', "async (ctx) => ctx.db.delete(todos)"),
    );
    expect(codes(relations.diagnostics)).toEqual([]);
    expect(relations.relations["purge"]?.used.map((use) => use.name)).toEqual(["todos"]);
  });

  it("errors when a used relation is not declared", () => {
    const { relations } = scan(
      IMPORT + job('name: "purge", dbTables: ["todos"]', "async ({ db }) => db.delete(notes)"),
    );
    expect(codes(relations.diagnostics)).toContain("job-table-undeclared");
    const diagnostic = relations.diagnostics.find((entry) => entry.code === "job-table-undeclared");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.message).toContain('"notes"');
    expect(relations.relations["purge"]?.used.map((use) => use.name)).toEqual(["notes"]);
  });

  it("warns about a declared relation the job never uses", () => {
    const { relations } = scan(
      IMPORT + job('name: "purge", dbTables: ["todos"]', "async () => null"),
    );
    expect(codes(relations.diagnostics)).toEqual(["job-table-unused"]);
    expect(relations.diagnostics[0]?.severity).toBe("warning");
  });

  it("requires rawSql: true for db.execute and suppresses the unused warning then", () => {
    const withoutFlag = scan(
      IMPORT +
        job(
          'name: "purge", dbTables: ["todos"]',
          "async ({ db }) => db.execute(" + JSON.stringify(QUERY) + ")",
        ),
    );
    expect(codes(withoutFlag.relations.diagnostics)).toEqual(["job-raw-sql"]);
    const withFlag = scan(
      IMPORT +
        job(
          'name: "purge", dbTables: ["todos"], rawSql: true',
          "async ({ db }) => db.execute(" + JSON.stringify(QUERY) + ")",
        ),
    );
    expect(codes(withFlag.relations.diagnostics)).toEqual([]);
  });

  it("fails closed when rawSql itself cannot be read", () => {
    const { relations } = scan(
      IMPORT +
        job(
          'name: "purge", dbTables: ["todos"], rawSql: flag()',
          "async ({ db }) => db.execute(" + JSON.stringify(QUERY) + ")",
        ) +
        "function flag(): boolean { return true; }\n",
    );
    expect(codes(relations.diagnostics)).toEqual(["job-raw-sql"]);
  });

  it("reports a dynamic relation as unresolved, never as a guess", () => {
    const { relations } = scan(
      CORE +
        job('name: "purge", dbTables: []', "async ({ db }) => db.select().from(loadTable())") +
        "function loadTable(): unknown { return null; }\n",
    );
    expect(codes(relations.diagnostics)).toContain("job-table-unresolved");
    expect(
      relations.diagnostics.find((entry) => entry.code === "job-table-unresolved")?.severity,
    ).toBe("error");
  });

  it("follows a project-local helper with the db client as argument", () => {
    const { relations } = scan(
      IMPORT +
        job('name: "purge", dbTables: ["todos"]', "async ({ db }) => deleteAll(db)") +
        "function deleteAll(client: { delete: (relation: unknown) => unknown }): unknown {\n" +
        "  return client.delete(todos);\n" +
        "}\n",
    );
    expect(codes(relations.diagnostics)).toEqual([]);
    expect(relations.relations["purge"]?.used.map((use) => use.name)).toEqual(["todos"]);
  });

  it("resolves a view declared under db/views as a relation", () => {
    const view =
      'import { sql } from "drizzle-orm";\n' +
      'import { defineView } from "@facilis/db";\n' +
      'import { text } from "drizzle-orm/pg-core";\n' +
      "export const activeTodos = defineView({\n" +
      '  name: "active_todos",\n' +
      '  columns: { id: text("id") },\n' +
      "  query: " +
      QUERY +
      ",\n" +
      "});\n";
    const { relations } = scan(
      'import { activeTodos } from "~/db/views/active-todos";\n' +
        job(
          'name: "purge", dbTables: ["active_todos"]',
          "async ({ db }) => db.select().from(activeTodos)",
        ),
      { "db/views/active-todos.ts": view },
    );
    expect(codes(relations.diagnostics)).toEqual([]);
    expect(relations.relations["purge"]?.used.map((use) => use.name)).toEqual(["active_todos"]);
  });

  it("keeps a package helper opaque so the unused warning is suppressed", () => {
    const { relations } = scan(
      'import { destroySession } from "@facilis/auth";\n' +
        job('name: "purge", dbTables: ["todos"]', 'async ({ db }) => destroySession(db, "id")'),
    );
    expect(codes(relations.diagnostics)).toEqual([]);
    expect(relations.relations["purge"]?.opaque).toBe(true);
  });

  it("leaves an unscannable run explicitly empty instead of guessing", () => {
    const { relations } = scan(
      CORE + 'export default defineJob({ name: "purge", dbTables: ["todos"], run: handler });\n',
    );
    expect(codes(relations.diagnostics)).toEqual([]);
    expect(relations.relations["purge"]?.used).toEqual([]);
  });
});
