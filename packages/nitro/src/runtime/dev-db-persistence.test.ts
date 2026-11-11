import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyStatements, createDb } from "@facilis.dev/db";
import { afterEach, describe, expect, it } from "vitest";

import {
  devDbSnapshotPath,
  ensureFacilisStateDir,
  installDevDbSnapshotter,
  readDevDbSnapshot,
} from "./dev-db-persistence.ts";

const roots: string[] = [];

function makeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "facilis-devdb-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe("dev database persistence", () => {
  it("round-trips a cluster through .facilis/db/snapshot.tar.gz", async () => {
    const root = makeProjectRoot();
    const db = await createDb();
    await applyStatements(db, [
      "CREATE TABLE persisted (id int PRIMARY KEY, label text NOT NULL)",
      "INSERT INTO persisted (id, label) VALUES (1, 'kept')",
    ]);

    const snapshotter = installDevDbSnapshotter({ db, projectRoot: root, intervalMs: 10 });
    await snapshotter.flush();
    snapshotter.stop();
    await db.close();

    const path = devDbSnapshotPath(root);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(join(root, ".facilis", ".gitignore"), "utf8")).toBe("*\n");
    const bytes = await readDevDbSnapshot(path);
    expect(bytes).not.toBeNull();
    expect(bytes?.byteLength ?? 0).toBeGreaterThan(0);

    const restored = await createDb({ loadSnapshot: bytes ?? undefined });
    try {
      // The row survived: re-inserting its primary key must violate the constraint. (No
      // drizzle import here: @facilis.dev/nitro consumes the db package, not drizzle directly.)
      const failure = await applyStatements(restored, [
        "INSERT INTO persisted (id, label) VALUES (1, 'dup')",
      ]).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).not.toBeNull();
      const cause = (failure as { cause?: { code?: string; message?: string } }).cause;
      expect(cause?.code ?? cause?.message ?? String(failure)).toMatch(/23505|duplicate key/i);
    } finally {
      await restored.close();
    }
  });

  it("returns null when the project has no snapshot yet", async () => {
    expect(await readDevDbSnapshot(devDbSnapshotPath(makeProjectRoot()))).toBeNull();
  });

  it("does not dump an idle cluster and never overwrites a good snapshot with a failure", async () => {
    const root = makeProjectRoot();
    let activity = 0;
    let dumps = 0;
    const db = {
      activity: () => activity,
      snapshot: async () => {
        dumps += 1;
        return new Uint8Array([1, 2, 3]);
      },
    };
    const snapshotter = installDevDbSnapshotter({ db, projectRoot: root, intervalMs: 10 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(dumps).toBe(0);
    expect(existsSync(devDbSnapshotPath(root))).toBe(false);

    activity += 1;
    await snapshotter.flush();
    expect(dumps).toBe(1);
    const first = readFileSync(devDbSnapshotPath(root));

    // Same activity count: flush is a no-op, not another 5 MB write.
    await snapshotter.flush();
    expect(dumps).toBe(1);
    expect(readFileSync(devDbSnapshotPath(root))).toEqual(first);
    snapshotter.stop();
  });

  it("creates .facilis/.gitignore only when absent", async () => {
    const root = makeProjectRoot();
    await ensureFacilisStateDir(root);
    const ignore = join(root, ".facilis", ".gitignore");
    expect(readFileSync(ignore, "utf8")).toBe("*\n");
    await ensureFacilisStateDir(root);
    expect(readFileSync(ignore, "utf8")).toBe("*\n");
  });
});
