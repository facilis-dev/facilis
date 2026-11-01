import { describe, expect, it } from "vitest";
import { APP_MANIFEST_FILE, renderAppManifest } from "../app-manifest";
import { applyUpgrade, UpgradeError, type UpgradeIo } from "./apply";

const ROOT = "/home/user/projects/app";
const MARKER = ROOT + "/" + APP_MANIFEST_FILE;
const NOW = new Date("2026-11-01T10:00:00Z");

/** An in-memory VFS; \`ops\` records the calls in order so ordering stays assertable. */
function memory(files: Record<string, string>, failWriteOn = -1, failWritePath = "") {
  const disk = new Map(Object.entries(files));
  const ops: string[] = [];
  let writes = 0;
  const io: UpgradeIo = {
    read: async (path) => {
      const value = disk.get(path);
      return value === undefined ? null : value;
    },
    write: async (path, content) => {
      writes += 1;
      if (writes === failWriteOn || path === failWritePath) throw new Error("disk full");
      ops.push("write " + path);
      disk.set(path, content);
    },
    remove: async (path) => {
      ops.push("remove " + path);
      disk.delete(path);
    },
  };
  return { disk, ops, io };
}

const change = (path: string, before: string | null, after: string | null) => ({
  path,
  before,
  after,
});

describe("applying an upgrade", () => {
  it("writes the files and moves the marker last", async () => {
    const { disk, ops, io } = memory({
      [MARKER]: renderAppManifest("2026.10", NOW),
      [ROOT + "/a.txt"]: "old\n",
    });

    const result = await applyUpgrade({
      root: ROOT,
      changes: [change("a.txt", "old\n", "new\n")],
      targetVersion: "2026.11",
      now: NOW,
      io,
    });

    expect(result.applied).toEqual(["a.txt"]);
    expect(disk.get(ROOT + "/a.txt")).toBe("new\n");
    expect(JSON.parse(disk.get(MARKER) ?? "{}")).toMatchObject({
      environmentVersion: "2026.11",
      templateVersion: "2026.11",
      createdAt: NOW.toISOString(),
    });
    // The marker is the commit point, so it is the last write of the run.
    expect(ops.filter((op) => op.startsWith("write ")).at(-1)).toBe("write " + MARKER);
  });

  it("deletes a file the plan removes", async () => {
    const { disk, io } = memory({
      [MARKER]: renderAppManifest("2026.10", NOW),
      [ROOT + "/gone.txt"]: "x",
    });
    await applyUpgrade({
      root: ROOT,
      changes: [change("gone.txt", "x", null)],
      targetVersion: "2026.11",
      now: NOW,
      io,
    });
    expect(disk.has(ROOT + "/gone.txt")).toBe(false);
  });

  it("refuses a plan the project no longer matches, without writing", async () => {
    const { disk, ops, io } = memory({
      [MARKER]: renderAppManifest("2026.10", NOW),
      [ROOT + "/a.txt"]: "edited by hand\n",
    });

    await expect(
      applyUpgrade({
        root: ROOT,
        changes: [change("a.txt", "old\n", "new\n")],
        targetVersion: "2026.11",
        now: NOW,
        io,
      }),
    ).rejects.toBeInstanceOf(UpgradeError);

    expect(disk.get(ROOT + "/a.txt")).toBe("edited by hand\n");
    expect(disk.get(MARKER)).toBe(renderAppManifest("2026.10", NOW));
    expect(ops).toEqual([]);
  });

  it("rolls back the files already written when a later write fails", async () => {
    const { disk, io } = memory(
      {
        [MARKER]: renderAppManifest("2026.10", NOW),
        [ROOT + "/a.txt"]: "a0",
        [ROOT + "/b.txt"]: "b0",
      },
      -1,
      ROOT + "/b.txt",
    );

    const failure = await applyUpgrade({
      root: ROOT,
      changes: [change("a.txt", "a0", "a1"), change("b.txt", "b0", "b1")],
      targetVersion: "2026.11",
      now: NOW,
      io,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UpgradeError);
    const error = failure as UpgradeError;
    expect(error.path).toBe("b.txt");
    expect(error.rolledBack).toBe(true);
    expect(disk.get(ROOT + "/a.txt")).toBe("a0");
    expect(disk.get(ROOT + "/b.txt")).toBe("b0");
    // The marker never moved: a retry starts from the same version.
    expect(disk.get(MARKER)).toBe(renderAppManifest("2026.10", NOW));
  });

  it("rolls back when the postflight fails, and reports it", async () => {
    const { disk, io } = memory({
      [MARKER]: renderAppManifest("2026.10", NOW),
      [ROOT + "/a.txt"]: "a0",
    });

    const failure = await applyUpgrade({
      root: ROOT,
      changes: [change("a.txt", "a0", "a1")],
      targetVersion: "2026.11",
      now: NOW,
      io,
      postflight: async () => {
        throw new Error("tsc failed");
      },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UpgradeError);
    expect((failure as UpgradeError).path).toBe("postflight");
    expect(disk.get(ROOT + "/a.txt")).toBe("a0");
    expect(disk.get(MARKER)).toBe(renderAppManifest("2026.10", NOW));
  });

  it("skips a file that is already in its target state", async () => {
    const { disk, ops, io } = memory({
      [MARKER]: renderAppManifest("2026.10", NOW),
      [ROOT + "/a.txt"]: "same",
    });
    const result = await applyUpgrade({
      root: ROOT,
      changes: [change("a.txt", "same", "same")],
      targetVersion: "2026.11",
      now: NOW,
      io,
    });
    expect(result.skipped).toEqual(["a.txt"]);
    // Only the marker moved: the file itself was already what the plan wanted.
    expect(ops).toEqual(["write " + MARKER]);
    expect(disk.get(ROOT + "/a.txt")).toBe("same");
  });

  it("removes a file whose before state is also absent on rollback", async () => {
    const { disk, io } = memory(
      { [MARKER]: renderAppManifest("2026.10", NOW) },
      -1,
      ROOT + "/later.txt",
    );
    const failure = await applyUpgrade({
      root: ROOT,
      changes: [change("new.txt", null, "created"), change("later.txt", null, "created too")],
      targetVersion: "2026.11",
      now: NOW,
      io,
    }).catch((error: unknown) => error);

    expect((failure as UpgradeError).path).toBe("later.txt");
    // The file created by the first change is gone again.
    expect(disk.has(ROOT + "/new.txt")).toBe(false);
  });
});
