// The git-reading layer, exercised against a real repository in a temp directory: the VFS
// adapter is the only part the browser smoke covers, and the ref/blob logic is worth a unit
// test because a wrong tree read is silent (an empty snapshot looks like "nothing changed").
import { analyzeProject } from "@facilis.dev/analyze";
import * as git from "isomorphic-git";
import type { FsClient } from "isomorphic-git";
import { afterEach, describe, expect, it } from "vitest";
import { createBrowserOxcParser } from "./oxc-browser";
import { listReleaseRefs, readSnapshotAt, resolveReleaseRef } from "./release-git";
import type { SchemaAnalyzer } from "./release-schema";

// The same analyzer the Studio worker runs, on the Node parser binding: the release reader
// only needs the analyzer's contract, so the test does not boot a Worker.
const parser = createBrowserOxcParser();
const analyze: SchemaAnalyzer = async (files) => ({
  ok: true,
  analysis: analyzeProject({ files, parser }),
});

// The IDE's app tsconfig is a browser program with no Node types, so a literal
// `import "node:fs"` would pull @types/node in and clash with the DOM/vendor
// `ReadableStream` typings (D-086). Load the Node modules at runtime through a
// non-literal specifier and type only the narrow surface this suite uses.
interface NodePath {
  join(...parts: string[]): string;
  dirname(value: string): string;
}
interface NodeOs {
  tmpdir(): string;
}
interface NodeFs {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  mkdtemp(prefix: string): Promise<string>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  writeFile(path: string, data: string): Promise<void>;
}
const loadNode = (specifier: string): Promise<unknown> => import(specifier);
const path = (await loadNode("node:path")) as NodePath;
const os = (await loadNode("node:os")) as NodeOs;
const nodeFs = (await loadNode("node:fs/promises")) as NodeFs;
// isomorphic-git's FsClient is the promises surface; the suite needs the extra temp-dir
// helpers Node exposes, so the same module is passed under both narrow types.
const fs = nodeFs as unknown as FsClient;
const { mkdir, mkdtemp, rm, writeFile } = nodeFs;
const { tmpdir } = os;
const { dirname, join } = path;
const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const SCHEMA_V1 = `import { pgTable, text, uuid } from "drizzle-orm/pg-core";
export const todos = pgTable("todos", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
});
`;
const SCHEMA_V2 = `import { pgTable, boolean, text, uuid } from "drizzle-orm/pg-core";
export const todos = pgTable("todos", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
  done: boolean("done").notNull(),
});
`;
const ROUTE_FILE = "server/routes/api/todos/index.get.ts";
const ROUTE = 'export default defineAuthorizedHandler({ dbTables: ["todos"] }, () => []);\n';
const MIGRATION_FILE = "db/migrations/0001_add_done.sql";
const MIGRATION = 'ALTER TABLE "todos" ADD COLUMN "done" boolean NOT NULL;\n';

async function write(root: string, file: string, source: string): Promise<void> {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), source);
}

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "facilis-release-git-"));
  created.push(dir);
  await git.init({ fs, dir, defaultBranch: "main" });
  return dir;
}

async function commit(root: string, message: string, files: readonly string[]): Promise<string> {
  // Sequential by necessity: isomorphic-git rewrites the index on every add.
  // oxlint-disable-next-line no-await-in-loop
  for (const file of files) await git.add({ fs, dir: root, filepath: file });
  return git.commit({
    fs,
    dir: root,
    message,
    author: { name: "Release Test", email: "release@example.com" },
  });
}

async function firstCommit(): Promise<string> {
  const root = await initRepo();
  await write(root, "db/schema.ts", SCHEMA_V1);
  await write(root, ROUTE_FILE, ROUTE);
  await commit(root, "initial", ["db/schema.ts", ROUTE_FILE]);
  return root;
}

describe("release git reader", () => {
  it("lists refs and reads the snapshot at HEAD", async () => {
    const root = await initRepo();
    await write(root, "db/schema.ts", SCHEMA_V1);
    await write(root, ROUTE_FILE, ROUTE);
    const head = await commit(root, "initial", ["db/schema.ts", ROUTE_FILE]);

    const refs = await listReleaseRefs(root, fs);
    expect(refs.head).toEqual({ kind: "commit", ref: "HEAD", oid: head });
    expect(refs.currentBranch).toBe("main");
    expect(refs.branches).toContain("main");
    expect(refs.tags).toEqual([]);

    expect(await resolveReleaseRef(root, "HEAD", fs)).toEqual({
      kind: "commit",
      ref: "HEAD",
      oid: head,
    });

    const snapshot = await readSnapshotAt(root, "HEAD", fs, analyze);
    expect(snapshot?.schema.tables.map((table) => table.name)).toEqual(["todos"]);
    expect(snapshot?.schema.tables[0]?.columns).toEqual(["id", "title"]);
    expect(snapshot?.routes.map((route) => route.method + " " + route.path)).toEqual([
      "GET /api/todos",
    ]);
    expect(snapshot?.routes[0]?.sourceFile).toBe(ROUTE_FILE);
    expect(snapshot?.routes[0]?.permission).toBeUndefined();
    expect(snapshot?.migrations).toEqual([]);
  });

  it("keeps each ref's own snapshot and resolves tags", async () => {
    const root = await initRepo();
    await write(root, "db/schema.ts", SCHEMA_V1);
    await write(root, ROUTE_FILE, ROUTE);
    await commit(root, "initial", ["db/schema.ts", ROUTE_FILE]);
    await git.tag({ fs, dir: root, ref: "v0.1.0" });

    await write(root, "db/schema.ts", SCHEMA_V2);
    await write(root, MIGRATION_FILE, MIGRATION);
    await commit(root, "add done", ["db/schema.ts", MIGRATION_FILE]);

    expect(await resolveReleaseRef(root, "v0.1.0", fs)).toMatchObject({
      kind: "tag",
      ref: "v0.1.0",
    });
    expect((await listReleaseRefs(root, fs)).tags).toEqual(["v0.1.0"]);

    const old = await readSnapshotAt(root, "v0.1.0", fs, analyze);
    const tip = await readSnapshotAt(root, "HEAD", fs, analyze);
    expect(old?.schema.tables[0]?.columns).toEqual(["id", "title"]);
    expect(tip?.schema.tables[0]?.columns).toEqual(["id", "title", "done"]);
    expect(old?.migrations).toEqual([]);
    expect(tip?.migrations.map((migration) => migration.path)).toEqual([MIGRATION_FILE]);
    expect(tip?.migrations[0]?.sql).toContain("ADD COLUMN");
  });

  it("turns missing refs and non-repositories into empty data, never exceptions", async () => {
    const empty = await mkdtemp(join(tmpdir(), "facilis-release-empty-"));
    created.push(empty);
    expect(await readSnapshotAt(empty, "HEAD", fs, analyze)).toBeNull();
    expect(await resolveReleaseRef(empty, "HEAD", fs)).toBeNull();
    expect(await listReleaseRefs(empty, fs)).toEqual({
      head: null,
      currentBranch: null,
      branches: [],
      tags: [],
    });

    const root = await firstCommit();
    expect(await readSnapshotAt(root, "origin/main", fs, analyze)).toBeNull();
    expect(await resolveReleaseRef(root, "does-not-exist", fs)).toBeNull();
  });

  it("fails closed when the analyzer cannot run", async () => {
    const root = await firstCommit();
    expect(await readSnapshotAt(root, "HEAD", fs, analyze)).not.toBeNull();
    const broken: SchemaAnalyzer = async () => ({ ok: false, error: "no parser" });
    // A schema with silently missing tables would invent migrations, so it is "unreadable".
    expect(await readSnapshotAt(root, "HEAD", fs, broken)).toBeNull();
  });
});
