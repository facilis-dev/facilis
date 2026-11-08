import { describe, expect, it } from "vitest";

import { createModuleGraph, type ModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import type { ConfigFacts, TableFact } from "../types.ts";
import { buildSchemaFacts, type SchemaResult } from "./schema.ts";

const parser = createOxcParser();

/** The config pass's fixture facts; the schema pass only reads the scope columns. */
function fixtureConfig(): ConfigFacts {
  return {
    parsed: true,
    source: null,
    permissions: [],
    roles: {},
    defaultRole: null,
    defaultLocale: null,
    locales: [],
    migrationsDir: "db/migrations",
    tenantColumns: ["tenantId"],
    ownerColumns: ["ownerId"],
    blocksPackages: [],
    unknown: [],
  };
}

const SCHEMA = `import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import {
  facilisFiles,
  fileLinks,
  tenantColumn,
  tenantIsolationPolicy,
} from "@facilis/db";

export { facilisFiles };

export const todos = pgTable(
  "todos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantColumn(),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
  },
  () => [tenantIsolationPolicy()],
).enableRLS();

export const todoFiles = fileLinks(todos, { table: "todo_files", column: "todo_id" });
`;

const FRAMEWORK_SCHEMA = `import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantIsolationPolicy } from "./rls.ts";
import { tenantColumn } from "./tenant-column.ts";

export const facilisFiles = pgTable(
  "facilis_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hash: text("hash").notNull(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: text("size").notNull(),
    tenantId: tenantColumn(),
    ownerId: uuid("owner_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy()],
).enableRLS();
`;

const FRAMEWORK_SOURCES: Readonly<Record<string, string>> = {
  "node_modules/@facilis/db/package.json": JSON.stringify(
    { name: "@facilis/db", type: "module", exports: { ".": "./src/index.ts" } },
    null,
    2,
  ),
  "node_modules/@facilis/db/src/index.ts": `export { facilisFiles, fileLinks } from "./files.ts";\n`,
  "node_modules/@facilis/db/src/files.ts": FRAMEWORK_SCHEMA,
  "node_modules/@facilis/db/src/rls.ts": `export function tenantIsolationPolicy(column = "tenant_id") {\n  return column;\n}\n`,
  "node_modules/@facilis/db/src/tenant-column.ts": `export function tenantColumn(name = "tenant_id") {\n  return name;\n}\n`,
};

function schemaOf(files: Readonly<Record<string, string>>): SchemaResult {
  const graph: ModuleGraph = createModuleGraph({
    files: new Map(Object.entries(files)),
    parser,
  });
  return buildSchemaFacts(graph, fixtureConfig());
}

function tableOf(result: SchemaResult, name: string): TableFact {
  const found = result.tables.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error("missing table " + name);
  return found;
}

function expectLinkTable(result: SchemaResult): TableFact {
  const link = tableOf(result, "todo_files");
  expect(link.binding).toBe("todoFiles");
  expect(link.columns.map((entry) => entry.property)).toEqual([
    "id",
    "parentId",
    "fileId",
    "tenantId",
    "createdAt",
  ]);
  expect(link.columns.map((entry) => entry.name)).toEqual([
    "id",
    "todo_id",
    "file_id",
    "tenant_id",
    "created_at",
  ]);
  const columns = new Map(link.columns.map((entry) => [entry.property, entry]));
  expect(columns.get("id")).toMatchObject({
    builder: "uuid",
    type: "uuid",
    notNull: true,
    primaryKey: true,
    default: { kind: "random", value: null },
  });
  expect(columns.get("parentId")).toMatchObject({ builder: "uuid", notNull: true });
  expect(columns.get("fileId")).toMatchObject({ builder: "uuid", notNull: true });
  expect(columns.get("tenantId")).toMatchObject({ builder: "tenantColumn", name: "tenant_id" });
  expect(columns.get("createdAt")).toMatchObject({
    builder: "timestamp",
    type: "timestamp with time zone",
    notNull: true,
    default: { kind: "now", value: null },
  });
  expect(link.primaryKey).toEqual(["id"]);
  expect(link.foreignKeys).toHaveLength(2);
  expect(link.foreignKeys[0]).toMatchObject({
    columns: ["parentId"],
    targetTable: "todos",
    targetColumns: ["id"],
    onDelete: "cascade",
    onUpdate: null,
  });
  expect(link.foreignKeys[1]).toMatchObject({
    columns: ["fileId"],
    targetTable: "facilis_files",
    targetColumns: ["id"],
    onDelete: "cascade",
    onUpdate: null,
  });
  expect(link.policies.map((policy) => policy.name)).toEqual(["tenant_isolation", "parent_access"]);
  expect(link.policies.map((policy) => policy.restrictive)).toEqual([true, false]);
  expect(link.policies.every((policy) => policy.command === "ALL")).toBe(true);
  expect(link.rlsEnabled).toBe(true);
  expect(link.scope).toEqual({ column: "tenantId", kind: "tenant" });
  return link;
}

describe("fileLinks schema facts", () => {
  it("synthesizes the link table without the framework sources in the map", () => {
    const result = schemaOf({ "db/schema.ts": SCHEMA });
    expect(result.tables.map((entry) => entry.name)).toEqual(["todos", "todo_files"]);
    expectLinkTable(result);
    // The FK target resolves through the lookup, but facilis_files is not a project table.
    expect(result.tables.some((entry) => entry.name === "facilis_files")).toBe(false);
    expect(result.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
  });

  it("reuses the re-exported framework table when its source is in the map", () => {
    const result = schemaOf({ "db/schema.ts": SCHEMA, ...FRAMEWORK_SOURCES });
    expect(result.tables.map((entry) => entry.name)).toEqual([
      "todos",
      "todo_files",
      "facilis_files",
    ]);
    const link = expectLinkTable(result);
    expect(link.foreignKeys[1]?.targetTable).toBe("facilis_files");
    expect(result.diagnostics).toEqual([]);
  });

  it("defaults the parent column and records an unreadable parent instead of throwing", () => {
    const result = schemaOf({
      "db/schema.ts": `import { fileLinks } from "@facilis/db";
import { pgTable, uuid } from "drizzle-orm/pg-core";

export const todos = pgTable("todos", { id: uuid("id").primaryKey() });
export const looseFiles = fileLinks(missing, { table: "loose_files" });
`,
    });
    const link = tableOf(result, "loose_files");
    expect(link.columns.find((entry) => entry.property === "parentId")?.name).toBe("parent_id");
    expect(link.unknown.map((entry) => entry.code)).toEqual(["schema-static"]);
    expect(link.foreignKeys.map((entry) => entry.targetTable)).toEqual(["facilis_files"]);
    expect(result.diagnostics.map((entry) => entry.code)).toContain("schema-static");
  });

  it("keeps a dynamic table name explicit and falls back to the binding", () => {
    const result = schemaOf({
      "db/schema.ts": `import { fileLinks } from "@facilis/db";
import { pgTable, uuid } from "drizzle-orm/pg-core";

export const todos = pgTable("todos", { id: uuid("id").primaryKey() });
export const dynamicFiles = fileLinks(todos, { table: 42, column: "todo_id" });
`,
    });
    const link = tableOf(result, "dynamicFiles");
    expect(link.unknown.map((entry) => entry.reason)).toContain(
      'fileLinks table name of "dynamicFiles" is not a static string',
    );
    expect(link.policies.map((policy) => policy.name)).toEqual([
      "tenant_isolation",
      "parent_access",
    ]);
  });
});
