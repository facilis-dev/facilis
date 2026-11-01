// Remote project sources (P2): import a GitHub repo (public, or private with a
// token) or an npm package as a new project — fully client-side, no backend/proxy.
//
// The studio page is cross-origin-isolated (COEP require-corp). A cors-mode
// fetch() is readable and satisfies COEP when the response sends
// `Access-Control-Allow-Origin: *`, which all the hosts below do:
//   - npm:    registry.npmjs.org (packument + dist.tarball)
//   - GitHub: api.github.com (repo info + git trees) + raw.githubusercontent.com
// So we fetch them directly from the main thread; the in-VM Fetcher Worker is
// not involved.

import { gunzip } from "../../../vendor/vivari/packages/kernel-host/archive.js";
import { parseTar, stripFirstSegment } from "../../../vendor/vivari/packages/kernel-host/tar.js";
import type { FileTree, ImportTree } from "./file-tree";

export type RemoteTree = ImportTree & { truncated?: boolean };
export type ProgressFn = (done: number, total: number, phase: string) => void;

// Bounds so a huge repo can't wedge the tab; surfaced as a "truncated" warning.
export const MAX_FILES = 2000;
export const MAX_BYTES = 50 * 1024 * 1024;
const CONCURRENCY = 12;

const NPM_REGISTRY = "https://registry.npmjs.org";
const GH_API = "https://api.github.com";
const GH_RAW = "https://raw.githubusercontent.com";

const isNodeModules = (p: string) => p.split("/").some((s) => s === "node_modules");
const isGit = (p: string) => p.split("/").some((s) => s === ".git");
/** Directories never imported: dependencies are reinstalled, git metadata is rebuilt. */
export const isExcludedPath = (p: string) => isNodeModules(p) || isGit(p);
const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

// Run `fn` over `items` with bounded concurrency, preserving order.
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) break;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 0 }, worker));
  return out;
}

// ── GitHub ──────────────────────────────────────────────────────────────────
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
  if (!res.ok) throw new Error(`GitHub request failed (HTTP ${res.status}).`);
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
    throw new Error(`Failed to download ${path} (HTTP ${res.status})${access}.`);
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
    const info = await (await ghJson(`${GH_API}/repos/${owner}/${repo}`, token)).json();
    ref = info.default_branch || "main";
  }
  onProgress?.(0, 0, "Fetching file list…");
  const tree = await (
    await ghJson(
      `${GH_API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref!)}?recursive=1`,
      token,
    )
  ).json();
  const nodes: { type: string; path: string; size?: number }[] = tree.tree || [];
  const excludedNodeModules = nodes.some((n) => isNodeModules(n.path));

  // Keep regular files (git-tree entries carry `size`), applying the count/byte caps.
  let bytes = 0;
  let truncated = !!tree.truncated;
  const kept: { path: string }[] = [];
  for (const n of nodes) {
    if (n.type !== "blob" || isNodeModules(n.path) || isGit(n.path)) continue;
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
        ? await fetch(`${GH_RAW}/${owner}/${repo}/${encodeURIComponent(ref!)}/${encPath(b.path)}`)
        : await ghFile(
            `${GH_API}/repos/${owner}/${repo}/contents/${encPath(b.path)}?ref=${encodeURIComponent(ref!)}`,
            token,
            b.path,
          );
    if (!res.ok) throw new Error(`Failed to download ${b.path} (HTTP ${res.status}).`);
    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress?.(++done, total, "Downloading files…");
    return { path: b.path, bytes: buf };
  });

  return { name: repo, files, excludedNodeModules, truncated };
}

// ── npm ─────────────────────────────────────────────────────────────────────
export function parseNpmSpec(input: string): { name: string; version?: string } | null {
  const s = input.trim().replace(/^npm:/, "");
  if (!s) return null;
  // Scoped: @scope/name(@version); unscoped: name(@version)
  const scoped = s.startsWith("@");
  const at = s.indexOf("@", scoped ? 1 : 0);
  if (at > 0) return { name: s.slice(0, at), version: s.slice(at + 1) || undefined };
  return { name: s };
}

export async function fetchNpmPackage(
  spec: { name: string; version?: string },
  onProgress?: ProgressFn,
): Promise<RemoteTree> {
  const { name } = spec;
  onProgress?.(0, 0, "Resolving package…");
  const metaRes = await fetch(`${NPM_REGISTRY}/${name}`);
  if (metaRes.status === 404) throw new Error(`Package "${name}" not found on npm.`);
  if (!metaRes.ok) throw new Error(`npm request failed (HTTP ${metaRes.status}).`);
  const meta = await metaRes.json();
  const tags = meta["dist-tags"] || {};
  const versions = meta.versions || {};
  let version = spec.version;
  if (!version) version = tags.latest;
  else if (tags[version])
    version = tags[version]; // a dist-tag like "next"
  else if (!versions[version]) version = tags.latest; // unknown/range → latest (no semver-range resolution)
  const v = version && versions[version];
  const tarball = v && v.dist && v.dist.tarball;
  if (!tarball) throw new Error(`Could not resolve a version for "${name}".`);

  onProgress?.(0, 0, "Downloading tarball…");
  const tgzRes = await fetch(tarball);
  if (!tgzRes.ok) throw new Error(`Failed to download tarball (HTTP ${tgzRes.status}).`);
  const gz = new Uint8Array(await tgzRes.arrayBuffer());

  onProgress?.(0, 0, "Unpacking…");
  const tar = await gunzip(gz);
  let excludedNodeModules = false;
  const files: FileTree = [];
  let bytes = 0;
  let truncated = false;
  for (const entry of parseTar(tar)) {
    const rel = stripFirstSegment(entry.name);
    if (!rel) continue;
    if (isNodeModules(rel)) {
      excludedNodeModules = true;
      continue;
    }
    if (isGit(rel)) continue;
    if (files.length >= MAX_FILES || bytes + entry.bytes.byteLength > MAX_BYTES) {
      truncated = true;
      continue;
    }
    bytes += entry.bytes.byteLength;
    files.push({ path: rel, bytes: entry.bytes });
  }
  if (!files.length) throw new Error(`Package "${name}" contained no importable files.`);

  const safeName = (version ? `${name}-${version}` : name).replace(/^@/, "").replace(/\//g, "-");
  return { name: safeName, files, excludedNodeModules, truncated };
}
