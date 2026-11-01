// Reading a repository through GitHub's CORS-enabled API (D-073).
//
// raw.githubusercontent.com serves a public repository (no rate limit). A private one
// needs the contents API, which honours the token and returns raw bytes with the right
// Accept header. The token goes in a header, never in the URL (D-073).

import type { FileTree } from "./file-tree";
import {
  CONCURRENCY,
  isExcludedPath,
  isNodeModules,
  MAX_BYTES,
  MAX_FILES,
  mapPool,
  type ProgressFn,
  type RemoteTree,
} from "./remote-tree";

const GH_API = "https://api.github.com";
const GH_RAW = "https://raw.githubusercontent.com";
const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

function ghHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  // The token goes in the header, never in the URL: a URL ends up in error messages,
  // the browser history and proxy logs (D-073).
  if (token !== null) headers.Authorization = "Bearer " + token;
  return headers;
}

async function ghJson(url: string, token: string | null): Promise<Response> {
  const res = await fetch(url, { headers: ghHeaders(token) });
  if (res.status === 404) {
    throw new Error(
      token === null
        ? "Repository not found (it may be private or misspelled)."
        : "Repository not found, or the token cannot read it.",
    );
  }
  if (res.status === 401) {
    throw new Error(
      "GitHub rejected the token (HTTP 401) — check that it is valid and not expired.",
    );
  }
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    throw new Error(
      token === null
        ? "GitHub API rate limit reached — add a personal access token for a higher limit."
        : "GitHub API rate limit reached for this token — try again later.",
    );
  }
  if (!res.ok) throw new Error("GitHub request failed (HTTP " + res.status + ").");
  return res;
}

/**
 * Raw file bytes for a private repository. raw.githubusercontent.com serves public
 * content only, so a token import goes through the contents API instead: it is
 * CORS-enabled and honours the same token; `Accept: application/vnd.github.raw`
 * returns the bytes rather than JSON.
 */
async function ghFile(url: string, token: string, path: string): Promise<Response> {
  const headers = ghHeaders(token);
  headers.Accept = "application/vnd.github.raw";
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const access =
      res.status === 401 || res.status === 403
        ? " — the token may lack access to this repository"
        : "";
    throw new Error("Failed to download " + path + " (HTTP " + res.status + ")" + access + ".");
  }
  return res;
}

export async function fetchGithubRepo(
  spec: { owner: string; repo: string; ref?: string },
  onProgress?: ProgressFn,
  token: string | null = null,
): Promise<RemoteTree> {
  const { owner, repo } = spec;
  let ref = spec.ref;
  onProgress?.(0, 0, "Resolving repository…");
  if (!ref) {
    const info = (await (await ghJson(GH_API + "/repos/" + owner + "/" + repo, token)).json()) as {
      default_branch?: string;
    };
    ref = info.default_branch || "main";
  }
  const branch = ref;
  onProgress?.(0, 0, "Fetching file list…");
  const tree = (await (
    await ghJson(
      GH_API +
        "/repos/" +
        owner +
        "/" +
        repo +
        "/git/trees/" +
        encodeURIComponent(branch) +
        "?recursive=1",
      token,
    )
  ).json()) as { tree?: { type: string; path: string; size?: number }[]; truncated?: boolean };
  const nodes = tree.tree || [];
  const excludedNodeModules = nodes.some((n) => isNodeModules(n.path));

  // Keep regular files (git-tree entries carry `size`), applying the count/byte caps.
  let bytes = 0;
  let truncated = !!tree.truncated;
  const kept: { path: string }[] = [];
  for (const n of nodes) {
    if (n.type !== "blob" || isExcludedPath(n.path)) continue;
    if (kept.length >= MAX_FILES || bytes + (n.size || 0) > MAX_BYTES) {
      truncated = true;
      continue;
    }
    bytes += n.size || 0;
    kept.push({ path: n.path });
  }

  if (!kept.length) throw new Error("That repository has no importable files.");

  let done = 0;
  const total = kept.length;
  onProgress?.(0, total, "Downloading files…");
  const files: FileTree = await mapPool(kept, CONCURRENCY, async (b) => {
    // Public: the raw host, no rate limit. With a token: the contents API, because the
    // raw host cannot read a private repository (D-073).
    const res =
      token === null
        ? await fetch(
            GH_RAW +
              "/" +
              owner +
              "/" +
              repo +
              "/" +
              encodeURIComponent(branch) +
              "/" +
              encPath(b.path),
          )
        : await ghFile(
            GH_API +
              "/repos/" +
              owner +
              "/" +
              repo +
              "/contents/" +
              encPath(b.path) +
              "?ref=" +
              encodeURIComponent(branch),
            token,
            b.path,
          );
    if (!res.ok) throw new Error("Failed to download " + b.path + " (HTTP " + res.status + ").");
    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress?.(++done, total, "Downloading files…");
    return { path: b.path, bytes: buf };
  });

  return { name: repo, files, excludedNodeModules, truncated };
}
