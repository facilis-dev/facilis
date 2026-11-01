// Writing to a git host through its CORS-enabled REST API (D-078).
//
// A browser tab cannot speak git's smart-HTTP protocol: there is no raw socket, and the
// git endpoints send no CORS headers. Publishing is therefore the read side's mirror —
// list the remote tree, diff blob ids, and let the host build one commit from the
// changed paths. The adapters are per host because only their batch endpoints differ;
// this file owns the shared contract, the size guards and the dispatch.
//
// A push only ever moves a branch forward by one commit or creates it: force-pushing
// and merging are not offered, so a branch that moved while the diff was computed is a
// conflict, not something to resolve silently.

import { listGiteaTree, pushGitea } from "./gitea-push";
import type { FileTree } from "./file-tree";
import { listGithubTree, pushGithub } from "./github-push";
import type { TreeEntry } from "./git-blobs";
import type { GitRepoRef } from "./git-provider";
import { listGitlabTree, pushGitlab } from "./gitlab-push";

/** Phases a publish reports, in the order the dialog shows them. */
export type PushPhase = "listing" | "uploading" | "committing";

/** Who the commit is attributed to; GitHub/GitLab take it explicitly (Gitea cannot). */
export interface GitIdentity {
  name: string;
  email: string;
}

export interface RemoteListing {
  /** Blob entries of the listed branch; folders and submodules are not files. */
  entries: TreeEntry[];
  headSha: string;
  defaultBranch: string;
}

export interface PushChanges {
  added: FileTree;
  modified: FileTree;
  deleted: string[];
}

export interface PushResult {
  commitSha: string;
  branch: string;
  /** 1 for a host with a batch endpoint, one per file on Gitea (D-078). */
  commits: number;
}

export interface PushOptions {
  ref: GitRepoRef;
  token: string;
  /** The branch to commit on. */
  branch: string;
  /** Set only when `branch` does not exist and must be created from this branch. */
  baseBranch?: string;
  /** The commit `branch` (or `baseBranch`) pointed at when the diff was computed. */
  headSha: string;
  message: string;
  changes: PushChanges;
  identity: GitIdentity;
  onProgress?: (phase: PushPhase, done: number, total: number) => void;
}

/** The host APIs refuse a larger blob; the path is what the user has to act on. */
const MAX_FILE_BYTES = 40 * 1024 * 1024;
/** One request otherwise risks a browser/HTTP body limit and a very long stall. */
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

function assertPushable(changes: PushChanges): void {
  const changed = changes.added.length + changes.modified.length + changes.deleted.length;
  if (changed === 0) throw new Error("Nothing to push.");
  let total = 0;
  for (const file of [...changes.added, ...changes.modified]) {
    if (file.bytes.byteLength > MAX_FILE_BYTES) {
      throw new Error(file.path + " is too large to push through the API (40 MB limit).");
    }
    total += file.bytes.byteLength;
  }
  if (total > MAX_TOTAL_BYTES) {
    throw new Error("The changes are larger than the push limit (200 MB).");
  }
}

/**
 * Read the branch's file list and head from the selected host.
 * A branch that does not exist is an error naming it: the planner cannot diff against
 * a branch it cannot read.
 */
export async function listRemoteTree(
  ref: GitRepoRef,
  token: string,
  branch?: string,
): Promise<RemoteListing> {
  if (ref.provider === "github") return listGithubTree(ref, token, branch);
  if (ref.provider === "gitlab") return listGitlabTree(ref, token, branch);
  return listGiteaTree(ref, token, branch);
}

/** Commit the change set to the selected host through its write API. */
export async function pushChanges(opts: PushOptions): Promise<PushResult> {
  assertPushable(opts.changes);
  if (opts.ref.provider === "github") return pushGithub(opts);
  if (opts.ref.provider === "gitlab") return pushGitlab(opts);
  return pushGitea(opts);
}
