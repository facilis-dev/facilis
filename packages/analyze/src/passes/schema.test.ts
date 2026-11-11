import { describe, expect, it } from "vitest";

import { loadFixtureProject } from "../../test-fixtures/load.ts";
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
    unknown: [],
  };
}

function schemaOf(graph: ModuleGraph): SchemaResult {
  return buildSchemaFacts(graph, fixtureConfig());
}

function fixtureGraph(): ModuleGraph {
  return createModuleGraph({ files: loadFixtureProject(), parser });
}

function singleFile(source: string): ModuleGraph {
  return createModuleGraph({ files: new Map([["db/schema.ts", source]]), parser });
}

function table(result: SchemaResult, name: string): TableFact {
  const found = result.tables.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error("missing table " + name);
  return found;
}

describe("schema pass (fixture project)", () => {
  const result = schemaOf(fixtureGraph());

  it("reads local tables in source order and merges re-exported framework tables", () => {
    expect(result.tables.map((entry) => entry.name)).toEqual([
      "projects",
      "todos",
      "users",
      "sessions",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reads columns, display types, defaults and tenant scope", () => {
    const projects = table(result, "projects");
    const columns = new Map(projects.columns.map((column) => [column.property, column]));
    expect(columns.get("id")?.builder).toBe("uuid");
    expect(columns.get("id")?.primaryKey).toBe(true);
    expect(columns.get("id")?.default).toEqual({ kind: "random", value: null });
    expect(columns.get("createdAt")?.type).toBe("timestamp with time zone");
    expect(columns.get("createdAt")?.notNull).toBe(true);
    expect(columns.get("createdAt")?.default).toEqual({ kind: "now", value: null });
    expect(columns.get("tenantId")?.builder).toBe("tenantColumn");
    expect(columns.get("tenantId")?.name).toBe("tenant_id");
    expect(projects.scope).toEqual({ column: "tenantId", kind: "tenant" });
    expect(projects.primaryKey).toEqual(["id"]);
  });

  it("reads RLS and isolation policies", () => {
    const projects = table(result, "projects");
    expect(projects.rlsEnabled).toBe(true);
    expect(projects.policies.map((policy) => policy.name)).toEqual([
      "tenant_isolation",
      "owner_isolation",
    ]);
    expect(projects.policies.map((policy) => policy.restrictive)).toEqual([true, false]);
    expect(projects.policies.every((policy) => policy.command === "ALL")).toBe(true);
  });

  it("reads the physical foreign key from .references()", () => {
    const todos = table(result, "todos");
    expect(todos.foreignKeys).toHaveLength(1);
    expect(todos.foreignKeys[0]).toMatchObject({
      columns: ["projectId"],
      targetTable: "projects",
      targetColumns: ["id"],
      onDelete: "cascade",
      onUpdate: null,
    });
  });

  it("reads logical relations() with cardinality and column mappings", () => {
    expect(result.relations).toHaveLength(2);
    expect(result.relations[0]).toMatchObject({
      from: "projects",
      to: "todos",
      cardinality: "many",
      fields: [],
      references: [],
    });
    expect(result.relations[1]).toMatchObject({
      from: "todos",
      to: "projects",
      cardinality: "one",
      fields: ["projectId"],
      references: ["id"],
    });
  });

  it("merges framework tables with their bindings and no scope", () => {
    const users = table(result, "users");
    const sessions = table(result, "sessions");
    expect(users.binding).toBe("users");
    expect(sessions.binding).toBe("sessions");
    expect(users.scope).toBeNull();
    expect(sessions.rlsEnabled).toBe(false);
  });
});

describe("schema pass (edge cases)", () => {
  it("recognizes aliased imports and keeps custom-builder columns with a schema-static diagnostic", () => {
    const graph =
      singleFile(`import { pgTable as table, text as str, varchar } from "drizzle-orm/pg-core";
import { tenantColumn } from "@facilis.dev/db";
import { customColumn } from "../lib/custom.ts";

export const widgets = table("widgets", {
  id: str("id").primaryKey(),
  code: varchar("code", { length: 12 }).notNull(),
  tags: str("tags").array(),
  tenantId: tenantColumn(),
  made: customColumn("made_at"),
});
`);
    const result = schemaOf(graph);
    const widgets = table(result, "widgets");
    const columns = new Map(widgets.columns.map((column) => [column.property, column]));
    expect(columns.get("id")?.builder).toBe("text");
    expect(columns.get("code")?.type).toBe("varchar(12)");
    expect(columns.get("tags")?.type).toBe("text[]");
    expect(columns.get("made")?.builder).toBe("customColumn");
    expect(columns.get("made")?.name).toBe("made_at");
    expect(columns.get("made")?.type).toBe("unknown");
    expect(columns.get("made")?.unknown[0]?.code).toBe("schema-static");
    expect(widgets.scope).toEqual({ column: "tenantId", kind: "tenant" });
    expect(result.diagnostics.map((entry) => entry.code).toSorted()).toEqual([
      "rls-on-scoped-table",
      "schema-static",
    ]);
  });

  it("reads pgPolicy options and rlsForTable policy sets", () => {
    const graph = singleFile(`import { pgPolicy, pgTable, text } from "drizzle-orm/pg-core";
import { rlsForTable } from "@facilis.dev/db";

export const audit = pgTable(
  "audit",
  { id: text("id").primaryKey() },
  () => [pgPolicy("audit_read", { for: "select", as: "restrictive" })],
).enableRLS();

export const logs = pgTable(
  "logs",
  { id: text("id").primaryKey() },
  () => rlsForTable({ tenantColumn: "tenant_id", ownerColumn: "owner_id" }).policies,
).enableRLS();
`);
    const result = schemaOf(graph);
    const audit = table(result, "audit");
    const logs = table(result, "logs");
    expect(audit.policies).toHaveLength(1);
    expect(audit.policies[0]).toMatchObject({
      name: "audit_read",
      command: "SELECT",
      restrictive: true,
    });
    expect(logs.policies.map((policy) => policy.name)).toEqual([
      "tenant_isolation",
      "owner_isolation",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps dynamic table names and unknown foreign-key targets explicit", () => {
    const graph = singleFile(`import { pgTable, text, uuid } from "drizzle-orm/pg-core";

const tableName = process.env.TABLE_NAME;
export const dynamic = pgTable(tableName, { id: text("id").primaryKey() });
export const orphan = pgTable("orphan", {
  id: uuid("id").primaryKey(),
  ghostId: uuid("ghost_id").references(() => ghosts.id),
});
`);
    const result = schemaOf(graph);
    const dynamic = table(result, "dynamic");
    const orphan = table(result, "orphan");
    expect(dynamic.unknown[0]?.code).toBe("schema-static");
    expect(orphan.foreignKeys).toEqual([]);
    expect(result.diagnostics.map((entry) => entry.code).toSorted()).toEqual([
      "fk-target-known",
      "schema-static",
    ]);
  });
});
