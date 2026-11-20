// The mapper is the only bridge between the analyzer's flat facts and the snapshot the
// runtime derives from Drizzle (schemaSnapshot, no database round-trip). The round-trip
// test builds the same declaration twice - once as analysable source, once as Drizzle
// tables - so a missed fact cannot pass unnoticed: the plan sees one declaration or the
// other, and they must agree.

import { createDb, schemaSnapshot, type FacilisDb } from "@facilis.dev/db";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeProject } from "./analyze.ts";
import { createOxcParser } from "./node.ts";
import { schemaSnapshotFromAnalysis } from "./schema-snapshot.ts";

const parser = createOxcParser();

const mood = pgEnum("mood", ["happy", "sad"]);

const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    title: text("title").notNull(),
    ownerId: uuid("owner_id"),
    mood: mood("mood"),
  },
  (table) => [
    index("documents_title_idx").on(table.title),
    index("documents_lower_title_idx").on(sql`lower(${table.title})`),
    uniqueIndex("documents_tenant_title_idx").on(table.tenantId, table.title),
    unique("documents_owner_title_unique").on(table.ownerId, table.title),
    check("documents_title_ck", sql`length(${table.title}) > 0`),
    pgPolicy("documents_read", { for: "select", using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();

function fromSource(source: string) {
  const analysis = analyzeProject({ files: new Map([["db/schema.ts", source]]), parser });
  return schemaSnapshotFromAnalysis(analysis);
}

/** The same declaration as analysable DSL source (what the IDE reads at a git ref). */
const SOURCE = [
  'import { sql } from "drizzle-orm";',
  'import { check, index, pgEnum, pgPolicy, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";',
  "",
  'export const mood = pgEnum("mood", ["happy", "sad"]);',
  "",
  'export const documents = pgTable("documents", {',
  '  id: uuid("id").primaryKey(),',
  '  tenantId: uuid("tenant_id").notNull(),',
  '  title: text("title").notNull(),',
  '  ownerId: uuid("owner_id"),',
  '  mood: mood("mood"),',
  "}, (table) => [",
  '  index("documents_title_idx").on(table.title),',
  '  index("documents_lower_title_idx").on(sql`lower(${table.title})`),',
  '  uniqueIndex("documents_tenant_title_idx").on(table.tenantId, table.title),',
  '  unique("documents_owner_title_unique").on(table.ownerId, table.title),',
  '  check("documents_title_ck", sql`length(${table.title}) > 0`),',
  '  pgPolicy("documents_read", { for: "select", using: sql`true`, withCheck: sql`true` }),',
  "]).enableRLS();",
].join("\n");

const NOTES = [
  "",
  'export const notes = pgTable("notes", {',
  '  id: uuid("id").primaryKey(),',
  '  title: text("title"),',
  "}, (table) => [",
  '  index("notes_title_partial_idx").on(table.title).where(sql`${table.title} IS NOT NULL`),',
  "]);",
].join("\n");

describe("schemaSnapshotFromAnalysis", () => {
  let db: FacilisDb;

  beforeAll(async () => {
    db = await createDb({ schema: { documents } });
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("round-trips indexes, checks, uniques and enums against the runtime snapshot", async () => {
    const mapped = fromSource(SOURCE);
    const runtime = await schemaSnapshot(db);
    const mappedTable = mapped.tables.find((table) => table.name === "documents");
    const runtimeTable = runtime.tables.find((table) => table.name === "documents");
    expect(mappedTable).toBeDefined();
    expect(runtimeTable).toBeDefined();
    const indexShape = (entry: { name: string; columns: readonly string[]; unique: boolean }) => ({
      name: entry.name,
      columns: entry.columns,
      unique: entry.unique,
    });
    const uniqueShape = (entry: { name: string; columns: readonly string[] }) => ({
      name: entry.name,
      columns: entry.columns,
    });
    const policyShape = (entry: { name: string; command: string }) => ({
      name: entry.name,
      command: entry.command,
    });
    const columnShape = (column: { name: string; notNull: boolean; isPrimaryKey: boolean }) => ({
      name: column.name,
      notNull: column.notNull,
      isPrimaryKey: column.isPrimaryKey,
    });
    expect(mappedTable?.indexes?.map(indexShape)).toEqual(runtimeTable?.indexes?.map(indexShape));
    expect(mappedTable?.checks?.map((entry) => entry.name)).toEqual(
      runtimeTable?.checks?.map((entry) => entry.name),
    );
    expect(mappedTable?.uniqueConstraints?.map(uniqueShape)).toEqual(
      runtimeTable?.uniqueConstraints?.map(uniqueShape),
    );
    expect(mapped.enums).toEqual(runtime.enums);
    expect(mappedTable?.policies.map(policyShape)).toEqual(runtimeTable?.policies.map(policyShape));
    expect(mappedTable?.columns.map(columnShape)).toEqual(runtimeTable?.columns.map(columnShape));
    expect(mappedTable?.primaryKey).toEqual(runtimeTable?.primaryKey);
    expect(mappedTable?.rlsEnabled).toBe(runtimeTable?.rlsEnabled);
  });

  it("carries a single-expression index as SQL and a partial index as unsupported", () => {
    const mapped = fromSource(SOURCE + NOTES);
    const documentsTable = mapped.tables.find((table) => table.name === "documents");
    const expression = documentsTable?.indexes?.find(
      (entry) => entry.name === "documents_lower_title_idx",
    );
    expect(expression?.expression).toBeTruthy();
    const notes = mapped.tables.find((table) => table.name === "notes");
    expect(notes?.unsupported?.some((entry) => entry.name === "notes_title_partial_idx")).toBe(true);
  });
});