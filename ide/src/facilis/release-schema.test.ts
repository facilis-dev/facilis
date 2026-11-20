import { analyzeProject, schemaSnapshotFromAnalysis } from "@facilis.dev/analyze";
import type { SchemaSnapshot, TableSnapshot } from "@facilis.dev/core";
import { describe, expect, it } from "vitest";
import { exampleProjectFiles } from "./example-template";
import { createBrowserOxcParser } from "./oxc-browser";
import { readReleaseSnapshot, schemaSourcePaths } from "./release-schema";

const parser = createBrowserOxcParser();

function snapshotOf(files: Readonly<Record<string, string>>): SchemaSnapshot {
  const analysis = analyzeProject({ files: new Map(Object.entries(files)), parser });
  return schemaSnapshotFromAnalysis(analysis);
}

function table(files: Readonly<Record<string, string>>, name: string): TableSnapshot {
  const found = snapshotOf(files).tables.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(name + " missing from the analysis");
  return found;
}

describe("release schema facts", () => {
  it("reads the schema the template actually ships", () => {
    const files = { "db/schema.ts": exampleProjectFiles()["db/schema.ts"] ?? "" };
    expect(snapshotOf(files).tables.map((entry) => entry.name)).toEqual(["todo_files", "todos"]);
    const todos = table(files, "todos");
    expect(todos.columns.map((column) => column.name)).toEqual([
      "id",
      "tenant_id",
      "owner_id",
      "title",
      "done",
      "due_date",
      "created_at",
    ]);
    expect(todos.policies.map((policy) => policy.name)).toEqual([
      "tenant_isolation",
      "owner_isolation",
    ]);
    // The snapshot carries the rendered policy SQL the plan and the security lens consume.
    expect(todos.policies[0]?.sql).toContain("CREATE POLICY");
    expect(todos.rlsEnabled).toBe(true);
    expect(todos.scopeColumn).toEqual({ name: "tenant_id", kind: "tenant" });
    // fileLinks(todos, …) is synthesized by the analyzer (D-053/D-116): the parent FK plus
    // the attach FK, the tenant policy and the parent_access policy that inherits the
    // parent's RLS through EXISTS.
    const todoFiles = table(files, "todo_files");
    expect(todoFiles.columns.map((column) => column.name)).toEqual([
      "id",
      "todo_id",
      "file_id",
      "tenant_id",
      "created_at",
    ]);
    expect(todoFiles.policies.map((policy) => policy.name)).toEqual([
      "tenant_isolation",
      "parent_access",
    ]);
    expect(todoFiles.rlsEnabled).toBe(true);
    expect(todoFiles.scopeColumn).toEqual({ name: "tenant_id", kind: "tenant" });
  });

  it("expands the @facilis.dev/db policy helpers and named pgPolicy calls", () => {
    const files = {
      "db/schema.ts": `
import { pgTable, pgPolicy, text, uuid } from "drizzle-orm/pg-core";
import { rlsForTable } from "@facilis.dev/db";
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  title: text("title"),
}, () => [
  pgPolicy("documents_read", {} as never),
  rlsForTable({ tenantColumn: "tenant_id", ownerColumn: "owner_id" }).policies,
]);
export const notes = pgTable("notes", { id: uuid("id") });
`,
    };
    const documents = table(files, "documents");
    expect(documents.policies.map((policy) => policy.name)).toEqual([
      "documents_read",
      "tenant_isolation",
      "owner_isolation",
    ]);
    expect(documents.rlsEnabled).toBe(false);
    expect(documents.scopeColumn).toEqual({ name: "tenant_id", kind: "tenant" });
    const notes = table(files, "notes");
    expect(notes.rlsEnabled).toBe(false);
    expect(notes.scopeColumn).toBeUndefined();
    expect(notes.columns.map((column) => column.name)).toEqual(["id"]);
  });

  it("ignores commented-out and quoted pgTable lookalikes", () => {
    const files = {
      "db/schema.ts": `
import { pgTable, uuid } from "drizzle-orm/pg-core";
// pgTable("ghost", { id: uuid("id") })
    const hint = 'pgTable("other", { id: uuid("id") })';
/* export const removed = pgTable("removed", { id: uuid("id") }); */
export const real = pgTable("real", { id: uuid("id"), ownerId: uuid("owner_id") });
`,
    };
    expect(snapshotOf(files).tables.map((entry) => entry.name)).toEqual(["real"]);
    expect(table(files, "real").scopeColumn).toEqual({ name: "owner_id", kind: "owner" });
  });

  it("selects the db/ DSL sources and the config that tunes the scope columns", () => {
    expect(
      schemaSourcePaths([
        "db/schema.ts",
        "db/relations.ts",
        "db/schema.test.ts",
        "db/migrations/0001_init.sql",
        "db/migrations/meta/0000_snapshot.json",
        "facilis.config.ts",
        "server/routes/api/todos/index.get.ts",
        "src/app.tsx",
      ]),
    ).toEqual(["db/relations.ts", "db/schema.ts", "facilis.config.ts"]);
  });

  it("keeps the analyzer's table order and deduplicates a redeclared table", () => {
    const files = {
      "db/schema.ts": `
import { pgTable, uuid } from "drizzle-orm/pg-core";
export const first = pgTable("same", { id: uuid("id") });
export const second = pgTable("same", { id: uuid("id") });
`,
    };
    expect(snapshotOf(files).tables).toHaveLength(1);
  });

  it("reads the full snapshot the schema plan consumes", async () => {
    const files: Readonly<Record<string, string>> = {
      "db/schema.ts": exampleProjectFiles()["db/schema.ts"] ?? "",
    };
    const snapshot = await readReleaseSnapshot(
      schemaSourcePaths(Object.keys(files)),
      async (file) => files[file] ?? null,
      async (sources) => ({ ok: true, analysis: analyzeProject({ files: sources, parser }) }),
    );
    // Sorted by name: the snapshot is compared ref-to-ref, order must not depend on source order.
    expect(snapshot?.tables.map((entry) => entry.name)).toEqual(["todo_files", "todos"]);
    const todos = snapshot?.tables.find((entry) => entry.name === "todos");
    expect(todos?.primaryKey).toEqual(["id"]);
    expect(todos?.policies.map((policy) => policy.name)).toEqual([
      "tenant_isolation",
      "owner_isolation",
    ]);
    expect(todos?.columns.map((column) => column.name)).toContain("tenant_id");
  });

  it("fails closed when the analyzer cannot run", async () => {
    const snapshot = await readReleaseSnapshot(
      ["db/schema.ts"],
      async () => 'export const x = 1;',
      async () => ({ ok: false, error: "no parser" }),
    );
    // A schema with silently missing tables would invent a plan, so it is "unreadable".
    expect(snapshot).toBeNull();
  });
});
