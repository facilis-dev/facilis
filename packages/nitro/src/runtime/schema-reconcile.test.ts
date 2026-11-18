import { integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { applyStatements, createDb, liveSchemaSnapshot, schemaSnapshot } from "@facilis.dev/db";

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
