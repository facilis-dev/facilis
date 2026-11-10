// Shared vocabulary and pure helpers of the git tool family (D-139).
//
// The family is split across files only because of the 300-line source limit: this module holds
// what every tool needs — the data-not-exception refusals, the open-repo/readiness guard, the
// remote/provider rules and the unified-diff renderer. Nothing here touches the network or the
// filesystem; git-local.ts serves the repository tools and git-sync.ts the remote ones.

import { detectGitProvider, type GitProvider } from "@/vv/git-provider";
import type { GitChange, RepoState } from "@/vv/scm-session";
import { fileDiff } from "./diff";
import type { GitPorts } from "./git-access";
import type { RepoRemote } from "./git-repo";
import type { PtcJson } from "./ptc/protocol";

/** The largest unified diff one call returns; larger asks are capped, not refused. */
export const MAX_DIFF_CHARS = 24_000;
/** At most this many files are rendered per diff call; the rest are reported truncated. */
export const MAX_DIFF_FILES = 100;
/** The largest history window a call returns (the handler caps its argument at the same value). */
export const MAX_LOG = 30;
/** The default history window when the model does not ask for one. */
export const DEFAULT_LOG = 20;
/** Shown whenever a remote operation needs the signed-in GitHub account (D-082). */
export const SIGN_IN_REASON = "sign in to GitHub in Source Control -> Remote git, then retry";
export const NO_PROJECT_REASON = "no project is open: open a project, then retry";
export const NO_REPO_REASON =
  "this folder is not a git repository: initialize it in Source Control, then retry";

export function unavailable(reason: string): PtcJson {
  return { available: false, reason };
}

export function failed(reason: string): PtcJson {
  return { ok: false, reason };
}

export interface OpenRepo {
  readonly root: string;
  readonly repo: RepoState;
}

/** Either the refreshed repository state, or the data refusal to return unchanged. */
export type Readiness = { readonly declined: PtcJson } | OpenRepo;

export function changesJson(changes: readonly GitChange[]): PtcJson[] {
  return changes.map((change) => ({ path: change.path, letter: change.letter }));
}

export function hasChanges(repo: RepoState): boolean {
  return repo.staged.length + repo.changes.length > 0;
}

export function missingPaths(kind: string, missing: readonly string[]): PtcJson {
  return failed(
    "no " +
      kind +
      " change for " +
      missing.map((path) => JSON.stringify(path)).join(", ") +
      ": call git_status to list the changed paths",
  );
}

/** git@host:owner/repo.git has no URL host, so read it out of the scp-like shape. */
function scpHostOf(url: string): string | null {
  const match = /^[^@/]+@([^:/]+)[:/]/.exec(url);
  return match === null ? null : (match[1] ?? null);
}

export function providerOf(url: string | null): GitProvider | null {
  if (url === null) return null;
  let host: string | null = null;
  try {
    host = new URL(url).hostname;
  } catch {
    host = scpHostOf(url);
  }
  return host === null ? null : detectGitProvider(host);
}

function providerLabel(provider: GitProvider | null): string {
  if (provider === "gitlab") return "GitLab";
  if (provider === "gitea") return "Gitea / Forgejo";
  return "this remote";
}

/** v1 signs in to GitHub only: the other providers answer with guidance, never a fake token. */
export function providerGate(provider: GitProvider | null): PtcJson | null {
  if (provider === "github") return null;
  return unavailable(
    "remote operations and pull requests in this version need a GitHub remote signed in through Source Control -> Remote git; for " +
      providerLabel(provider) +
      " use its web UI",
  );
}

/** A NUL byte means binary content: rendering it as UTF-8 text would be noise. */
function binaryOf(before: string | null, after: string | null): boolean {
  return (before?.includes("\u0000") ?? false) || (after?.includes("\u0000") ?? false);
}

interface RenderedFile {
  readonly text: string;
  readonly added: number;
  readonly removed: number;
  readonly truncated: boolean;
}

/** One file of a unified diff, or an empty string when the contents are identical. */
export function renderFile(
  path: string,
  before: string | null,
  after: string | null,
): RenderedFile | null {
  if (binaryOf(before, after)) return null;
  const diff = fileDiff(before, after);
  if (diff.lines.length === 0) return { text: "", added: 0, removed: 0, truncated: false };
  const lines = [
    "--- " + (before === null ? "/dev/null" : "a/" + path),
    "+++ " + (after === null ? "/dev/null" : "b/" + path),
  ];
  for (const line of diff.lines) {
    if (line.kind === "hunk") lines.push(line.text);
    else if (line.kind === "add") lines.push("+" + line.text);
    else if (line.kind === "del") lines.push("-" + line.text);
    else lines.push(" " + line.text);
  }
  if (diff.truncated) lines.push("[diff truncated for this file]");
  return {
    text: lines.join("\n"),
    added: diff.added,
    removed: diff.removed,
    truncated: diff.truncated,
  };
}

/** The active repository, refreshed when asked; otherwise the data refusal to return as-is. */
export async function ready(ports: GitPorts, refresh: boolean): Promise<Readiness> {
  const root = ports.root();
  if (root === null) return { declined: unavailable(NO_PROJECT_REASON) };
  const repoOf = (): RepoState | undefined => {
    const repo = ports.repo(root);
    return repo !== undefined && repo.isRepo ? repo : undefined;
  };
  if (repoOf() === undefined) return { declined: unavailable(NO_REPO_REASON) };
  if (refresh) await ports.refresh();
  const repo = repoOf();
  return repo === undefined ? { declined: unavailable(NO_REPO_REASON) } : { root, repo };
}

/** The origin remote, or the first configured one (like the SCM panel). */
export async function originOf(ports: GitPorts, root: string): Promise<RepoRemote | null> {
  const remotes = await ports.contents.remotes(root);
  return remotes.find((entry) => entry.remote === "origin") ?? remotes[0] ?? null;
}
