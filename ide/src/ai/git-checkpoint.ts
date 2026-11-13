// Git safety for the AI's source writes (D-181): HEAD plus a clean tree before the first
// write of a turn, and a restore path for the paths that turn wrote.
//
// The chat and the write tool only see the GitSafety contract; this is the implementation
// over the same isomorphic-git + git-fs stack Source Control uses (scm-session.ts). The
// browser has no child process, so every git call becomes a silent `vv-git-fs` kernel RPC.
//
// gate() is read-only by design: it answers HEAD or a typed refusal, and the user decides
// whether to commit, init or stop. restore() is the turn's Undo: a fresh status walk, then
// repair exactly the requested paths, so the undo can never touch a file the AI did not
// write. IGNORE_RE is shared with the SCM walk so the gate does not block on the build
// output and dependencies the panel itself hides.

import { loadGit } from "@/vv/git-api";
import { createGitFs, type GitFs } from "@/vv/git-fs";
import type { KernelBridge } from "@/vv/kernel";
import { IGNORE_RE } from "@/vv/scm-session";
import type { ChatGitChange, GitGate, GitSafety } from "./types";

/** What the checkpoint needs from its host (the controller and Source Control in the IDE). */
export interface GitCheckpointDeps {
  bridge: KernelBridge;
  /** Absolute VFS path of the open project, or null when nothing is open. */
  root(): string | null;
  /** Stage everything and commit it; the SCM panel owns identity and messaging. */
  commit(root: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Initialize a repository for a project that has none. */
  init(root: string): Promise<{ ok: true } | { ok: false; error: string }>;
}

/** One `statusMatrix` row: [filepath, head, workdir, stage]; cell meanings in scm-session.ts. */
export type StatusRow = readonly unknown[];

/** The isomorphic-git calls used here; the package's API is untyped in this fork. */
export interface GitCheckpointGit {
  resolveRef(args: { fs: GitFs; dir: string; ref: string }): Promise<string>;
  statusMatrix(args: {
    fs: GitFs;
    dir: string;
    filter?: (path: string) => boolean;
  }): Promise<readonly StatusRow[]>;
  /** Restore the given workdir paths from the index (HEAD while the gate holds). */
  checkout(args: { fs: GitFs; dir: string; filepaths: string[]; force: boolean }): Promise<void>;
}

/**
 * Test seams. Production passes none, so the ~1 MB isomorphic-git chunk and the bridge
 * adapter are created lazily on first use and then shared by every call of the session.
 */
export interface GitCheckpointTools {
  git?(): Promise<GitCheckpointGit>;
  fs?(): GitFs;
}

/** Folders Source Control never shows, so the gate never blocks on them either. */
function trackable(path: string): boolean {
  return !IGNORE_RE.test(path);
}

/**
 * The dirty marker for one status row, or null when the row is clean.
 *
 * All three cells equal is the clean set (head === workdir === stage). A staged-only change
 * (head 1, workdir 1, stage 2) is dirty too: "commit and continue" must sweep the index
 * before the writes start, or the turn's undo would leave it behind.
 * The letter is what Undo has to do: A when the path is absent from HEAD (tracked-as-new or
 * untracked — restore deletes it), D when it is gone from the working tree (restore re-creates
 * it), M otherwise.
 */
export function classifyStatusRow(row: StatusRow): ChatGitChange | null {
  const [filepath, head, workdir, stage] = row;
  // isomorphic-git's API is untyped here; an unexpected row shape is skipped, not guessed at.
  if (
    typeof filepath !== "string" ||
    typeof head !== "number" ||
    typeof workdir !== "number" ||
    typeof stage !== "number"
  ) {
    return null;
  }
  if (head === workdir && workdir === stage) return null;
  const letter: ChatGitChange["letter"] = head === 0 ? "A" : workdir === 0 ? "D" : "M";
  return { path: filepath, letter };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isMissing(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "ENOENT";
}

/** A host seam must not throw into the chat: a thrown failure becomes the typed error. */
async function delegated(
  run: () => Promise<{ ok: true } | { ok: false; error: string }>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    return await run();
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

async function loadGitApi(): Promise<GitCheckpointGit> {
  return (await loadGit()) as GitCheckpointGit;
}

/** Build the GitSafety the chat's write path consults before its first write of a turn. */
export function createGitCheckpoint(
  deps: GitCheckpointDeps,
  tools: GitCheckpointTools = {},
): GitSafety {
  let gitPromise: Promise<GitCheckpointGit> | null = null;
  let fsCache: GitFs | null = null;

  const git = (): Promise<GitCheckpointGit> =>
    (gitPromise ??= tools.git === undefined ? loadGitApi() : tools.git());
  const fs = (): GitFs =>
    (fsCache ??= tools.fs === undefined ? createGitFs(deps.bridge) : tools.fs());

  function rootOf(): string | null {
    const root = deps.root();
    return root === null || root === "" ? null : root;
  }

  async function isRepo(root: string): Promise<boolean> {
    try {
      return (await fs().promises.stat(root + "/.git")).isDirectory();
    } catch {
      // A missing .git is the answer to "is this a repo", not a failure to report.
      return false;
    }
  }

  async function gate(): Promise<GitGate> {
    const root = rootOf();
    if (root === null || !(await isRepo(root))) {
      return { ok: false, failure: { code: "no-repo" } };
    }
    const api = await git();
    let head: string;
    try {
      head = await api.resolveRef({ fs: fs(), dir: root, ref: "HEAD" });
    } catch {
      // Initialized but nothing committed: there is no HEAD for Undo to restore.
      return { ok: false, failure: { code: "no-head" } };
    }
    const matrix = await api.statusMatrix({ fs: fs(), dir: root, filter: trackable });
    const changes: ChatGitChange[] = [];
    for (const row of matrix) {
      const change = classifyStatusRow(row);
      if (change !== null) changes.push(change);
    }
    if (changes.length === 0) return { ok: true, head };
    // Stable order regardless of the walk: the gate card lists paths, not walk internals.
    changes.sort((a, b) => a.path.localeCompare(b.path));
    return { ok: false, failure: { code: "dirty-tree", changes } };
  }

  /** Repair one requested path; returns its error text, or null when it is clean again. */
  async function restoreOne(
    root: string,
    api: GitCheckpointGit,
    matrix: readonly StatusRow[],
    path: string,
  ): Promise<string | null> {
    const row = matrix.find((candidate) => candidate[0] === path);
    if (row === undefined || classifyStatusRow(row) === null) return null;
    if (row[1] === 0) {
      // Absent from HEAD: the write was a create, so the undo is a deletion.
      try {
        await fs().promises.unlink(root + "/" + path);
        return null;
      } catch (err) {
        // Already gone is success: the undo's goal for a new path is exactly this state.
        return isMissing(err) ? null : errorText(err);
      }
    }
    try {
      // No ref, like SCM's discard: the gate guarantees a clean index, so this is HEAD's
      // content for that path and never touches any other file.
      await api.checkout({ fs: fs(), dir: root, filepaths: [path], force: true });
      return null;
    } catch (err) {
      return errorText(err);
    }
  }

  async function restore(paths: readonly string[]): Promise<{ ok: boolean; errors: string[] }> {
    const root = rootOf();
    if (root === null) {
      return { ok: false, errors: paths.map((path) => path + ": no project is open") };
    }
    let api: GitCheckpointGit;
    let matrix: readonly StatusRow[];
    try {
      api = await git();
      matrix = await api.statusMatrix({ fs: fs(), dir: root, filter: trackable });
    } catch (err) {
      // Without a walk no path can be classified; report it per path rather than throw.
      const reason = errorText(err);
      return { ok: false, errors: paths.map((path) => path + ": " + reason) };
    }
    const errors: string[] = [];
    for (const path of paths) {
      // Sequential on purpose: the git-fs adapter serializes kernel calls, and one failed
      // path must not abort the rest of the undo.
      // oxlint-disable-next-line no-await-in-loop
      const error = await restoreOne(root, api, matrix, path);
      if (error !== null) errors.push(path + ": " + error);
    }
    return { ok: errors.length === 0, errors };
  }

  async function commitAll(): Promise<{ ok: true } | { ok: false; error: string }> {
    const root = rootOf();
    if (root === null) return { ok: false, error: "no project is open" };
    return delegated(() => deps.commit(root));
  }

  async function init(): Promise<{ ok: true } | { ok: false; error: string }> {
    const root = rootOf();
    if (root === null) return { ok: false, error: "no project is open" };
    return delegated(() => deps.init(root));
  }

  return { gate, commitAll, init, restore };
}
