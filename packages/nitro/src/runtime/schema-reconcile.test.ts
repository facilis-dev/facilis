import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  applyStatements,
  createDb,
  diffSchemaSnapshots,
  liveSchemaSnapshot,
  schemaSnapshot,
} from "@facilis.dev/db";

import { planReconcile, reconcileDeclaredSchema } from "./schema-reconcile.ts";

const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
});

const todos = pgTable("todos", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
});

const labelled = pgTable("todos", {
  id: integer("id").primaryKey(),
  label: text("label").notNull(),
});

async function liveTables(db: Awaited<ReturnType<typeof createDb>>): Promise<string[]> {
  return (await liveSchemaSnapshot(db)).tables.map((table) => table.name).toSorted();
}

describe("dev schema reconcile", () => {
  it("creates a declared table the dev database is missing", async () => {
    const db = await createDb({ schema: { notes } });
    await reconcileDeclaredSchema(db, [], []);
    const live = await liveSchemaSnapshot(db);
    expect(live.tables.map((table) => table.name)).toContain("notes");
    await db.close();
  });

  it("adds a column the declaration has and the table lacks", async () => {
    const db = await createDb({ schema: { todos } });
    await applyStatements(db, [
      'CREATE TABLE "todos" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid())',
    ]);
    await reconcileDeclaredSchema(db, [], []);
    const live = await liveSchemaSnapshot(db);
    expect(live.tables[0]?.columns.map((column) => column.name)).toContain("title");
    await db.close();
  });

  it("never drops an extra table or column the user did not confirm", async () => {
    const db = await createDb({ schema: { notes } });
    await applyStatements(db, ['CREATE TABLE "legacy" (id int PRIMARY KEY)']);
    const [declared, live] = await Promise.all([schemaSnapshot(db), liveSchemaSnapshot(db)]);
    expect(planReconcile(declared, live, []).some((sql) => sql.startsWith("DROP "))).toBe(false);
    await db.close();
  });

  it("drops exactly the table the approvals file names", async () => {
    const db = await createDb({ schema: { notes } });
    await applyStatements(db, [
      'CREATE TABLE "legacy" (id int PRIMARY KEY)',
      'CREATE TABLE "kept" (id int PRIMARY KEY)',
    ]);
    await reconcileDeclaredSchema(db, ['drops table "legacy"'], []);
    expect(await liveTables(db)).toContain("kept");
    expect(await liveTables(db)).not.toContain("legacy");
    await db.close();
  });

  it("warns instead of failing the boot when a statement cannot apply", async () => {
    const db = await createDb({ schema: { todos: labelled } });
    await applyStatements(db, [
      'CREATE TABLE "todos" ("id" int PRIMARY KEY)',
      'INSERT INTO "todos" ("id") VALUES (1)',
    ]);
    const warnings: { code: string; message: string }[] = [];
    await reconcileDeclaredSchema(db, [], warnings);
    expect(warnings.some((entry) => entry.code === "schema_reconcile_failed")).toBe(true);
    await db.close();
  });
});

const owners = pgTable("owners", {
  id: uuid("id").primaryKey().defaultRandom(),
});

const articles = pgTable(
  "articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    authorId: uuid("author_id").references(() => owners.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("articles_title_idx").on(table.title),
    index("articles_title_lower_idx").on(sql`lower(${table.title})`),
    check("articles_title_ck", sql`length(${table.title}) > 0`),
  ],
);

const ARTICLES_LEGACY =
  'CREATE TABLE "articles" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "title" text NOT NULL, "status" text NOT NULL, "author_id" uuid)';

describe("dev schema reconcile of existing-table constraints", () => {
  it("adds index, expression index, FK, check and default without resetting data", async () => {
    const db = await createDb({ schema: { articles, owners } });
    await applyStatements(db, [
      ARTICLES_LEGACY,
      `INSERT INTO "articles" ("id", "title", "status") VALUES (gen_random_uuid(), 'hello', 'published')`,
    ]);
    const warnings: { code: string; message: string }[] = [];
    await reconcileDeclaredSchema(db, [], warnings);
    expect(warnings).toEqual([]);

    const live = await liveSchemaSnapshot(db);
    const table = live.tables.find((entry) => entry.name === "articles");
    if (table === undefined) throw new Error("articles table missing");
    expect(table.indexes.map((entry) => entry.name).toSorted()).toEqual([
      "articles_title_idx",
      "articles_title_lower_idx",
    ]);
    expect(table.foreignKeys).toMatchObject([
      { columns: ["author_id"], targetTable: "owners", targetColumns: ["id"], onDelete: "cascade" },
    ]);
    expect(table.checks.map((entry) => entry.name)).toEqual(["articles_title_ck"]);
    expect(table.columns.find((column) => column.name === "status")?.default).toBe("'draft'::text");

    const rows = await db.db.execute(sql`select count(*)::int as n from "articles"`);
    expect(rows.rows[0]?.["n"]).toBe(1);
    const declared = await schemaSnapshot(db);
    expect(diffSchemaSnapshots(declared, live)).toEqual([]);
    await db.close();
  });

  it("is idempotent: a converged schema plans no further constraint statements", async () => {
    const db = await createDb({ schema: { articles, owners } });
    await applyStatements(db, [ARTICLES_LEGACY]);
    await reconcileDeclaredSchema(db, [], []);
    const [declared, live] = await Promise.all([schemaSnapshot(db), liveSchemaSnapshot(db)]);
    expect(planReconcile(declared, live, [])).toEqual([]);
    await db.close();
  });

  it("replaces a changed index, check, default and FK action, then converges", async () => {
    const db = await createDb({ schema: { articles, owners } });
    await applyStatements(db, [
      'CREATE TABLE "articles" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "title" text NOT NULL, "status" text NOT NULL DEFAULT \'legacy\', "author_id" uuid)',
      'CREATE TABLE "owners" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid())',
      'CREATE INDEX "articles_title_idx" ON "articles" ("status")',
      'ALTER TABLE "articles" ADD CONSTRAINT "articles_title_ck" CHECK (length(title) >= 0)',
      'ALTER TABLE "articles" ADD CONSTRAINT "articles_owner_fk" FOREIGN KEY ("author_id") REFERENCES "owners" ("id") ON DELETE SET NULL',
    ]);
    const warnings: { code: string; message: string }[] = [];
    await reconcileDeclaredSchema(db, [], warnings);
    expect(warnings).toEqual([]);

    const live = await liveSchemaSnapshot(db);
    const table = live.tables.find((entry) => entry.name === "articles");
    if (table === undefined) throw new Error("articles table missing");
    expect(table.indexes.find((entry) => entry.name === "articles_title_idx")?.columns).toEqual(["title"]);
    expect(table.columns.find((column) => column.name === "status")?.default).toBe("'draft'::text");
    expect(table.foreignKeys).toMatchObject([{ columns: ["author_id"], onDelete: "cascade" }]);
    const [declared, after] = await Promise.all([schemaSnapshot(db), liveSchemaSnapshot(db)]);
    expect(planReconcile(declared, after, [])).toEqual([]);
    await db.close();
  });

  it("never drops a live-only index, check or FK the user did not confirm", async () => {
    const db = await createDb({ schema: { articles, owners } });
    await applyStatements(db, [
      ARTICLES_LEGACY,
      'CREATE TABLE "legacy_ref" (id uuid PRIMARY KEY)',
      'CREATE INDEX "articles_extra_idx" ON "articles" ("status")',
      `ALTER TABLE "articles" ADD CONSTRAINT "articles_extra_ck" CHECK (status <> '')`,
      'ALTER TABLE "articles" ADD CONSTRAINT "articles_legacy_fk" FOREIGN KEY ("author_id") REFERENCES "legacy_ref" ("id")',
    ]);
    const [declared, live] = await Promise.all([schemaSnapshot(db), liveSchemaSnapshot(db)]);
    const plan = planReconcile(declared, live, []);
    expect(plan.some((statement) => statement.startsWith("DROP "))).toBe(false);
    await db.close();
  });
});

