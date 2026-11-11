// Reads release snapshots out of the git tree in the VFS (D-086, resolves O-008).
//
// The panel diffs what the repository declares at two refs; it never boots a project at an
// old commit (slow, mutates the VFS, needs a healthy runtime). isomorphic-git runs on the
// main thread over the kernel VFS through createGitFs (the silent vv-git-fs RPC), and the
// ~1 MB module is lazy-loaded with the Buffer polyfill installed first (same pattern as
// scm-session.ts). The schema is `@facilis.dev/analyze` facts over the ref's DSL sources (D-094),
// so the analyzer is injected rather than imported: the Studio passes its worker, tests a
// parser they can run. Every exported function is throw-free: a missing ref, a broken repo
// or a failed analysis is data the panel renders, never an exception that reaches the editor.

import type { FsClient } from "isomorphic-git";
import type { IdeController } from "@/vv/controller";
import type {
  GitRef,
  ReleaseMigrationFile,
  ReleaseRouteFact,
  ReleaseSnapshot,
} from "./release-engine";
import type { ReleaseRefInventory } from "./release-preview-model";
import { mergeRouteMetadata, routesFromFiles } from "./release-routes";
import {
  isSchemaSourcePath,
  readReleaseSchema,
  schemaSourcePaths,
  type SchemaAnalyzer,
} from "./release-schema";

const ROUTES_DIR = "server/routes/";
const MIGRATIONS_DIR = "db/migrations/";

type GitModule = typeof import("isomorphic-git");

const EMPTY_REFS: ReleaseRefInventory = {
  head: null,
  currentBranch: null,
  branches: [],
  tags: [],
};

/** Branches (local + `origin/*`), tags and the current HEAD of the repository at `root`. */
export async function listReleaseRefs(root: string, fs: FsClient): Promise<ReleaseRefInventory> {
  try {
    const git = await loadGit();
    const [headOid, branch, local, remote, tags] = await Promise.all([
      git.resolveRef({ fs, dir: root, ref: "HEAD" }).catch(() => null),
      git.currentBranch({ fs, dir: root, fullname: false }).catch(() => null),
      git.listBranches({ fs, dir: root }).catch(() => [] as string[]),
      git.listBranches({ fs, dir: root, remote: "origin" }).catch(() => [] as string[]),
      git.listTags({ fs, dir: root }).catch(() => [] as string[]),
    ]);
    return {
      head: headOid === null ? null : { kind: "commit", ref: "HEAD", oid: headOid },
      currentBranch: branch ?? null,
      branches: [...local, ...remote.map((name) => "origin/" + name)].toSorted(),
      tags: [...tags].toSorted(),
    };
  } catch {
    return { ...EMPTY_REFS };
  }
}

/** Resolve HEAD, a branch, a remote branch or a tag; null when the ref does not exist. */
export async function resolveReleaseRef(
  root: string,
  ref: string,
  fs: FsClient,
): Promise<GitRef | null> {
  try {
    const git = await loadGit();
    const [tags, branches, remote] = await Promise.all([
      git.listTags({ fs, dir: root }).catch(() => [] as string[]),
      git.listBranches({ fs, dir: root }).catch(() => [] as string[]),
      git.listBranches({ fs, dir: root, remote: "origin" }).catch(() => [] as string[]),
    ]);
    const kind = classifyRef(ref, tags, branches, remote);
    const oid = await git.resolveRef({ fs, dir: root, ref });
    return { kind, ref, oid };
  } catch {
    return null;
  }
}

function classifyRef(
  ref: string,
  tags: readonly string[],
  branches: readonly string[],
  remote: readonly string[],
): GitRef["kind"] {
  if (ref === "HEAD" || /^[0-9a-f]{7,40}$/i.test(ref)) return "commit";
  if (tags.includes(ref)) return "tag";
  if (branches.includes(ref)) return "branch";
  if (ref.startsWith("origin/") && remote.includes(ref.slice("origin/".length))) return "branch";
  return "commit";
}

/**
 * The declared schema, route files and migrations at `ref`. Null when the ref does not
 * resolve, the repository is missing, or an unreadable tree or failed analysis makes the
 * snapshot meaningless (a diff must never see tables that were silently dropped).
 */
export async function readSnapshotAt(
  root: string,
  ref: string,
  fs: FsClient,
  analyze: SchemaAnalyzer,
): Promise<ReleaseSnapshot | null> {
  try {
    const git = await loadGit();
    const oid = await git.resolveRef({ fs, dir: root, ref });
    const files = relevantFiles(await git.listFiles({ fs, dir: root, ref: oid }));
    return await assembleSnapshot({
      files,
      routes: routesFromFiles(files),
      analyze,
      readText: async (file) => {
        try {
          const { blob } = await git.readBlob({ fs, dir: root, oid, filepath: file });
          return new TextDecoder().decode(blob);
        } catch {
          return null;
        }
      },
    });
  } catch {
    return null;
  }
}

/**
 * The same snapshot read from the live VFS (the working-copy lens). `routeMetadata` is the
 * manifest's route list, which is the only source of permission/dbTables at the working
 * copy; without it a route carries method + path only.
 */
export async function readWorkingSnapshot(
  controller: IdeController,
  analyze: SchemaAnalyzer,
  routeMetadata?: readonly ReleaseRouteFact[],
): Promise<ReleaseSnapshot | null> {
  const root = controller.activeFolder?.rootPath ?? null;
  if (root === null) return null;
  try {
    const files = controller
      .getSnapshot()
      .files.filter((file) => file.startsWith(root + "/"))
      .map((file) => file.slice(root.length + 1));
    const relevant = relevantFiles(files);
    return await assembleSnapshot({
      files: relevant,
      routes: routesFromFiles(relevant),
      analyze,
      routeMetadata,
      readText: async (file) => {
        try {
          return await controller.readFileText(root + "/" + file);
        } catch {
          return null;
        }
      },
    });
  } catch {
    return null;
  }
}

interface SnapshotSource {
  readonly files: readonly string[];
  readonly routes: readonly ReleaseRouteFact[];
  readonly analyze: SchemaAnalyzer;
  readonly routeMetadata?: readonly ReleaseRouteFact[] | undefined;
  readonly readText: (file: string) => Promise<string | null>;
}

async function assembleSnapshot(source: SnapshotSource): Promise<ReleaseSnapshot | null> {
  const tables = await readReleaseSchema(
    schemaSourcePaths(source.files),
    source.readText,
    source.analyze,
  );
  if (tables === null) return null;
  const routes =
    source.routeMetadata === undefined
      ? [...source.routes]
      : mergeRouteMetadata(source.routes, source.routeMetadata);
  const migrations: ReleaseMigrationFile[] = [];
  for (const file of migrationFiles(source.files)) {
    // One read at a time: a fan-out floods the kernel worker's single-threaded fs queue.
    // oxlint-disable-next-line no-await-in-loop
    const sql = await source.readText(file);
    if (sql !== null && sql.length > 0) migrations.push({ path: file, sql });
  }
  return { schema: { tables }, routes, migrations };
}

/** Only the files a snapshot reads: schema sources, route modules and migrations. */
function relevantFiles(files: readonly string[]): string[] {
  return files.filter(
    (file) => isSchemaSourcePath(file) || file.startsWith(ROUTES_DIR) || isMigration(file),
  );
}

function migrationFiles(files: readonly string[]): string[] {
  return files.filter(isMigration).toSorted((left, right) => left.localeCompare(right));
}

function isMigration(file: string): boolean {
  return file.startsWith(MIGRATIONS_DIR) && file.endsWith(".sql");
}

// ── lazy git loading ──────────────────────────────────────────────────────────────

let gitPromise: Promise<GitModule> | null = null;

function loadGit(): Promise<GitModule> {
  gitPromise ??= ensureBuffer().then(() => import("isomorphic-git"));
  return gitPromise;
}

// isomorphic-git expects a global `Buffer` in the browser; install the polyfill once,
// before the chunk is imported. Idempotent and Node-safe (Node already has Buffer).
let bufferReady: Promise<void> | null = null;

function ensureBuffer(): Promise<void> {
  const globals = globalThis as { Buffer?: unknown };
  if (globals.Buffer !== undefined) return Promise.resolve();
  bufferReady ??= import("buffer").then(({ Buffer }) => {
    if (globals.Buffer === undefined) globals.Buffer = Buffer;
  });
  return bufferReady;
}
