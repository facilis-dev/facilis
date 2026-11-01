// GitLab's write path: one commit with a list of file actions (D-078).
//
// GitLab's commits API accepts the whole change set in one POST, so a publish is a
// single commit; `start_branch` makes the same call create the target branch from the
// head the diff was computed against. Auth is PRIVATE-TOKEN, GitLab's own header (D-073).

import type { TreeEntry } from "./git-blobs";
import { gitAuthHeaders, type GitRepoRef } from "./git-provider";
import type { PushOptions, PushResult, RemoteListing } from "./git-push";

const HOST = "GitLab";
/** The token scope that lets GitLab accept a commit through the API. */
const SCOPE = "write_repository";
/** The tree API pages by `x-next-page`; this stops a broken/absent header looping. */
const MAX_PAGES = 200;

interface GitlabAction {
  action: "create" | "update" | "delete";
  file_path: string;
  /** Base64 keeps arbitrary bytes intact on the JSON body (D-078). */
  content?: string;
  encoding?: "base64";
}

interface GitlabCommitBody {
  branch: string;
  commit_message: string;
  author_name: string;
  author_email: string;
  /** Creates `branch` from this branch in the same call. */
  start_branch?: string;
  actions: GitlabAction[];
}

function headers(token: string): Record<string, string> {
  // The token goes in a header, never in the URL: a URL ends up in error messages,
  // the browser history and proxy logs (D-073).
  return { Accept: "application/json", ...gitAuthHeaders("gitlab", token) };
}

function writeHeaders(token: string): Record<string, string> {
  return { ...headers(token), "Content-Type": "application/json" };
}

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    // fetch() rejects only when the browser blocked the request (CORS/offline); an HTTP
    // error arrives as a Response. The message names the one server setting to change.
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

/** GitLab addresses a project by its URL-encoded full path (nested groups included). */
function projectUrl(ref: GitRepoRef): string {
  return ref.api + "/projects/" + encodeURIComponent(ref.owner + "/" + ref.repo);
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
    await call(projectUrl(ref) + "/repository/branches/" + encodeURIComponent(branch), {
      headers: headers(token),
    }),
    branchMissing(branch),
  );
  const body = (await res.json()) as { commit?: { id?: string } };
  const sha = body.commit?.id;
  if (sha === undefined) throw new Error(HOST + " returned no commit for branch " + branch + ".");
  return sha;
}

/** Resolve the default branch, the requested branch's head and its blob entries. */
export async function listGitlabTree(
  ref: GitRepoRef,
  token: string,
  branch?: string,
): Promise<RemoteListing> {
  const project = projectUrl(ref);
  const infoRes = check(await call(project, { headers: headers(token) }), repoMissing(ref));
  const info = (await infoRes.json()) as { default_branch?: string };
  const defaultBranch = info.default_branch || "main";
  const target = branch ?? ref.ref ?? defaultBranch;
  const headSha = await readHeadSha(ref, target, token);

  const entries: TreeEntry[] = [];
  let page = "1";
  for (let pages = 0; page !== "" && pages < MAX_PAGES; pages++) {
    const res = check(
      await call(
        project +
          "/repository/tree?recursive=true&per_page=100&page=" +
          page +
          "&ref=" +
          encodeURIComponent(target),
        { headers: headers(token) },
      ),
      branchMissing(target),
    );
    const nodes = (await res.json()) as { type: string; path: string; id: string }[];
    for (const node of nodes) {
      if (node.type === "blob") entries.push({ path: node.path, sha: node.id });
    }
    page = res.headers.get("x-next-page") ?? "";
  }
  if (page !== "") {
    // An incomplete list would make the diff report live files as deleted; a push built
    // on it could delete them, so refuse instead of guessing.
    throw new Error(
      HOST + " did not finish listing the branch — it is too large to plan a safe push.",
    );
  }
  return { entries, headSha, defaultBranch };
}

/** Commit every added/modified/deleted path as one commit (optionally on a new branch). */
export async function pushGitlab(opts: PushOptions): Promise<PushResult> {
  const { ref, token } = opts;
  const project = projectUrl(ref);
  const source = opts.baseBranch ?? opts.branch;
  const headSha = await readHeadSha(ref, source, token);
  if (headSha !== opts.headSha) throw moved();

  const actions: GitlabAction[] = [];
  const total = opts.changes.added.length + opts.changes.modified.length;
  let uploaded = 0;
  for (const file of opts.changes.added) {
    actions.push({
      action: "create",
      file_path: file.path,
      content: toBase64(file.bytes),
      encoding: "base64",
    });
    uploaded += 1;
    opts.onProgress?.("uploading", uploaded, total);
  }
  for (const file of opts.changes.modified) {
    actions.push({
      action: "update",
      file_path: file.path,
      content: toBase64(file.bytes),
      encoding: "base64",
    });
    uploaded += 1;
    opts.onProgress?.("uploading", uploaded, total);
  }
  for (const path of opts.changes.deleted) actions.push({ action: "delete", file_path: path });

  const body: GitlabCommitBody = {
    branch: opts.branch,
    commit_message: opts.message,
    author_name: opts.identity.name,
    author_email: opts.identity.email,
    actions,
  };
  // Creating a branch only happens through the commit call: the diff was computed
  // against baseBranch, so start_branch keeps the same one-commit shape.
  if (opts.baseBranch !== undefined) body.start_branch = opts.baseBranch;

  opts.onProgress?.("committing", 0, 1);
  const res = check(
    await call(project + "/repository/commits", {
      method: "POST",
      headers: writeHeaders(token),
      body: JSON.stringify(body),
    }),
    "The commit could not be created on " + HOST,
  );
  const commit = (await res.json()) as { id?: string };
  if (commit.id === undefined) throw new Error(HOST + " returned no commit id.");
  opts.onProgress?.("committing", 1, 1);
  return { commitSha: commit.id, branch: opts.branch, commits: 1 };
}
