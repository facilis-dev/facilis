import { describe, expect, it } from "vitest";

import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import type { ConfigFacts, TableFact } from "../types.ts";
import { buildSchemaFacts, type SchemaResult } from "./schema.ts";

const parser = createOxcParser();

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

function factsOf(source: string): SchemaResult {
  const graph = createModuleGraph({ files: new Map([["db/schema.ts", source]]), parser });
  return buildSchemaFacts(graph, fixtureConfig());
}

function table(result: SchemaResult, name: string): TableFact {
  const found = result.tables.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error("missing table " + name);
  return found;
}

const HEADER = [
  'import { sql } from "drizzle-orm";',
  'import { check, index, pgEnum, pgPolicy, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";',
  'import { tenantIsolationPolicy } from "@facilis.dev/db";',
  "",
].join("\n");

function withHeader(tableSource: string): string {
  return HEADER + tableSource;
}

describe("schema facts: indexes", () => {
  it("reads plain-column and unique indexes with SQL column names", () => {
    const result = factsOf(
      withHeader([
        'export const users = pgTable("users", {',
        '  id: uuid("id").primaryKey(),',
        '  tenantId: uuid("tenant_id").notNull(),',
        '  email: text("email").notNull(),',
        "}, (table) => [",
        '  index("users_email_idx").on(table.email),',
        '  uniqueIndex("users_tenant_email_idx").on(table.tenantId, table.email),',
        "]);",
      ].join("\n")),
    );
    const users = table(result, "users");
    expect(users.indexes).toHaveLength(2);
    expect(users.indexes[0]).toMatchObject({
      name: "users_email_idx",
      columns: ["email"],
      expression: null,
      unique: false,
      unsupported: null,
    });
    expect(users.indexes[1]).toMatchObject({
      name: "users_tenant_email_idx",
      columns: ["tenant_id", "email"],
      unique: true,
    });
    expect(users.unsupported).toEqual([]);
  });

  it("renders a single sql expression index as table-qualified SQL", () => {
    const result = factsOf(
      withHeader([
        'export const users = pgTable("users", {',
        '  email: text("email").notNull(),',
        "}, (table) => [",
        '  uniqueIndex("users_email_lower_idx").on(sql`lower(${table.email})`),',
        "]);",
      ].join("\n")),
    );
    const users = table(result, "users");
    expect(users.indexes[0]).toMatchObject({
      name: "users_email_lower_idx",
      columns: [],
      expression: 'lower("users"."email")',
      unique: true,
      unsupported: null,
    });
  });

  it("never flattens a partial, non-btree, mixed, multi-expression or ordered index", () => {
    const result = factsOf(
      withHeader([
        'export const users = pgTable("users", {',
        '  email: text("email").notNull(),',
        "}, (table) => [",
        '  index("users_partial_idx").on(table.email).where(sql`${table.email} IS NOT NULL`),',
        '  index("users_hash_idx").using("hash", table.email),',
        '  index("users_mixed_idx").on(table.email, sql`lower(${table.email})`),',
        '  index("users_multi_expr_idx").on(sql`lower(${table.email})`, sql`upper(${table.email})`),',
        '  index("users_desc_idx").on(table.email.desc()),',
        "]);",
      ].join("\n")),
    );
    const users = table(result, "users");
    for (const indexFact of users.indexes) {
      expect(indexFact.columns).toEqual([]);
      expect(indexFact.expression).toBeNull();
      expect(indexFact.unsupported).not.toBeNull();
    }
    expect(users.indexes.map((entry) => entry.name)).toEqual([
      "users_partial_idx",
      "users_hash_idx",
      "users_mixed_idx",
      "users_multi_expr_idx",
      "users_desc_idx",
    ]);
    expect(users.unsupported.map((entry) => entry.construct)).toEqual([
      "index",
      "index",
      "index",
      "index",
      "index",
    ]);
  });
});

describe("schema facts: checks, uniques and enums", () => {
  it("reads a check expression and a table-level unique constraint", () => {
    const result = factsOf(
      withHeader([
        'export const users = pgTable("users", {',
        '  email: text("email").notNull(),',
        '  tenantId: uuid("tenant_id").notNull(),',
        "}, (table) => [",
        '  check("users_email_ck", sql`length(${table.email}) > 0`),',
        '  unique("users_email_tenant_unique").on(table.email, table.tenantId),',
        "]);",
      ].join("\n")),
    );
    const users = table(result, "users");
    expect(users.checks).toHaveLength(1);
    expect(users.checks[0]).toMatchObject({
      name: "users_email_ck",
      expression: 'length("users"."email") > 0',
      unknown: [],
    });
    expect(users.uniqueConstraints).toEqual([
      expect.objectContaining({
        name: "users_email_tenant_unique",
        columns: ["email", "tenant_id"],
      }),
    ]);
  });

  it("carries an unreadable check and an unreadable unique as unsupported", () => {
    const result = factsOf(
      withHeader([
        'export const users = pgTable("users", {',
        '  email: text("email").notNull(),',
        "}, (table) => [",
        '  check("users_dynamic_ck", dynamicExpression()),',
        '  unique("users_dynamic_unique").on(dynamicExpression()),',
        "]);",
      ].join("\n")),
    );
    const users = table(result, "users");
    expect(users.checks[0]?.expression).toBeNull();
    expect(users.checks[0]?.unknown.length).toBeGreaterThan(0);
    expect(users.uniqueConstraints[0]?.columns).toEqual([]);
    expect(users.uniqueConstraints[0]?.unknown.length).toBeGreaterThan(0);
    expect(users.unsupported.map((entry) => entry.construct).toSorted()).toEqual([
      "check",
      "unique",
    ]);
  });

  it("collects pgEnum declarations and keeps unreadable values explicit", () => {
    const result = factsOf(
      withHeader([
        'export const mood = pgEnum("mood", ["happy", "sad"]);',
        'export const bad = pgEnum(enumName, enumValues);',
        'export const users = pgTable("users", {',
        '  id: uuid("id").primaryKey(),',
        '  mood: mood("mood"),',
        "});",
      ].join("\n")),
    );
    expect(result.enums.map((entry) => entry.name)).toEqual(["mood", "bad"]);
    expect(result.enums[0]).toMatchObject({ name: "mood", values: ["happy", "sad"] });
    expect(result.enums[1]?.values).toEqual([]);
    expect(result.enums[1]?.unknown.length).toBe(2);
    expect(table(result, "users").columns.find((column) => column.property === "mood")?.type).toBe(
      "mood",
    );
  });
});

describe("schema facts: policies", () => {
  it("reads using/withCheck SQL and still parses for/as from the same options object", () => {
    const result = factsOf(
      withHeader([
        'export const users = pgTable("users", {',
        '  tenantId: uuid("tenant_id").notNull(),',
        "}, (table) => [",
        '  pgPolicy("users_read", { for: "select", using: sql`true`, withCheck: sql`true` }),',
        '  tenantIsolationPolicy("tenant_id"),',
        "]).enableRLS();",
      ].join("\n")),
    );
    const users = table(result, "users");
    const read = users.policies.find((policy) => policy.name === "users_read");
    expect(read).toMatchObject({ command: "SELECT", using: "true", withCheck: "true" });
    const tenant = users.policies.find((policy) => policy.name === "tenant_isolation");
    expect(tenant?.using).toBe(
      '"tenant_id" = nullif(current_setting(\'app.tenant_id\', true), \'\')::uuid',
    );
    expect(tenant?.withCheck).toBe(tenant?.using);
  });

  it("refuses an interpolated policy predicate instead of guessing it", () => {
    const result = factsOf(
      withHeader([
        'export const users = pgTable("users", {',
        '  tenantId: uuid("tenant_id").notNull(),',
        "}, (table) => [",
        '  pgPolicy("users_expr", { for: "update", using: sql`tenant_id = ${table.tenantId}` }),',
        '  pgPolicy("users_dynamic", { using: dynamicPredicate }),',
        "]).enableRLS();",
      ].join("\n")),
    );
    const users = table(result, "users");
    expect(users.policies.map((policy) => policy.name)).toEqual(["users_expr", "users_dynamic"]);
    for (const policy of users.policies) {
      expect(policy.using).toBeNull();
      expect(policy.unknown.length).toBeGreaterThan(0);
    }
    expect(users.unsupported.filter((entry) => entry.construct === "policy")).toHaveLength(2);
  });
});
