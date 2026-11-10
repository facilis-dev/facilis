// The controller-backed content seam of the git tool family.
//
// The SCM snapshot (ScmSession) has the change lists, branch and error, but not the bytes a
// diff needs: a staged change is HEAD-vs-index and the index blob is in no snapshot. Reading
// those bytes means talking to isomorphic-git directly, exactly as ScmSession does, so this
// module keeps that dependency out of git-access.ts — git-access stays a port-injected facade
// that Node tests exercise without booting a controller.
//
// Every read goes through the same GitFs adapter as the SCM panel: the silent `vv-git-fs` RPC.
// Nothing here writes: HEAD/index/working-tree reads, history and the remote list.

import { loadGit } from "@/vv/git-api";
import { createGitFs, type GitFs } from "@/vv/git-fs";
import type { KernelBridge } from "@/vv/kernel";

/** One commit as the tools report it. */
export interface RepoCommit {
  oid: string;
  /** The first line of the commit message. */
  message: string;
  author: string;
  /** Seconds since the epoch, like ScmSession's history. */
  timestamp: number;
}

export interface RepoRemote {
  remote: string;
  url: string;
}

/**
 * The batched reads git-access needs. Every content call takes the paths it cares about, so
 * one index walk answers a whole diff instead of one walk per file.
 */
export interface RepoContents {
  /** Text at HEAD; a path that is not committed yet maps to null. */
  head(root: string, paths: readonly string[]): Promise<ReadonlyMap<string, string | null>>;
  /** Text staged in the index; an untracked path maps to null. */
  index(root: string, paths: readonly string[]): Promise<ReadonlyMap<string, string | null>>;
  /** Working-tree text; a deleted path maps to null. */
  workdir(root: string, paths: readonly string[]): Promise<ReadonlyMap<string, string | null>>;
  log(root: string, limit: number): Promise<readonly RepoCommit[]>;
  remotes(root: string): Promise<readonly RepoRemote[]>;
}

export interface RepoContentHost {
  bridge: KernelBridge;
  /** Working-tree text of an absolute VFS path (the controller's readFileText). */
  readText(absolutePath: string): Promise<string>;
}

interface WalkEntry {
  type(): Promise<string>;
  oid(): Promise<string | undefined>;
}

/** The isomorphic-git calls used here; the package's API is untyped in this fork. */
interface RepoGitApi {
  STAGE(): unknown;
  resolveRef(args: { fs: unknown; dir: string; ref: string }): Promise<string>;
  readBlob(args: {
    fs: unknown;
    dir: string;
    oid: string;
    filepath?: string;
  }): Promise<{ blob: Uint8Array }>;
  walk(args: {
    fs: unknown;
    dir: string;
    trees: readonly unknown[];
    map: (filepath: string, entries: readonly (WalkEntry | null)[]) => Promise<undefined>;
  }): Promise<unknown>;
  log(args: { fs: unknown; dir: string; depth?: number }): Promise<
    {
      oid: string;
      commit: { message?: string; author?: { name?: string; timestamp?: number } };
    }[]
  >;
  listRemotes(args: { fs: unknown; dir: string }): Promise<RepoRemote[]>;
}

const TEXT = new TextDecoder();

function textOf(blob: Uint8Array): string {
  return TEXT.decode(blob);
}

function emptyMap(paths: readonly string[], value: string | null): Map<string, string | null> {
  return new Map(paths.map((path) => [path, value] as const));
}

async function gitApi(): Promise<RepoGitApi> {
  return (await loadGit()) as RepoGitApi;
}

export function createRepoContents(host: RepoContentHost): RepoContents {
  let cachedFs: GitFs | null = null;
  const fs = (): GitFs => (cachedFs ??= createGitFs(host.bridge));

  return {
    async head(root, paths) {
      const git = await gitApi();
      let tree: string;
      try {
        tree = await git.resolveRef({ fs: fs(), dir: root, ref: "HEAD" });
      } catch {
        // An unborn branch (no commits yet) has no HEAD to read.
        return emptyMap(paths, null);
      }
      const out = new Map<string, string | null>();
      for (const path of paths) {
        try {
          // oxlint-disable-next-line no-await-in-loop
          const { blob } = await git.readBlob({ fs: fs(), dir: root, oid: tree, filepath: path });
          out.set(path, textOf(blob));
        } catch {
          out.set(path, null);
        }
      }
      return out;
    },

    async index(root, paths) {
      const git = await gitApi();
      const wanted = new Set(paths);
      const oids = new Map<string, string>();
      await git.walk({
        fs: fs(),
        dir: root,
        trees: [git.STAGE()],
        // The STAGE walker reports the index entry's oid but never its content, so collect
        // the oids first and read the blobs afterwards.
        map: async (filepath, entries) => {
          const entry = entries[0];
          if (entry === undefined || entry === null || !wanted.has(filepath)) return undefined;
          if ((await entry.type()) === "blob") {
            const oid = await entry.oid();
            if (oid !== undefined) oids.set(filepath, oid);
          }
          return undefined;
        },
      });
      const out = new Map<string, string | null>();
      for (const path of paths) {
        const oid = oids.get(path);
        if (oid === undefined) {
          out.set(path, null);
          continue;
        }
        try {
          // oxlint-disable-next-line no-await-in-loop
          const { blob } = await git.readBlob({ fs: fs(), dir: root, oid });
          out.set(path, textOf(blob));
        } catch {
          out.set(path, null);
        }
      }
      return out;
    },

    async workdir(root, paths) {
      const out = new Map<string, string | null>();
      for (const path of paths) {
        try {
          // Sequential by design: the GitFs adapter parks the kernel worker per call.
          // oxlint-disable-next-line no-await-in-loop
          out.set(path, await host.readText(root + "/" + path));
        } catch {
          out.set(path, null);
        }
      }
      return out;
    },

    async log(root, limit) {
      const git = await gitApi();
      try {
        const commits = await git.log({ fs: fs(), dir: root, depth: limit });
        return commits.map((commit) => ({
          oid: commit.oid,
          message: (commit.commit.message ?? "").split("\n")[0] ?? "",
          author: commit.commit.author?.name ?? "",
          timestamp: commit.commit.author?.timestamp ?? 0,
        }));
      } catch {
        // An unborn branch: no history is data, not an error.
        return [];
      }
    },

    async remotes(root) {
      const git = await gitApi();
      try {
        return await git.listRemotes({ fs: fs(), dir: root });
      } catch {
        return [];
      }
    },
  };
}
