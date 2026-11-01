// GitHub's write path: one blobs batch, one tree, one commit, one ref update (D-078).
//
// GitHub has a batch tree/commit endpoint, so a publish is a single commit: upload the
// changed blobs, build a tree on top of the head commit's tree, commit it and move the
// ref. The ref is PATCHed with force:false, so even after our own head check a branch
// that moved is rejected by the host rather than overwritten (D-078: never force-push).

import type { TreeEntry } from "./git-blobs";
import { gitAuthHeaders, type GitRepoRef } from "./git-provider";
import type { PushOptions, PushResult, RemoteListing } from "./git-push";

const HOST = "GitHub";
/** Fine-grained tokens need this permission; classic ones need the `repo` scope. */
const SCOPE = "contents: write";
const API_VERSION = "2022-11-28";

interface GithubTreeEntry {
  path: string;
  mode: "100644";
  type: "blob";
  /** null deletes the path from the base tree. */
  sha: string | null;
}

interface GithubTreeBody {
  tree?: { path: string; type: string; sha: string }[];
  truncated?: boolean;
}

function headers(token: string): Record<string, string> {
  // The token goes in a header, never in the URL: a URL ends up in error messages,
  // the browser history and proxy logs (D-073).
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    ...gitAuthHeaders("github", token),
  };
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
      HOST + " refused the request (HTTP 403) — the token may lack the " + SCOPE + " permission.",
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
    await call(repoUrl(ref) + "/git/ref/heads/" + encodeURIComponent(branch), {
      headers: headers(token),
    }),
    branchMissing(branch),
  );
  const body = (await res.json()) as { object?: { sha?: string } };
  const sha = body.object?.sha;
  if (sha === undefined) throw new Error(HOST + " returned no commit for branch " + branch + ".");
  return sha;
}

/** Resolve the default branch, the requested branch's head and its blob entries. */
export async function listGithubTree(
  ref: GitRepoRef,
  token: string,
  branch?: string,
): Promise<RemoteListing> {
  const infoRes = check(await call(repoUrl(ref), { headers: headers(token) }), repoMissing(ref));
  const info = (await infoRes.json()) as { default_branch?: string };
  const defaultBranch = info.default_branch || "main";
  const target = branch ?? ref.ref ?? defaultBranch;
  const headSha = await readHeadSha(ref, target, token);
  const treeRes = check(
    await call(repoUrl(ref) + "/git/trees/" + encodeURIComponent(target) + "?recursive=1", {
      headers: headers(token),
    }),
    branchMissing(target),
  );
  const tree = (await treeRes.json()) as GithubTreeBody;
  if (tree.truncated === true) {
    // An incomplete list would make the diff report live files as deleted; a push built
    // on it could delete them, so refuse instead of guessing.
    throw new Error(
      HOST + " truncated the file list — the branch is too large to plan a safe push.",
    );
  }
  const entries: TreeEntry[] = [];
  for (const node of tree.tree ?? []) {
    if (node.type === "blob") entries.push({ path: node.path, sha: node.sha });
  }
  return { entries, headSha, defaultBranch };
}

/** Commit every added/modified/deleted path as one commit and move/create the ref. */
export async function pushGithub(opts: PushOptions): Promise<PushResult> {
  const { ref, token } = opts;
  const baseUrl = repoUrl(ref);
  const source = opts.baseBranch ?? opts.branch;
  const headSha = await readHeadSha(ref, source, token);
  if (headSha !== opts.headSha) throw moved();

  const files = [...opts.changes.added, ...opts.changes.modified];
  const blobs: TreeEntry[] = [];
  let uploaded = 0;
  for (const file of files) {
    const res = check(
      await call(baseUrl + "/git/blobs", {
        method: "POST",
        headers: writeHeaders(token),
        body: JSON.stringify({ content: toBase64(file.bytes), encoding: "base64" }),
      }),
      "The file could not be uploaded to " + HOST,
    );
    const body = (await res.json()) as { sha?: string };
    if (body.sha === undefined) throw new Error(HOST + " returned no blob id.");
    blobs.push({ path: file.path, sha: body.sha });
    uploaded += 1;
    opts.onProgress?.("uploading", uploaded, files.length);
  }

  const baseRes = check(
    await call(baseUrl + "/git/commits/" + encodeURIComponent(opts.headSha), {
      headers: headers(token),
    }),
    "The base commit was not found on " + HOST,
  );
  const baseCommit = (await baseRes.json()) as { tree?: { sha?: string } };
  const baseTree = baseCommit.tree?.sha;
  if (baseTree === undefined) throw new Error(HOST + " returned no tree for the base commit.");

  const treeEntries: GithubTreeEntry[] = [
    ...blobs.map((blob) => ({
      path: blob.path,
      mode: "100644" as const,
      type: "blob" as const,
      sha: blob.sha,
    })),
    ...opts.changes.deleted.map((path) => ({
      path,
      mode: "100644" as const,
      type: "blob" as const,
      sha: null,
    })),
  ];

  let step = 0;
  opts.onProgress?.("committing", step, 3);
  const treeRes = check(
    await call(baseUrl + "/git/trees", {
      method: "POST",
      headers: writeHeaders(token),
      body: JSON.stringify({ base_tree: baseTree, tree: treeEntries }),
    }),
    "The tree could not be created on " + HOST,
  );
  const treeBody = (await treeRes.json()) as { sha?: string };
  if (treeBody.sha === undefined) throw new Error(HOST + " returned no tree id.");
  opts.onProgress?.("committing", ++step, 3);

  const commitRes = check(
    await call(baseUrl + "/git/commits", {
      method: "POST",
      headers: writeHeaders(token),
      body: JSON.stringify({
        message: opts.message,
        tree: treeBody.sha,
        parents: [opts.headSha],
        author: opts.identity,
      }),
    }),
    "The commit was rejected by " + HOST,
  );
  const commitBody = (await commitRes.json()) as { sha?: string };
  if (commitBody.sha === undefined) throw new Error(HOST + " returned no commit id.");
  opts.onProgress?.("committing", ++step, 3);

  if (opts.baseBranch === undefined) {
    check(
      await call(baseUrl + "/git/refs/heads/" + encodeURIComponent(opts.branch), {
        method: "PATCH",
        headers: writeHeaders(token),
        body: JSON.stringify({ sha: commitBody.sha, force: false }),
      }),
      branchMissing(opts.branch),
    );
  } else {
    check(
      await call(baseUrl + "/git/refs", {
        method: "POST",
        headers: writeHeaders(token),
        body: JSON.stringify({ ref: "refs/heads/" + opts.branch, sha: commitBody.sha }),
      }),
      repoMissing(ref),
    );
  }
  opts.onProgress?.("committing", ++step, 3);
  return { commitSha: commitBody.sha, branch: opts.branch, commits: 1 };
}
