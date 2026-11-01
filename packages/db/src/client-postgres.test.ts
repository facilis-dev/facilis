import { eq, sql } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDb,
  DbConnectionError,
  DriverNotImplementedError,
  SnapshotUnavailableError,
  type CreateDbOptions,
  type FacilisDb,
} from "./client.ts";
import { applyStatements } from "./migrator.ts";
import { startPostgresServer, type PostgresTestServer } from "../test-fixtures/postgres-server.ts";

const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
});

function firstRow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected the driver to return a row");
  return row;
}

describe("createDb (postgres driver, real wire protocol)", () => {
  let server: PostgresTestServer;
  let db: FacilisDb;

  beforeAll(async () => {
    server = await startPostgresServer();
    db = await createDb({ driver: "postgres", url: server.url, schema: { notes }, poolMax: 4 });
    await applyStatements(db, [
      "CREATE TABLE notes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL)",
    ]);
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await server.stop();
  });

  it("reports the postgres driver and the configured schema", () => {
    expect(db.driver).toBe("postgres");
    expect(db.schema).toEqual({ notes });
  });

  it("runs CRUD through drizzle", async () => {
    const created = firstRow(
      await db.db.insert(notes).values({ title: "first" }).returning({
        id: notes.id,
        title: notes.title,
      }),
    );
    expect(created.title).toBe("first");
    expect(await db.db.select().from(notes)).toEqual([created]);

    await db.db.update(notes).set({ title: "renamed" }).where(eq(notes.id, created.id));
    const renamed = firstRow(await db.db.select().from(notes).where(eq(notes.id, created.id)));
    expect(renamed.title).toBe("renamed");

    await db.db.delete(notes).where(eq(notes.id, created.id));
    expect(await db.db.select().from(notes)).toEqual([]);
  });

  it("rolls a thrown transaction back", async () => {
    await expect(
      db.db.transaction(async (tx) => {
        await tx.insert(notes).values({ title: "rolled-back" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await db.db.select().from(notes).where(eq(notes.title, "rolled-back"))).toEqual([]);
  });

  it("returns 0 from activity(): the dev snapshotter is pglite-only", async () => {
    await db.db.execute(sql.raw("select 1"));
    expect(db.activity()).toBe(0);
  });

  it("throws a typed SnapshotUnavailableError from snapshot()", async () => {
    await expect(db.snapshot()).rejects.toBeInstanceOf(SnapshotUnavailableError);
    await expect(db.snapshot()).rejects.toMatchObject({ code: "snapshot_unavailable" });
  });

  it("ends the pool on close()", async () => {
    const disposable = await createDb({ driver: "postgres", url: server.url });
    await disposable.close();
    await expect(disposable.db.execute(sql.raw("select 1"))).rejects.toThrow();
  });

  it("rejects an unreachable url with a typed error that leaks no credentials", async () => {
    let caught: unknown;
    try {
      await createDb({
        driver: "postgres",
        url: "postgres://facilis:s3cret@127.0.0.1:1/facilis",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DbConnectionError);
    expect(caught).toMatchObject({ code: "db_connection_failed" });
    const message = caught instanceof Error ? caught.message : "";
    expect(message).not.toContain("s3cret");
    expect(message).not.toContain("127.0.0.1");
  });

  it("rejects a postgres driver without a url before touching the network", async () => {
    await expect(createDb({ driver: "postgres" })).rejects.toMatchObject({
      code: "db_connection_failed",
    });
  });

  it("rejects an unknown runtime driver with the not-implemented error", async () => {
    const options = { driver: "mysql" } as unknown as CreateDbOptions;
    await expect(createDb(options)).rejects.toBeInstanceOf(DriverNotImplementedError);
  });
});
