import { describe, expect, it } from "vitest";
import type { GitFs, GitStat } from "@/vv/git-fs";
import type { KernelBridge } from "@/vv/kernel";
import {
  classifyStatusRow,
  createGitCheckpoint,
  type GitCheckpointDeps,
  type GitCheckpointGit,
  type StatusRow,
} from "./git-checkpoint";
import type { GitSafety } from "./types";

const ROOT = "/project";

type GitResult = { ok: true } | { ok: false; error: string };

interface HarnessOptions {
  root?: string | null;
  gitDir?: "dir" | "file" | "missing";
  /** The resolved HEAD oid; undefined means the repository has no commit yet. */
  head?: string;
  rows?: readonly StatusRow[];
  statusError?: unknown;
  unlinkError?: (absolutePath: string) => unknown;
  checkoutError?: (filepaths: readonly string[]) => unknown;
  commitResult?: GitResult;
  commitError?: unknown;
  initResult?: GitResult;
  initError?: unknown;
}

interface FakeState {
  statPaths: string[];
  matrixWalks: number;
  unlinked: string[];
  checkouts: { dir: string; filepaths: string[]; force: boolean }[];
  commits: string[];
  inits: string[];
}

function harness(options: HarnessOptions = {}): { safety: GitSafety; state: FakeState } {
  const state: FakeState = {
    statPaths: [],
    matrixWalks: 0,
    unlinked: [],
    checkouts: [],
    commits: [],
    inits: [],
  };

  const fs = {
    promises: {
      async stat(path: string) {
        state.statPaths.push(path);
        if (options.gitDir === "missing") {
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        }
        return { isDirectory: () => options.gitDir !== "file" } as unknown as GitStat;
      },
      async unlink(path: string) {
        const error = options.unlinkError?.(path);
        if (error !== undefined) throw error;
        state.unlinked.push(path);
      },
    },
  } as unknown as GitFs;

  const git: GitCheckpointGit = {
    async resolveRef() {
      if (options.head === undefined) throw new Error("HEAD is unborn");
      return options.head;
    },
    async statusMatrix(args) {
      state.matrixWalks += 1;
      if (options.statusError !== undefined) throw options.statusError;
      const filter = args.filter;
      return (options.rows ?? []).filter((row) => filter === undefined || filter(String(row[0])));
    },
    async checkout(args) {
      state.checkouts.push({ dir: args.dir, filepaths: [...args.filepaths], force: args.force });
      const error = options.checkoutError?.(args.filepaths);
      if (error !== undefined) throw error;
    },
  };

  const deps: GitCheckpointDeps = {
    bridge: {} as unknown as KernelBridge,
    root: () => ("root" in options ? (options.root ?? null) : ROOT),
    commit: async (root) => {
      state.commits.push(root);
      if (options.commitError !== undefined) throw options.commitError;
      return options.commitResult ?? { ok: true };
    },
    init: async (root) => {
      state.inits.push(root);
      if (options.initError !== undefined) throw options.initError;
      return options.initResult ?? { ok: true };
    },
  };

  const safety = createGitCheckpoint(deps, { git: async () => git, fs: () => fs });
  return { safety, state };
}

const DIRTY_ROWS: readonly StatusRow[] = [
  ["src/z.ts", 1, 2, 1], // modified in the working tree
  ["src/new.ts", 0, 2, 0], // untracked
  ["src/gone.ts", 1, 0, 0], // deleted from the working tree
  ["src/staged.ts", 1, 1, 2], // staged-only modification
  ["src/clean.ts", 1, 1, 1], // clean
  ["node_modules/pkg/index.js", 0, 2, 0], // ignored by IGNORE_RE
];

describe("classifyStatusRow", () => {
  it("treats a row whose three cells agree as clean", () => {
    for (const head of [0, 1, 2, 3]) {
      for (const workdir of [0, 1, 2, 3]) {
        for (const stage of [0, 1, 2, 3]) {
          const row: StatusRow = ["src/a.ts", head, workdir, stage];
          if (head === workdir && workdir === stage) {
            expect(classifyStatusRow(row)).toBeNull();
          } else {
            expect(classifyStatusRow(row)).not.toBeNull();
          }
        }
      }
    }
  });

  it("marks a path absent from HEAD as added, tracked or not", () => {
    expect(classifyStatusRow(["src/new.ts", 0, 2, 0])).toEqual({ path: "src/new.ts", letter: "A" });
    expect(classifyStatusRow(["src/new.ts", 0, 2, 2])).toEqual({ path: "src/new.ts", letter: "A" });
  });

  it("marks a path gone from the working tree as deleted", () => {
    expect(classifyStatusRow(["src/gone.ts", 1, 0, 0])).toEqual({
      path: "src/gone.ts",
      letter: "D",
    });
    expect(classifyStatusRow(["src/gone.ts", 1, 0, 1])).toEqual({
      path: "src/gone.ts",
      letter: "D",
    });
  });

  it("marks every other difference as modified, staged-only included", () => {
    expect(classifyStatusRow(["src/a.ts", 1, 2, 1])).toEqual({ path: "src/a.ts", letter: "M" });
    expect(classifyStatusRow(["src/a.ts", 1, 1, 2])).toEqual({ path: "src/a.ts", letter: "M" });
    expect(classifyStatusRow(["src/a.ts", 1, 2, 2])).toEqual({ path: "src/a.ts", letter: "M" });
  });

  it("skips a row of an unexpected shape", () => {
    expect(classifyStatusRow([])).toBeNull();
    expect(classifyStatusRow([42, 0, 2, 0])).toBeNull();
    expect(classifyStatusRow(["src/a.ts", "1", 2, 0])).toBeNull();
  });
});

describe("gate", () => {
  it("refuses without an open project", async () => {
    const { safety, state } = harness({ root: null });
    expect(await safety.gate()).toEqual({ ok: false, failure: { code: "no-repo" } });
    expect(state.statPaths).toEqual([]);
    expect(state.matrixWalks).toBe(0);
  });

  it("refuses when the project has no .git folder", async () => {
    const { safety, state } = harness({ gitDir: "missing" });
    expect(await safety.gate()).toEqual({ ok: false, failure: { code: "no-repo" } });
    expect(state.statPaths).toEqual([ROOT + "/.git"]);
    expect(state.matrixWalks).toBe(0);
  });

  it("refuses when .git is not a directory", async () => {
    const { safety } = harness({ gitDir: "file" });
    expect(await safety.gate()).toEqual({ ok: false, failure: { code: "no-repo" } });
  });

  it("refuses a repository with no HEAD commit", async () => {
    const { safety, state } = harness({ rows: [] });
    expect(await safety.gate()).toEqual({ ok: false, failure: { code: "no-head" } });
    expect(state.matrixWalks).toBe(0);
  });

  it("allows a clean tree and reports HEAD", async () => {
    const { safety } = harness({
      head: "abc123",
      rows: [
        ["src/a.ts", 1, 1, 1],
        ["node_modules/pkg/index.js", 0, 2, 0],
      ],
    });
    expect(await safety.gate()).toEqual({ ok: true, head: "abc123" });
  });

  it("lists the dirty paths, sorted and without ignored folders", async () => {
    const { safety } = harness({ head: "abc123", rows: DIRTY_ROWS });
    expect(await safety.gate()).toEqual({
      ok: false,
      failure: {
        code: "dirty-tree",
        changes: [
          { path: "src/gone.ts", letter: "D" },
          { path: "src/new.ts", letter: "A" },
          { path: "src/staged.ts", letter: "M" },
          { path: "src/z.ts", letter: "M" },
        ],
      },
    });
  });

  it("is read-only", async () => {
    const { safety, state } = harness({ head: "abc123", rows: DIRTY_ROWS });
    await safety.gate();
    expect(state.unlinked).toEqual([]);
    expect(state.checkouts).toEqual([]);
    expect(state.commits).toEqual([]);
    expect(state.inits).toEqual([]);
  });
});

describe("restore", () => {
  it("deletes a path that HEAD does not have", async () => {
    const { safety, state } = harness({ rows: [["src/new.ts", 0, 2, 0]] });
    expect(await safety.restore(["src/new.ts"])).toEqual({ ok: true, errors: [] });
    expect(state.unlinked).toEqual([ROOT + "/src/new.ts"]);
    expect(state.checkouts).toEqual([]);
  });

  it("treats an already-missing new path as restored", async () => {
    const { safety, state } = harness({
      rows: [["src/new.ts", 0, 2, 0]],
      unlinkError: () => Object.assign(new Error("missing"), { code: "ENOENT" }),
    });
    expect(await safety.restore(["src/new.ts"])).toEqual({ ok: true, errors: [] });
    expect(state.unlinked).toEqual([]);
  });

  it("reports an unlink failure per path without throwing", async () => {
    const { safety, state } = harness({
      rows: [["src/new.ts", 0, 2, 0]],
      unlinkError: () => Object.assign(new Error("denied"), { code: "EACCES" }),
    });
    expect(await safety.restore(["src/new.ts"])).toEqual({
      ok: false,
      errors: ["src/new.ts: denied"],
    });
    expect(state.unlinked).toEqual([]);
  });

  it("checks a tracked path out from the index (HEAD while the gate holds)", async () => {
    const { safety, state } = harness({
      rows: [
        ["src/a.ts", 1, 2, 1],
        ["src/gone.ts", 1, 0, 0],
      ],
    });
    expect(await safety.restore(["src/a.ts", "src/gone.ts"])).toEqual({ ok: true, errors: [] });
    expect(state.checkouts).toEqual([
      { dir: ROOT, filepaths: ["src/a.ts"], force: true },
      { dir: ROOT, filepaths: ["src/gone.ts"], force: true },
    ]);
  });

  it("keeps going after one path fails and reports it", async () => {
    const { safety, state } = harness({
      rows: [
        ["src/a.ts", 1, 2, 1],
        ["src/b.ts", 1, 2, 1],
      ],
      checkoutError: (filepaths) => (filepaths[0] === "src/a.ts" ? new Error("locked") : undefined),
    });
    expect(await safety.restore(["src/a.ts", "src/b.ts"])).toEqual({
      ok: false,
      errors: ["src/a.ts: locked"],
    });
    expect(state.checkouts.map((call) => call.filepaths)).toEqual([["src/a.ts"], ["src/b.ts"]]);
  });

  it("skips paths that are already clean or absent from the walk", async () => {
    const { safety, state } = harness({ rows: [["src/a.ts", 1, 1, 1]] });
    expect(await safety.restore(["src/a.ts", "src/never.ts"])).toEqual({ ok: true, errors: [] });
    expect(state.unlinked).toEqual([]);
    expect(state.checkouts).toEqual([]);
  });

  it("walks status fresh on every undo", async () => {
    const { safety, state } = harness({ rows: [] });
    await safety.restore(["src/a.ts"]);
    await safety.restore(["src/b.ts"]);
    expect(state.matrixWalks).toBe(2);
  });

  it("reports a failed walk per path and never throws", async () => {
    const { safety, state } = harness({ statusError: new Error("walk failed") });
    expect(await safety.restore(["src/a.ts", "src/b.ts"])).toEqual({
      ok: false,
      errors: ["src/a.ts: walk failed", "src/b.ts: walk failed"],
    });
    expect(state.unlinked).toEqual([]);
    expect(state.checkouts).toEqual([]);
  });

  it("refuses without an open project", async () => {
    const { safety } = harness({ root: null });
    expect(await safety.restore(["src/a.ts"])).toEqual({
      ok: false,
      errors: ["src/a.ts: no project is open"],
    });
  });
});

describe("commitAll", () => {
  it("delegates to the host on the open root", async () => {
    const { safety, state } = harness();
    expect(await safety.commitAll()).toEqual({ ok: true });
    expect(state.commits).toEqual([ROOT]);
  });

  it("passes a host failure through", async () => {
    const { safety } = harness({ commitResult: { ok: false, error: "set a git identity first" } });
    expect(await safety.commitAll()).toEqual({ ok: false, error: "set a git identity first" });
  });

  it("turns a thrown host failure into a typed error", async () => {
    const { safety } = harness({ commitError: new Error("boom") });
    expect(await safety.commitAll()).toEqual({ ok: false, error: "boom" });
  });

  it("refuses without an open project", async () => {
    const { safety, state } = harness({ root: null });
    expect(await safety.commitAll()).toEqual({ ok: false, error: "no project is open" });
    expect(state.commits).toEqual([]);
  });
});

describe("init", () => {
  it("delegates to the host on the open root", async () => {
    const { safety, state } = harness();
    expect(await safety.init()).toEqual({ ok: true });
    expect(state.inits).toEqual([ROOT]);
  });

  it("passes the host result through", async () => {
    const { safety } = harness({ initResult: { ok: false, error: "init failed" } });
    expect(await safety.init()).toEqual({ ok: false, error: "init failed" });
  });

  it("refuses without an open project", async () => {
    const { safety, state } = harness({ root: null });
    expect(await safety.init()).toEqual({ ok: false, error: "no project is open" });
    expect(state.inits).toEqual([]);
  });
});
