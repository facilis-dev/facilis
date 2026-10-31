import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createDb, DriverNotImplementedError } from "./client.ts";
import { applyStatements } from "./migrator.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "facilis-db-"));
  tempDirs.push(directory);
  return directory;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
});

describe("createDb", () => {
  it("boots an in-memory PGlite database and runs a query", async () => {
    const db = await createDb();
    try {
      expect(db.driver).toBe("pglite");
      const result = await db.db.execute(sql`select 1 as one`);
      expect(result.rows).toEqual([{ one: 1 }]);
    } finally {
      await db.close();
    }
  });

  it("honours dataDir so data survives a close/reopen cycle", async () => {
    const dataDir = makeTempDir();

    const first = await createDb({ dataDir });
    await applyStatements(first, [
      "CREATE TABLE persisted (id int PRIMARY KEY, label text NOT NULL)",
      "INSERT INTO persisted (id, label) VALUES (1, 'kept')",
    ]);
    await first.close();

    const second = await createDb({ dataDir });
    try {
      const result = await second.db.execute(sql`select label from persisted where id = 1`);
      expect(result.rows).toEqual([{ label: "kept" }]);
    } finally {
      await second.close();
    }
  });

  it("rejects the unimplemented postgres driver with a typed error", async () => {
    await expect(
      createDb({ driver: "postgres", url: "postgres://localhost/facilis" }),
    ).rejects.toBeInstanceOf(DriverNotImplementedError);
    await expect(createDb({ url: "postgres://localhost/facilis" })).rejects.toMatchObject({
      code: "driver_not_implemented",
    });
  });

  it("defaults to an empty schema namespace", async () => {
    const db = await createDb();
    try {
      expect(db.schema).toEqual({});
    } finally {
      await db.close();
    }
  });

  it("round-trips a cluster through snapshot()/loadSnapshot", async () => {
    const first = await createDb();
    let bytes: Uint8Array;
    try {
      await applyStatements(first, [
        "CREATE TABLE snapshotted (id int PRIMARY KEY, label text NOT NULL)",
        "INSERT INTO snapshotted (id, label) VALUES (1, 'from-snapshot')",
      ]);
      bytes = await first.snapshot();
      expect(bytes.byteLength).toBeGreaterThan(0);
    } finally {
      await first.close();
    }

    const restored = await createDb({ loadSnapshot: bytes });
    try {
      const result = await restored.db.execute(sql`select label from snapshotted where id = 1`);
      expect(result.rows).toEqual([{ label: "from-snapshot" }]);
    } finally {
      await restored.close();
    }
  });

  it("counts client activity so the dev snapshotter can skip idle ticks", async () => {
    const db = await createDb();
    try {
      const before = db.activity();
      await db.db.execute(sql`select 1 as one`);
      expect(db.activity()).toBeGreaterThan(before);
      const afterQuery = db.activity();
      await db.db.execute(sql`select 2 as two`);
      expect(db.activity()).toBeGreaterThan(afterQuery);
    } finally {
      await db.close();
    }
  });
});
