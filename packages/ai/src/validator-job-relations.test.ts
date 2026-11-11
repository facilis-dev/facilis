import { describe, expect, it } from "vitest";

import { create, rulesOf, SCHEMA, update, validate } from "./testing/fixtures.ts";

const JOBS = "server/jobs/";
const RULE = "job-table-declared";
const CORE = 'import { defineJob } from "@facilis/core";\n';

const NOTES_SCHEMA =
  SCHEMA + '\nexport const notes = pgTable("notes", { id: uuid("id").primaryKey() });\n';

function job(fields: string, run: string): string {
  return CORE + "export default defineJob({ " + fields + ", run: " + run + " });\n";
}

function findings(result: { errors: readonly { rule: string; message: string }[] }): string[] {
  return result.errors.filter((entry) => entry.rule === RULE).map((entry) => entry.message);
}

function ruleWarnings(result: {
  warnings: readonly { rule: string; severity: string; message: string }[];
}) {
  return result.warnings.filter((entry) => entry.rule === RULE);
}

describe("rule 19 job-table-declared", () => {
  it("accepts a job that declares and uses its relation", () => {
    const content =
      CORE +
      'import { todos } from "~/db/schema";\n' +
      "export default defineJob({\n" +
      '  name: "purge-todos",\n' +
      '  dbTables: ["todos"],\n' +
      "  run: async ({ db }) => db.delete(todos),\n" +
      "});\n";
    const { result } = validate([create(JOBS + "purge-todos.ts", content)]);
    expect(result.errors.filter((entry) => entry.rule === RULE)).toEqual([]);
    expect(ruleWarnings(result)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects a relation the job uses but dbTables does not declare", () => {
    const content =
      CORE +
      'import { todos, notes } from "~/db/schema";\n' +
      "export default defineJob({\n" +
      '  name: "purge-todos",\n' +
      '  dbTables: ["todos"],\n' +
      "  run: async ({ db }) => db.delete(notes),\n" +
      "});\n";
    const { result } = validate([
      create(JOBS + "purge-todos.ts", content),
      update("db/schema.ts", NOTES_SCHEMA),
    ]);
    const finding = result.errors.find((entry) => entry.rule === RULE);
    expect(finding?.message).toContain('Relation "notes" is used through the job db');
    expect(finding?.file).toBe(JOBS + "purge-todos.ts");
    expect(result.ok).toBe(false);
  });

  it("rejects a dynamic relation instead of guessing", () => {
    const content =
      job('name: "purge-todos", dbTables: []', "async ({ db }) => db.select().from(loadTable())") +
      "function loadTable(): unknown { return null; }\n";
    const { result } = validate([create(JOBS + "dynamic.ts", content)]);
    expect(findings(result).join("\n")).toContain("cannot be resolved statically");
    expect(result.ok).toBe(false);
  });

  it("rejects db.execute without rawSql: true and accepts it with the flag", () => {
    const run = 'async ({ db }) => db.execute("select 1")';
    const withoutFlag = validate([create(JOBS + "raw.ts", job('name: "raw", dbTables: []', run))]);
    expect(findings(withoutFlag.result).join("\n")).toContain("rawSql: true");
    expect(withoutFlag.result.ok).toBe(false);
    const withFlag = validate([
      create(JOBS + "raw.ts", job('name: "raw", dbTables: [], rawSql: true', run)),
    ]);
    expect(findings(withFlag.result)).toEqual([]);
    expect(withFlag.result.ok).toBe(true);
  });

  it("warns about a declared relation the job never uses", () => {
    const [warning] = ruleWarnings(
      validate([
        create(JOBS + "idle.ts", job('name: "idle", dbTables: ["todos"]', "async () => null")),
      ]).result,
    );
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toContain('"todos"');
  });

  it("fails closed when dbTables is missing", () => {
    const content =
      CORE +
      'import { todos } from "~/db/schema";\n' +
      "export default defineJob({\n" +
      '  name: "purge-todos",\n' +
      "  run: async ({ db }) => db.delete(todos),\n" +
      "});\n";
    const { result } = validate([create(JOBS + "undeclared.ts", content)]);
    expect(findings(result).join("\n")).toContain("dbTables is missing or cannot be read");
    expect(result.ok).toBe(false);
  });

  it("fails closed when dbTables cannot be read statically", () => {
    const content =
      CORE +
      'import { todos } from "~/db/schema";\n' +
      "export default defineJob({\n" +
      '  name: "purge-todos",\n' +
      "  dbTables: loadTables(),\n" +
      "  run: async ({ db }) => db.delete(todos),\n" +
      "});\n" +
      "function loadTables(): string[] { return []; }\n";
    const { result } = validate([create(JOBS + "unreadable.ts", content)]);
    expect(findings(result).join("\n")).toContain("dbTables is missing or cannot be read");
    expect(result.ok).toBe(false);
  });

  it("suppresses the unused warning when a package helper receives the client", () => {
    const content =
      CORE +
      'import { runAsSystem } from "@facilis/db";\n' +
      "export default defineJob({\n" +
      '  name: "delegated",\n' +
      '  dbTables: ["todos"],\n' +
      "  run: async ({ db }) => runAsSystem(db, {}, () => null),\n" +
      "});\n";
    const { result } = validate([create(JOBS + "delegated.ts", content)]);
    expect(result.errors.filter((entry) => entry.rule === RULE)).toEqual([]);
    expect(ruleWarnings(result)).toEqual([]);
  });

  it("catches a helper-only patch that changes an untouched job's usage", () => {
    const helper =
      'import { todos } from "~/db/schema";\n' +
      "export function deleteAll(db: { delete: (relation: unknown) => unknown }): unknown {\n" +
      "  return db.delete(todos);\n" +
      "}\n";
    const patchedHelper =
      'import { notes } from "~/db/schema";\n' +
      "export function deleteAll(db: { delete: (relation: unknown) => unknown }): unknown {\n" +
      "  return db.delete(notes);\n" +
      "}\n";
    const jobContent =
      CORE +
      'import { deleteAll } from "~/server/utils/db";\n' +
      "export default defineJob({\n" +
      '  name: "purge-todos",\n' +
      '  dbTables: ["todos"],\n' +
      "  run: async ({ db }) => deleteAll(db),\n" +
      "});\n";
    const sources = {
      "server/jobs/purge-todos.ts": jobContent,
      "server/utils/db.ts": helper,
    };
    const base = validate([], { sources });
    expect(rulesOf(base.result.errors)).not.toContain(RULE);
    const { result } = validate(
      [update("server/utils/db.ts", patchedHelper), update("db/schema.ts", NOTES_SCHEMA)],
      { sources },
    );
    const finding = result.errors.find((entry) => entry.rule === RULE);
    expect(finding?.message).toContain('Relation "notes"');
    expect(finding?.file).toBe("server/utils/db.ts");
  });
});
