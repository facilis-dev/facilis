// Reading a repository through a git host's CORS-enabled API (D-073).
//
// GitHub: raw.githubusercontent.com for a public repository (no rate limit), the contents
// API when a token is given. GitLab and Gitea/Forgejo are API-only: their tree endpoints are
// paginated and their raw endpoints are CORS-enabled, so the fetcher walks the tree first
// and then downloads the blobs with bounded concurrency.

import { fetchGithubRepo } from "./github-import";
import {
  CONCURRENCY,
  isExcludedPath,
  MAX_BYTES,
  MAX_FILES,
  mapPool,
  type ProgressFn,
  type RemoteTree,
} from "./remote-tree";
import { gitAuthHeaders, type GitProvider, type GitRepoRef } from "./git-provider";

/** What a git import needs from the caller; the token is per import, never stored. */
export interface GitImportOptions {
  /** The host picker's choice; a URL with a known host still parses the same way. */
  provider?: GitProvider;
  onProgress?: ProgressFn;
  token?: string | null;
}

function unreadable(token: string | null): Error {
  return new Error(
    token === null
      ? "Repository not found (it may be private)."
      : "Repository not found, or the token cannot read it.",
  );
}

async function okOrThrow(res: Response, token: string | null, host: string): Promise<Response> {
  if (res.status === 404) throw unreadable(token);
  if (res.status === 401) {
    throw new Error(
      host + " rejected the token (HTTP 401) — check that it is valid and not expired.",
    );
  }
  if (res.status === 403) {
    throw new Error(host + " refused the request (HTTP 403) — the token may lack access.");
  }
  if (!res.ok) throw new Error(host + " request failed (HTTP " + res.status + ").");
  return res;
}

async function defaultBranch(
  ref: GitRepoRef,
  headers: Record<string, string>,
  token: string | null,
  host: string,
): Promise<string> {
  const project = encodeURIComponent(ref.owner + "/" + ref.repo);
  const url =
    ref.provider === "gitlab"
      ? ref.api + "/projects/" + project
      : ref.api + "/repos/" + ref.owner + "/" + ref.repo;
  const info = (await (await okOrThrow(await fetch(url, { headers }), token, host)).json()) as {
    default_branch?: string;
  };
  return info.default_branch || "main";
}

async function fetchGitlabRepo(
  ref: GitRepoRef,
  headers: Record<string, string>,
  token: string | null,
  onProgress?: ProgressFn,
): Promise<RemoteTree> {
  const project = encodeURIComponent(ref.owner + "/" + ref.repo);
  onProgress?.(0, 0, "Resolving repository…");
  const branch = ref.ref ?? (await defaultBranch(ref, headers, token, "GitLab"));
  onProgress?.(0, 0, "Fetching file list…");
  const paths: string[] = [];
  let page = "1";
  while (page !== "" && paths.length < MAX_FILES) {
    const url =
      ref.api +
      "/projects/" +
      project +
      "/repository/tree?recursive=true&per_page=100&ref=" +
      encodeURIComponent(branch) +
      "&page=" +
      page;
    const res = await okOrThrow(await fetch(url, { headers }), token, "GitLab");
    const batch = (await res.json()) as { type: string; path: string }[];
    for (const node of batch) {
      if (node.type === "blob" && !isExcludedPath(node.path) && paths.length < MAX_FILES) {
        paths.push(node.path);
      }
    }
    page = res.headers.get("x-next-page") ?? "";
  }
  const truncated = page !== "";
  if (paths.length === 0) throw new Error("That repository has no importable files.");
  return downloadBlobs(ref, project, branch, paths, headers, truncated, onProgress);
}

async function downloadBlobs(
  ref: GitRepoRef,
  project: string,
  branch: string,
  paths: string[],
  headers: Record<string, string>,
  truncated: boolean,
  onProgress?: ProgressFn,
): Promise<RemoteTree> {
  const total = paths.length;
  let done = 0;
  let bytes = 0;
  onProgress?.(0, total, "Downloading files…");
  const files = await mapPool(paths, CONCURRENCY, async (path) => {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const url =
      ref.provider === "gitlab"
        ? ref.api +
          "/projects/" +
          project +
          "/repository/files/" +
          encodeURIComponent(path) +
          "/raw?ref=" +
          encodeURIComponent(branch)
        : ref.api +
          "/repos/" +
          ref.owner +
          "/" +
          ref.repo +
          "/raw/" +
          encoded +
          "?ref=" +
          encodeURIComponent(branch);
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error("Failed to download " + path + " (HTTP " + res.status + ").");
    const body = new Uint8Array(await res.arrayBuffer());
    bytes += body.byteLength;
    onProgress?.(++done, total, "Downloading files…");
    return { path, bytes: body };
  });
  if (bytes > MAX_BYTES)
    throw new Error("That repository is larger than the import limit (50 MB).");
  return { name: ref.repo, files, excludedNodeModules: false, truncated };
}

async function fetchGiteaRepo(
  ref: GitRepoRef,
  headers: Record<string, string>,
  token: string | null,
  onProgress?: ProgressFn,
): Promise<RemoteTree> {
  const base = ref.api + "/repos/" + ref.owner + "/" + ref.repo;
  onProgress?.(0, 0, "Resolving repository…");
  const branch = ref.ref ?? (await defaultBranch(ref, headers, token, "Gitea"));
  onProgress?.(0, 0, "Fetching file list…");
  const kept: { path: string; size: number }[] = [];
  let truncated = false;
  let page = 1;
  for (;;) {
    const url =
      base +
      "/git/trees/" +
      encodeURIComponent(branch) +
      "?recursive=true&per_page=100&page=" +
      page;
    const res = await okOrThrow(await fetch(url, { headers }), token, "Gitea");
    const body = (await res.json()) as {
      tree?: { type: string; path: string; size?: number }[];
      truncated?: boolean;
    };
    const nodes = body.tree ?? [];
    if (body.truncated === true) truncated = true;
    for (const node of nodes) {
      if (node.type !== "blob" || isExcludedPath(node.path)) continue;
      if (kept.length >= MAX_FILES) {
        truncated = true;
        continue;
      }
      kept.push({ path: node.path, size: node.size ?? 0 });
    }
    if (nodes.length === 0 || page > 200) break;
    page += 1;
  }
  if (kept.length === 0) throw new Error("That repository has no importable files.");
  let bytes = 0;
  const paths: string[] = [];
  for (const node of kept) {
    if (bytes + node.size > MAX_BYTES) {
      truncated = true;
      continue;
    }
    bytes += node.size;
    paths.push(node.path);
  }
  return downloadBlobs(ref, "", branch, paths, headers, truncated, onProgress);
}

/** Fetch a repository tree from the selected host. */
export async function fetchGitRepo(
  ref: GitRepoRef,
  opts: GitImportOptions = {},
): Promise<RemoteTree> {
  const token = opts.token ?? null;
  if (ref.provider === "github") {
    return fetchGithubRepo(
      { owner: ref.owner, repo: ref.repo, ref: ref.ref },
      opts.onProgress,
      token,
    );
  }
  const headers = { Accept: "application/json", ...gitAuthHeaders(ref.provider, token) };
  return ref.provider === "gitlab"
    ? fetchGitlabRepo(ref, headers, token, opts.onProgress)
    : fetchGiteaRepo(ref, headers, token, opts.onProgress);
}
