// Gitea/Forgejo's write path: the contents API, one file per commit (D-078).
//
// Gitea has no batch endpoint that takes several files in one commit, so a publish is
// written file by file through the contents API and each call creates its own commit.
// That is the documented trade-off: a twelve-file publish shows twelve commits, but the
// alternative — synthesising git objects — needs a git client and a raw socket a tab
// does not have. The real commit count is reported so the UI can say so.
//
// The author is not set: Gitea's contents API does not take one portably, so the
// token's user is the committer. The `sha` of the current blob is sent on updates and
// deletes, which makes a concurrent edit a conflict instead of an overwrite.

import type { TreeEntry } from "./git-blobs";
import { gitAuthHeaders, type GitRepoRef } from "./git-provider";
import type { PushOptions, PushResult, RemoteListing } from "./git-push";

const HOST = "Gitea";
/** The token permission that lets Gitea accept a contents write. */
const SCOPE = "write:repository";
/** Hard stop for a tree that never returns an empty page. */
const MAX_PAGES = 200;

function headers(token: string): Record<string, string> {
  // The token goes in a header, never in the URL: a URL ends up in error messages,
  // the browser history and proxy logs (D-073).
  return { Accept: "application/json", ...gitAuthHeaders("gitea", token) };
}

function writeHeaders(token: string): Record<string, string> {
  return { ...headers(token), "Content-Type": "application/json" };
}

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    // fetch() rejects only when the browser blocked the request (CORS/offline); an HTTP
    // error arrives as a Response. Self-hosted Gitea needs its [cors] section enabled.
    if (error instanceof TypeError) {
      throw new Error(
        "Could not reach " +
          HOST +
          " — its API must allow CORS (for a self-hosted server, enable it).",
        { cause: error },
      );
    }
    throw error;
  }
}

function moved(): Error {
  return new Error("The branch moved while planning — re-check the changes.");
}

/**
 * Turn a non-ok response into the error the user can act on. A response body is never
 * echoed: a host can include the request's token in it (D-073).
 */
function check(res: Response, notFound: string): Response {
  if (res.ok) return res;
  if (res.status === 401) {
    throw new Error(
      HOST + " rejected the token (HTTP 401) — check that it is valid and not expired.",
    );
  }
  if (res.status === 403) {
    throw new Error(
      HOST + " refused the request (HTTP 403) — the token may lack the " + SCOPE + " scope.",
    );
  }
  if (res.status === 404) throw new Error(notFound + " (HTTP 404).");
  if (res.status === 409 || res.status === 422) throw moved();
  throw new Error(HOST + " request failed (HTTP " + res.status + ").");
}

/** btoa over a binary string built in chunks: no Buffer in a browser (D-078). */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function repoUrl(ref: GitRepoRef): string {
  return ref.api + "/repos/" + ref.owner + "/" + ref.repo;
}

/** Each path segment is encoded, so a file name can hold any character (D-078). */
function contentUrl(ref: GitRepoRef, path: string): string {
  return repoUrl(ref) + "/contents/" + path.split("/").map(encodeURIComponent).join("/");
}

function repoMissing(ref: GitRepoRef): string {
  return (
    "Repository " +
    ref.owner +
    "/" +
    ref.repo +
    " was not found on " +
    HOST +
    " — it may be private"
  );
}

function branchMissing(branch: string): string {
  return "Branch " + branch + " was not found on " + HOST;
}

async function readHeadSha(ref: GitRepoRef, branch: string, token: string): Promise<string> {
  const res = check(
    await call(repoUrl(ref) + "/branches/" + encodeURIComponent(branch), {
      headers: headers(token),
    }),
    branchMissing(branch),
  );
  const body = (await res.json()) as { commit?: { id?: string } };
  const sha = body.commit?.id;
  if (sha === undefined) throw new Error(HOST + " returned no commit for branch " + branch + ".");
  return sha;
}

/** Walk every page of the branch tree; the API also pages when `recursive=true`. */
async function readTree(ref: GitRepoRef, branch: string, token: string): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = check(
      await call(
        repoUrl(ref) +
          "/git/trees/" +
          encodeURIComponent(branch) +
          "?recursive=true&per_page=100&page=" +
          page,
        { headers: headers(token) },
      ),
      branchMissing(branch),
    );
    const body = (await res.json()) as {
      tree?: { path: string; type: string; sha: string }[];
      truncated?: boolean;
    };
    if (body.truncated === true) {
      // An incomplete list would make the diff report live files as deleted; a push built
      // on it could delete them, so refuse instead of guessing.
      throw new Error(
        HOST + " truncated the file list — the branch is too large to plan a safe push.",
      );
    }
    const nodes = body.tree ?? [];
    for (const node of nodes) {
      if (node.type === "blob") entries.push({ path: node.path, sha: node.sha });
    }
    if (nodes.length === 0) return entries;
  }
  throw new Error(
    HOST + " did not finish listing the branch — it is too large to plan a safe push.",
  );
}

/** Resolve the default branch, the requested branch's head and its blob entries. */
export async function listGiteaTree(
  ref: GitRepoRef,
  token: string,
  branch?: string,
): Promise<RemoteListing> {
  const infoRes = check(await call(repoUrl(ref), { headers: headers(token) }), repoMissing(ref));
  const info = (await infoRes.json()) as { default_branch?: string };
  const defaultBranch = info.default_branch || "main";
  const target = branch ?? ref.ref ?? defaultBranch;
  const headSha = await readHeadSha(ref, target, token);
  const entries = await readTree(ref, target, token);
  return { entries, headSha, defaultBranch };
}

/** Write every added/modified/deleted path sequentially, one contents-API call each. */
export async function pushGitea(opts: PushOptions): Promise<PushResult> {
  const { ref, token } = opts;
  const source = opts.baseBranch ?? opts.branch;
  const creating = opts.baseBranch !== undefined && opts.baseBranch !== opts.branch;
  const headSha = await readHeadSha(ref, source, token);
  if (headSha !== opts.headSha) throw moved();

  // Updates and deletes need the current blob id (the optimistic lock), and PushOptions
  // carries no remote ids, so the tree of the head the diff was computed against is
  // listed again. It is also where "already stale" shows up as a missing path. A push
  // that only creates files needs no ids, so it skips the extra listing.
  const needsIds = opts.changes.modified.length + opts.changes.deleted.length > 0;
  const remote = needsIds ? await readTree(ref, source, token) : [];
  const shas = new Map(remote.map((entry) => [entry.path, entry.sha]));
  const shaOf = (path: string): string => {
    const sha = shas.get(path);
    if (sha === undefined) throw moved();
    return sha;
  };
  // Resolve every id BEFORE the first write: each write is already a commit, so a stale
  // plan must be refused before it leaves a partial publish on the branch (D-078).
  const updates = opts.changes.modified.map((file) => ({ file, sha: shaOf(file.path) }));
  const deletes = opts.changes.deleted.map((path) => ({ path, sha: shaOf(path) }));

  const total =
    opts.changes.added.length + opts.changes.modified.length + opts.changes.deleted.length;
  let done = 0;
  let commitSha = opts.headSha;
  let first = true;

  const branchFields = (): Record<string, string> => {
    // The first write of a new branch is based on `source`; `new_branch` makes Gitea
    // create the target branch from it. Every later write goes to the branch directly.
    if (creating && first) return { branch: source, new_branch: opts.branch };
    return { branch: opts.branch };
  };

  const write = async (
    url: string,
    method: "POST" | "PUT" | "DELETE",
    payload: Record<string, unknown>,
  ): Promise<void> => {
    const res = check(
      await call(url, { method, headers: writeHeaders(token), body: JSON.stringify(payload) }),
      "The file could not be written on " + HOST,
    );
    const body = (await res.json()) as { commit?: { sha?: string } };
    if (body.commit?.sha !== undefined) commitSha = body.commit.sha;
    done += 1;
    opts.onProgress?.("committing", done, total);
  };

  for (const file of opts.changes.added) {
    await write(contentUrl(ref, file.path), "POST", {
      content: toBase64(file.bytes),
      message: opts.message,
      ...branchFields(),
    });
    first = false;
  }
  for (const update of updates) {
    await write(contentUrl(ref, update.file.path), "PUT", {
      content: toBase64(update.file.bytes),
      message: opts.message,
      sha: update.sha,
      ...branchFields(),
    });
    first = false;
  }
  for (const entry of deletes) {
    await write(contentUrl(ref, entry.path), "DELETE", {
      message: opts.message,
      sha: entry.sha,
      ...branchFields(),
    });
    first = false;
  }

  return { commitSha, branch: opts.branch, commits: done };
}
