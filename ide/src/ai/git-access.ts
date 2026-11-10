// The AI-facing git facade (D-139): the repository and pull-request tools of the PTC runtime.
//
// The model works on the project's own repository through Source Control's existing sessions
// (ScmSession for the index/history, GitRemoteSession for the network) instead of shelling out.
// These are repository operations only — index, history, refs, remotes — and no tool writes
// project source content: source still changes only through the validated patch proposal and
// the user's Apply (invariant 9).
//
// Availability and refusals are DATA ({ available: false } / { ok: false, reason }), never an
// exception: "no project", "no repository", "not signed in" and "dirty working tree" are states
// the model can report or act on. Arguments are validated with PtcToolError by the handlers
// (ptc/git-tools.ts), so a wrong call self-corrects.
//
// Safety decisions, enforced here and in the handlers:
// - no discard/reset/clean/rebase/force-push tool exists; no tool accepts a token argument;
// - the only credential is the tab-memory GitHub OAuth token (githubSessionToken(), D-082),
//   read per call, never stored in a snapshot, logged or returned;
// - GitLab/Gitea remotes answer { available: false } in v1: no credential store is invented.
//
// This module owns the vocabulary and the controller composition. The implementation is split
// by side effect (git-local.ts / git-sync.ts) and by data source (git-repo.ts) to stay under the
// 300-line source limit; git-common.ts holds the helpers they share.

import type { IdeController } from "@/vv/controller";
import { githubSessionToken } from "@/vv/github-oauth";
import type { Credentials } from "@/vv/git-remote";
import type { GitRemoteState } from "@/vv/git-remote-session";
import type { GitChange, RepoState } from "@/vv/scm-session";
import { createRepoContents, type RepoContents } from "./git-repo";
import { createGitLocalOperations } from "./git-local";
import { createGitSyncOperations } from "./git-sync";
import type { PtcJson } from "./ptc/protocol";

/** The narrow seams the facade is built on; tests inject fakes instead of a controller. */
export interface GitPorts {
  /** The active workspace folder, or null when no project is open. */
  root(): string | null;
  /** The SCM entry for a root; undefined when the folder is not registered yet. */
  repo(root: string): RepoState | undefined;
  /** Re-walk branch + status + history. The mutating ports below refresh on their own. */
  refresh(): Promise<void>;
  stage(root: string, change: GitChange): Promise<void>;
  unstage(root: string, change: GitChange): Promise<void>;
  unstageAll(root: string): Promise<void>;
  commit(root: string, message: string): Promise<boolean>;
  createBranch(root: string, name: string): Promise<void>;
  checkoutBranch(root: string, name: string): Promise<void>;
  /** The SCM panel's remote snapshot (proxy health, ahead/behind). */
  remote(): GitRemoteState;
  detectRemote(root: string): Promise<void>;
  fetch(root: string, credentials: Credentials): Promise<boolean>;
  pull(root: string, credentials: Credentials): Promise<boolean>;
  push(root: string, credentials: Credentials): Promise<boolean>;
  contents: RepoContents;
  /** The tab-memory GitHub OAuth token, or null. The only credential source. */
  token(): string | null;
  fetchApi(url: string, init: RequestInit): Promise<Response>;
}

export interface GitDiffRequest {
  /** A repo-relative path, or omitted for every changed file in the scope. */
  readonly path?: string;
  /** true = HEAD vs index; false = index vs working tree. */
  readonly staged: boolean;
}

export interface GitPullRequestInput {
  readonly title: string;
  readonly body?: string;
  readonly base?: string;
  readonly head?: string;
  readonly draft?: boolean;
}

/** What the git_* handlers call; every method resolves to data, never throws for state. */
export interface GitAccess {
  /** A project is open (the repository itself may still be absent: that is data). */
  available(): boolean;
  status(): Promise<PtcJson>;
  diff(request: GitDiffRequest): Promise<PtcJson>;
  log(limit?: number): Promise<PtcJson>;
  branches(): Promise<PtcJson>;
  remote(): Promise<PtcJson>;
  stage(paths: readonly string[]): Promise<PtcJson>;
  unstage(paths?: readonly string[]): Promise<PtcJson>;
  commit(message: string): Promise<PtcJson>;
  branch(action: "create" | "switch", name: string): Promise<PtcJson>;
  sync(action: "fetch" | "pull" | "push"): Promise<PtcJson>;
  pullRequest(input: GitPullRequestInput): Promise<PtcJson>;
}

/** Test seam: the same facade over fake ports, no controller and no browser. */
export function createGitAccessFromPorts(ports: GitPorts): GitAccess {
  return {
    available: () => ports.root() !== null,
    ...createGitLocalOperations(ports),
    ...createGitSyncOperations(ports),
  };
}

/** The controller composition the chat host uses. */
export function createGitAccess(controller: IdeController): GitAccess {
  return createGitAccessFromPorts({
    root: () => controller.activeFolder?.rootPath ?? null,
    repo: (root) => controller.scm.getSnapshot().repos.find((entry) => entry.root === root),
    refresh: () => controller.scm.refresh(),
    stage: (root, change) => controller.scm.stage(root, change),
    unstage: (root, change) => controller.scm.unstage(root, change),
    unstageAll: (root) => controller.scm.unstageAll(root),
    commit: (root, message) => controller.scm.commit(root, message),
    createBranch: (root, name) => controller.scm.createBranch(root, name),
    checkoutBranch: (root, name) => controller.scm.checkoutBranch(root, name),
    remote: () => controller.gitRemote.getSnapshot(),
    detectRemote: (root) => controller.gitRemote.detect(root),
    fetch: (root, credentials) => controller.gitRemote.fetch(root, credentials),
    pull: (root, credentials) => controller.gitRemote.pull(root, credentials),
    push: (root, credentials) => controller.gitRemote.push(root, credentials),
    contents: createRepoContents({
      bridge: controller.bridge,
      readText: (absolute) => controller.readFileText(absolute),
    }),
    token: githubSessionToken,
    fetchApi: (url, init) => fetch(url, init),
  });
}
