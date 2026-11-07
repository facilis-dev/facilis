import { analyzeProject, type Analysis } from "@facilis/analyze";
import { describe, expect, it } from "vitest";
import { exampleProjectFiles } from "./example-template";
import { createBrowserOxcParser } from "./oxc-browser";
import type { ReleaseTableFact } from "./release-engine";
import { releaseTablesFromAnalysis, schemaSourcePaths } from "./release-schema";

const parser = createBrowserOxcParser();

function tablesOf(files: Readonly<Record<string, string>>): ReleaseTableFact[] {
  const analysis: Analysis = analyzeProject({ files: new Map(Object.entries(files)), parser });
  return releaseTablesFromAnalysis(analysis);
}

function table(files: Readonly<Record<string, string>>, name: string): ReleaseTableFact {
  const found = tablesOf(files).find((entry) => entry.name === name);
  if (found === undefined) throw new Error(name + " missing from the analysis");
  return found;
}

describe("release schema facts", () => {
  it("reads the schema the template actually ships", () => {
    const files = { "db/schema.ts": exampleProjectFiles()["db/schema.ts"] ?? "" };
    expect(tablesOf(files).map((entry) => entry.name)).toEqual(["todos"]);
    expect(table(files, "todos")).toEqual({
      name: "todos",
      columns: ["id", "tenantId", "ownerId", "title", "done", "dueDate", "createdAt"],
      policies: [{ name: "tenant_isolation" }, { name: "owner_isolation" }],
      rlsEnabled: true,
      scoped: true,
    });
  });

  it("expands the @facilis/db policy helpers and named pgPolicy calls", () => {
    const files = {
      "db/schema.ts": `
import { pgTable, pgPolicy, text, uuid } from "drizzle-orm/pg-core";
import { rlsForTable } from "@facilis/db";
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
    expect(documents.scoped).toBe(true);
    expect(table(files, "notes")).toMatchObject({
      rlsEnabled: false,
      scoped: false,
      columns: ["id"],
    });
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
    expect(tablesOf(files).map((entry) => entry.name)).toEqual(["real"]);
    expect(table(files, "real").scoped).toBe(true);
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
    expect(tablesOf(files)).toHaveLength(1);
  });
});
