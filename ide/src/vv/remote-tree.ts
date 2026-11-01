// Shared shape, bounds and helpers for a remote project tree (D-073).
//
// The tree arrives from a git host's CORS-enabled API: node_modules and .git are
// never imported, because dependencies are reinstalled and git metadata is rebuilt.

import type { ImportTree } from "./file-tree";

export type RemoteTree = ImportTree & { truncated?: boolean };
export type ProgressFn = (done: number, total: number, phase: string) => void;

// Bounds so a huge repo can't wedge the tab; surfaced as a "truncated" warning.
export const MAX_FILES = 2000;
export const MAX_BYTES = 50 * 1024 * 1024;
export const CONCURRENCY = 12;

export const isNodeModules = (p: string) => p.split("/").some((s) => s === "node_modules");
export const isGit = (p: string) => p.split("/").some((s) => s === ".git");
/** Directories never imported: dependencies are reinstalled, git metadata is rebuilt. */
export const isExcludedPath = (p: string) => isNodeModules(p) || isGit(p);

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
