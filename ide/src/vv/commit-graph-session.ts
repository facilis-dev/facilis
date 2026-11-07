// Reading a repository's commit graph through isomorphic-git (D-088).
//
// The commit-graph tab is local-only: it walks commits in the VFS over the silent
// git-fs RPC and never touches the network. One load() is one read — the tab decides
// when to refresh, so this module keeps no cache and no subscription that could drift
// away from Source Control.

import {
  buildCommitGraph,
  type BranchInput,
  type CommitGraph,
  type CommitInput,
} from "../facilis/commit-graph-model";
import { loadGit } from "./git-api";
import { createGitFs } from "./git-fs";
import type { KernelBridge } from "./kernel";
import { normDir } from "./path-utils";

/** How many commits each ref is walked back: enough to draw a screenful of history. */
const DEFAULT_DEPTH = 60;
/** Upper bound on drawn nodes; the canvas is a preview, not a full history browser. */
const DEFAULT_LIMIT = 200;

export type CommitGraphRead = { ok: true; graph: CommitGraph } | { ok: false; error: string };

/**
 * The subset of an isomorphic-git log entry this module reads. git-api.ts types
 * isomorphic-git as untyped, so the shape is asserted at the boundary instead of
 * spreading `any` through the mapping.
 */
interface LogEntry {
  oid: string;
  commit?: {
    message?: string;
    parent?: string[];
    author?: { name?: string; timestamp?: number };
  };
}

/** git shows only the subject: a multi-line message must stay a single node line. */
function firstLine(message: string): string {
  const end = message.indexOf("\n");
  return end === -1 ? message : message.slice(0, end);
}

function toCommitInput(entry: LogEntry): CommitInput {
  return {
    oid: entry.oid,
    parents: entry.commit?.parent ?? [],
    message: firstLine(entry.commit?.message ?? ""),
    author: entry.commit?.author?.name ?? "",
    timestamp: entry.commit?.author?.timestamp ?? 0,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CommitGraphSession {
  // Written out instead of a constructor parameter property: the app compiles with
  // `erasableSyntaxOnly`, which rejects that non-erasable shorthand.
  private readonly bridge: KernelBridge;

  constructor(bridge: KernelBridge) {
    this.bridge = bridge;
  }

  async load(
    root: string,
    options: { depth?: number; limit?: number } = {},
  ): Promise<CommitGraphRead> {
    try {
      const fs = createGitFs(this.bridge);
      const dir = normDir(root);
      const dotGit = (dir === "/" ? "" : dir) + "/.git";
      // A tab can outlive the folder (deleted, moved) or open before `git init`: report
      // the state instead of throwing, so the panel can show it and refresh later.
      const stat = await fs.promises.stat(dotGit).catch(() => null);
      if (stat === null || !stat.isDirectory()) return { ok: false, error: "not a git repository" };

      const git = await loadGit();
      // currentBranch is undefined on a detached HEAD; normalize to null so the detached
      // read below and the model's headOid agree.
      const branch = (await git
        .currentBranch({ fs, dir, fullname: false })
        .catch(() => null)) as unknown;
      const head = typeof branch === "string" && branch !== "" ? branch : null;
      const names = (await git.listBranches({ fs, dir })) as unknown as string[];

      // Resolve one ref at a time: git-fs serializes every op through one in-flight
      // chain anyway, and a burst of kernel round-trips starves the terminal relay.
      const branches: BranchInput[] = [];
      for (const name of names) {
        try {
          const oid = (await git.resolveRef({
            fs,
            dir,
            ref: "refs/heads/" + name,
          })) as unknown as string;
          branches.push({ name, oid });
        } catch {
          // A branch can disappear between listBranches and resolveRef; leave it out
          // rather than failing the whole graph for a ref that no longer exists.
        }
      }

      // When HEAD is attached its branch's log already contains it. A detached HEAD can
      // point at commits no local branch reaches (an old checkout), so read "HEAD" too.
      const refs = head === null ? [...names, "HEAD"] : names;
      const depth = options.depth ?? DEFAULT_DEPTH;
      // Sequential for the same reason: one log walk fans out into many serialized
      // git-fs reads, so overlapping refs would only pile more onto the kernel worker.
      const byOid = new Map<string, CommitInput>();
      for (const ref of refs) {
        const entries = (await git.log({ fs, dir, ref, depth })) as unknown as LogEntry[];
        for (const entry of entries) {
          // The same commit arrives through several branches; one copy in the map.
          if (!byOid.has(entry.oid)) byOid.set(entry.oid, toCommitInput(entry));
        }
      }

      // Newest first for the layout; oid breaks equal timestamps so two reads of the
      // same repo draw the same graph (the map's insertion order depends on refs).
      const commits = [...byOid.values()]
        .toSorted((a, b) =>
          a.timestamp === b.timestamp
            ? a.oid < b.oid
              ? -1
              : a.oid > b.oid
                ? 1
                : 0
            : b.timestamp - a.timestamp,
        )
        .slice(0, options.limit ?? DEFAULT_LIMIT);

      return { ok: true, graph: buildCommitGraph({ commits, branches, head }) };
    } catch (error) {
      // Every read is throw-free: the panel always gets a state, never an unhandled
      // rejection from a half-read repository.
      return { ok: false, error: errorMessage(error) };
    }
  }
}
