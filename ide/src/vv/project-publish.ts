// Publishing a project's working tree to a git host (D-078).
//
// The tab cannot run git's smart-HTTP protocol (D-073), so "push" is a diff plus a
// host REST call: list the branch's blob ids, hash the VFS bytes the same way git
// does, and hand the host the files that changed. It is a publish, not a clone-
// and-merge: one commit on top of the branch, never a force-push, never a rebase.
//
// Split out of controller.ts (D-019/D-042) like project-import/-export; the
// controller owns the active folder, the profile and the dialog's open state.

import { deployment, pushAllowed } from "@/deploy/current";
import type { ResolvedDeployment } from "@/deploy/types";
import type { FileTree } from "./file-tree";
import { diffTrees, gitBlobSha, isClean, type TreeChanges } from "./git-blobs";
import { normalizeGitToken, parseGitRepo, type GitProvider, type GitRepoRef } from "./git-provider";
import {
  listRemoteTree,
  pushChanges,
  type GitIdentity,
  type PushPhase,
  type PushResult,
} from "./git-push";

/** A publish above these bounds is a mistake, not a slow operation. */
export const MAX_PUSH_FILES = 2000;
export const MAX_PUSH_BYTES = 200 * 1024 * 1024;
const MAX_FILE_BYTES = 40 * 1024 * 1024;

// What a publish never carries: build output and machine-local state. Same intent as
// the SCM walk's ignore list (scm-session.ts) — a project's dist/ or .facilis/ database
// must not become a commit by accident. .gitignore is not interpreted: this list is the
// contract, and it is the one the Explorer already dims.
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  ".vite",
  ".facilis",
]);
const EXCLUDED_FILES = new Set([".DS_Store"]);
const EXCLUDED_SUFFIXES = [".log"];

export function isExcludedPushPath(path: string): boolean {
  const segments = path.split("/");
  if (segments.some((segment) => EXCLUDED_DIRS.has(segment))) return true;
  const name = segments[segments.length - 1] ?? "";
  if (EXCLUDED_FILES.has(name)) return true;
  return EXCLUDED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

export interface PushPlanInput {
  provider: GitProvider;
  /** `owner/repo`, `owner/repo@branch` or a repository URL (git-provider.ts). */
  repository: string;
  /** Required: writing needs a token with write access; it is never stored. */
  token: string;
  /** Empty means the remote's default branch; with `createBranch` the new branch's name. */
  branch?: string;
  /** Create `branch` from the remote's default branch instead of committing onto one. */
  createBranch?: boolean;
}

export interface PushPlan {
  ref: GitRepoRef;
  branch: string;
  /** The branch the commit is built on: `branch` itself, or its start point. */
  baseBranch: string;
  createBranch: boolean;
  /** The head the diff was computed against; a push refuses to overwrite a moved branch. */
  headSha: string;
  changes: TreeChanges;
  adds: FileTree;
  updates: FileTree;
  deletes: string[];
  bytes: number;
}

export interface ProjectPublishHost {
  kernelReady(): boolean;
  readTree(root: string): Promise<{ files: FileTree; truncated: boolean }>;
}

export class ProjectPublish {
  private readonly host: ProjectPublishHost;
  private readonly profile: ResolvedDeployment;

  constructor(host: ProjectPublishHost, profile: ResolvedDeployment = deployment) {
    this.host = host;
    this.profile = profile;
  }

  /** False when the deployment compiled the write-back out; the dialog never opens. */
  allows(): boolean {
    return pushAllowed(this.profile);
  }

  /**
   * Read the remote branch and the project tree, and return what a push would change.
   * Throws with a user-facing message on every failure (no toasts here: the dialog
   * owns the presentation and the controller owns the window).
   */
  async plan(input: PushPlanInput, root: string): Promise<PushPlan> {
    if (!this.allows()) {
      throw new Error("This deployment does not allow publishing to a git host.");
    }
    if (!this.host.kernelReady()) {
      throw new Error("The runtime is still starting — try again in a moment.");
    }
    const token = normalizeGitToken(input.token);
    if (token === null) {
      throw new Error("A token with write access to the repository is required to publish.");
    }
    const ref = parseGitRepo(input.repository, input.provider);
    if (ref === null) {
      throw new Error("Enter a repository URL, or owner/repo for the selected host.");
    }
    const createBranch = input.createBranch === true;
    const target = (input.branch ?? "").trim();
    if (createBranch && target === "") {
      throw new Error("Enter a name for the new branch.");
    }

    // A branch that does not exist yet cannot be listed; the base is then whatever
    // the repository resolves to (ref ?? default branch).
    const listBranch = createBranch || target === "" ? undefined : target;
    const listing = await listRemoteTree(ref, token, listBranch);
    const baseBranch = createBranch
      ? (listBranch ?? listing.defaultBranch)
      : target || listing.defaultBranch;
    const branch = createBranch ? target : target || listing.defaultBranch;

    const { files, truncated } = await this.host.readTree(root);
    if (truncated) {
      throw new Error("This project is too large to publish through the API.");
    }
    const localFiles = files.filter((file) => !isExcludedPushPath(file.path));
    const entries = localFiles.map((file) => ({ path: file.path, sha: gitBlobSha(file.bytes) }));

    const changes = diffTrees(entries, listing.entries);
    const adds = localFiles.filter((file) => changes.added.includes(file.path));
    const updates = localFiles.filter((file) => changes.modified.includes(file.path));
    const bytes = [...adds, ...updates].reduce((total, file) => total + file.bytes.length, 0);
    if (isClean(changes)) {
      return {
        ref,
        branch,
        baseBranch,
        createBranch,
        headSha: listing.headSha,
        changes,
        adds: [],
        updates: [],
        deletes: [],
        bytes: 0,
      };
    }
    if (adds.length + updates.length + changes.deleted.length > MAX_PUSH_FILES) {
      throw new Error("Too many files to publish (" + MAX_PUSH_FILES + " limit).");
    }
    if (bytes > MAX_PUSH_BYTES) {
      throw new Error("This project is larger than the push limit (200 MB).");
    }
    for (const file of [...adds, ...updates]) {
      if (file.bytes.length > MAX_FILE_BYTES) {
        throw new Error(file.path + " is too large to push through the API (40 MB limit).");
      }
    }

    return {
      ref,
      branch,
      baseBranch,
      createBranch,
      headSha: listing.headSha,
      changes,
      adds,
      updates,
      deletes: changes.deleted,
      bytes,
    };
  }

  /** Commit the plan to the host. The token is handed in again: nothing is stored. */
  async push(
    plan: PushPlan,
    opts: {
      token: string;
      message: string;
      identity: GitIdentity;
      onProgress?: (phase: PushPhase, done: number, total: number) => void;
    },
  ): Promise<PushResult> {
    if (!this.allows()) {
      throw new Error("This deployment does not allow publishing to a git host.");
    }
    const token = normalizeGitToken(opts.token);
    if (token === null) {
      throw new Error("A token with write access to the repository is required to publish.");
    }
    const total = plan.adds.length + plan.updates.length + plan.deletes.length;
    if (total === 0)
      throw new Error("Nothing to publish — the branch already matches this project.");
    if (opts.identity.name.trim() === "" || opts.identity.email.trim() === "") {
      throw new Error("Set a git author name and email in Source Control before publishing.");
    }
    const message = opts.message.trim() || "Update from facilis.dev";

    return pushChanges({
      ref: plan.ref,
      token,
      branch: plan.branch,
      baseBranch: plan.createBranch ? plan.baseBranch : undefined,
      headSha: plan.headSha,
      message,
      changes: { added: plan.adds, modified: plan.updates, deleted: plan.deletes },
      identity: { name: opts.identity.name.trim(), email: opts.identity.email.trim() },
      onProgress: opts.onProgress,
    });
  }
}
