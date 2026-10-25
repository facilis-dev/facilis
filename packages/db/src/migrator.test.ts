import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type FacilisDb } from "./client.ts";
import { applyMigrations, applyStatements } from "./migrator.ts";

describe("applyStatements / applyMigrations", () => {
  let db: FacilisDb;

  beforeAll(async () => {
    db = await createDb();
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("applies statements once and skips them on a second run", async () => {
    const statements = [
      "CREATE TABLE idempotent (id int PRIMARY KEY, label text NOT NULL)",
      "INSERT INTO idempotent (id, label) VALUES (1, 'first')",
    ];
    await applyStatements(db, statements);
    await applyStatements(db, statements);

    const result = await db.db.execute(sql`select count(*)::int as count from idempotent`);
    expect(result.rows[0]).toEqual({ count: 1 });
  });

  it("rolls back the whole batch when one statement fails", async () => {
    await expect(
      applyStatements(db, [
        "CREATE TABLE rolled_back (id int PRIMARY KEY)",
        "INSERT INTO rolled_back (id) VALUES (1)",
        "INSERT INTO table_that_does_not_exist (id) VALUES (1)",
      ]),
    ).rejects.toThrow();

    const result = await db.db.execute(sql`select to_regclass('public.rolled_back') as table_name`);
    expect(result.rows[0]).toEqual({ table_name: null });
  });

  it("reads a drizzle-kit migration directory in filename order", async () => {
    const directory = mkdtempSync(join(tmpdir(), "facilis-migrations-"));
    try {
      writeFileSync(
        join(directory, "0001_init.sql"),
        [
          "CREATE TABLE dir_probe (id int PRIMARY KEY)",
          "--> statement-breakpoint",
          "INSERT INTO dir_probe (id) VALUES (7)",
        ].join("\n"),
        "utf8",
      );
      writeFileSync(
        join(directory, "0002_more.sql"),
        "INSERT INTO dir_probe (id) VALUES (8)",
        "utf8",
      );

      await applyMigrations(db, { directory });
      await applyMigrations(db, { directory });

      const result = await db.db.execute(sql`select id from dir_probe order by id`);
      expect(result.rows).toEqual([{ id: 7 }, { id: 8 }]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("splits drizzle-kit statement-breakpoint batches inside one entry", async () => {
    await applyStatements(db, [
      [
        "CREATE TABLE batched (id int PRIMARY KEY)",
        "--> statement-breakpoint",
        "INSERT INTO batched (id) VALUES (1)",
        "--> statement-breakpoint",
        "INSERT INTO batched (id) VALUES (2)",
      ].join("\n"),
    ]);

    const result = await db.db.execute(sql`select id from batched order by id`);
    expect(result.rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("accepts plain SQL text as a single migration", async () => {
    await applyMigrations(db, "CREATE TABLE text_migration (id int)");
    const result = await db.db.execute(sql`select to_regclass('public.text_migration') as name`);
    expect(result.rows[0]?.name).toBe("text_migration");
  });
});
