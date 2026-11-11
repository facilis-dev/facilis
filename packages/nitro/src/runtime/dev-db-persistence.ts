// Dev database persistence (D-052).
//
// PGlite runs in memory for speed, but a memory-only dev database is wiped every time
// the Nitro worker restarts — which happens on every edit to a server route. That made
// "register a user, change a handler, log in again" the normal loop. This module keeps a
// single snapshot archive in the project's `.facilis/db` directory:
//
//   boot:   read `.facilis/db/snapshot.tar.gz` -> `createDb({ loadSnapshot })`
//   run:    every tick, if the cluster changed, `dumpDataDir('gzip')` -> write atomically
//   stop:   flush()
//
// One file, ~5 MB for a small app, so it crosses the VFS/OPFS mirror cheaply and the
// project's scoped restore (D-036) replays exactly one path. The directory is per-project
// state, never source: `.facilis/.gitignore` ignores the whole tree for git, and the IDE
// hides it from the Explorer/index/export.
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FacilisDb } from "@facilis.dev/db";

/** Per-project, non-source state directory (dev database, binary blobs). */
export const FACILIS_STATE_DIR = ".facilis";
/** The dev database snapshot, relative to the project root. */
export const DEV_DB_SNAPSHOT_FILE = join(FACILIS_STATE_DIR, "db", "snapshot.tar.gz");
const SNAPSHOT_INTERVAL_MS = 1_000;

/** What the snapshotter needs from the database handle. */
export type SnapshotSource = Pick<FacilisDb, "activity" | "snapshot">;

export interface DevDbSnapshotter {
  /** Write a snapshot now if the cluster changed since the last one. */
  flush(): Promise<void>;
  stop(): void;
  /** Epoch ms of the last successful snapshot, or null before the first one. */
  lastSnapshotAt(): number | null;
}

export function devDbSnapshotPath(projectRoot: string): string {
  return join(projectRoot, DEV_DB_SNAPSHOT_FILE);
}

/**
 * Create `.facilis` and its self-ignoring `.gitignore`.
 *
 * The folder must persist in the VFS (that is how it survives a reload), but it is not
 * source: a `.gitignore` containing `*` ignores the whole tree even when the project's
 * own .gitignore was written before this directory existed. Written idempotently, and
 * never overwriting a file the user may have edited.
 */
export async function ensureFacilisStateDir(projectRoot: string): Promise<void> {
  const dir = join(projectRoot, FACILIS_STATE_DIR);
  await mkdir(dir, { recursive: true });
  const ignore = join(dir, ".gitignore");
  try {
    await access(ignore);
  } catch {
    await writeFile(ignore, "*\n");
  }
}

/** Read the dev snapshot; null when the project has none yet. */
export async function readDevDbSnapshot(path: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") return null;
    throw error;
  }
}

export interface DevDbSnapshotterOptions {
  readonly db: SnapshotSource;
  readonly projectRoot: string;
  readonly snapshotPath?: string;
  readonly intervalMs?: number;
  /** Called with a failed dump/write; the previous snapshot stays valid. */
  readonly onError?: (error: unknown) => void;
}

/**
 * Start snapshotting a dev database. Only a changed cluster is dumped (`activity()`),
 * so an idle project never pays for a dump, and a failed write keeps the last good file.
 */
export function installDevDbSnapshotter(options: DevDbSnapshotterOptions): DevDbSnapshotter {
  const { db, projectRoot } = options;
  const snapshotPath = options.snapshotPath ?? devDbSnapshotPath(projectRoot);
  const intervalMs = options.intervalMs ?? SNAPSHOT_INTERVAL_MS;
  // Nothing has been dumped yet: the first tick persists the boot state (migrations,
  // seeds), not just the first request-driven write after it.
  let seen = 0;
  let saving = false;
  let dirty = false;
  let stopped = false;
  let lastSnapshotAt: number | null = null;

  const save = async (): Promise<void> => {
    if (saving) {
      dirty = true;
      return;
    }
    saving = true;
    const activityAtStart = db.activity();
    try {
      const bytes = await db.snapshot();
      await ensureFacilisStateDir(projectRoot);
      await writeAtomic(snapshotPath, bytes);
      seen = activityAtStart;
      lastSnapshotAt = Date.now();
    } catch (error) {
      options.onError?.(error);
    } finally {
      saving = false;
      if (dirty && !stopped) {
        dirty = false;
        void save();
      }
    }
  };

  const tick = (): void => {
    if (stopped || saving) return;
    if (db.activity() === seen) return;
    void save();
  };

  const timer = setInterval(tick, intervalMs);
  // Never keep the process (or a test run) alive for the snapshot ticker alone.
  (timer as { unref?: () => void }).unref?.();
  return {
    async flush() {
      if (db.activity() !== seen) await save();
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    lastSnapshotAt: () => lastSnapshotAt,
  };
}

/** Write via a sibling temp file + rename, so a killed process never truncates the snapshot. */
async function writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + ".tmp";
  await writeFile(temp, bytes);
  await rename(temp, path);
}
