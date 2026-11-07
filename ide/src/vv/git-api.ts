// Shared lazy loader for isomorphic-git.
//
// The library is a ~1 MB chunk and assumes a global `Buffer` in the browser, so the
// polyfill is installed BEFORE the import (otherwise every git call throws "Buffer is
// not defined"). Both the Source Control session and the commit-graph reader load git
// through this module, so the chunk and the polyfill are loaded once per tab, and only
// when git is actually used.

export type GitApi = any; // isomorphic-git's API is not typed in this fork

let gitPromise: Promise<GitApi> | null = null;
let bufferReady: Promise<void> | null = null;

/** Load isomorphic-git, installing the Buffer polyfill first (idempotent). */
export function loadGit(): Promise<GitApi> {
  if (!gitPromise) {
    gitPromise = ensureBuffer()
      .then(() => import("isomorphic-git"))
      .then((m) => (m as { default?: GitApi }).default ?? m);
  }
  return gitPromise;
}

function ensureBuffer(): Promise<void> {
  const g = globalThis as { Buffer?: unknown };
  if (g.Buffer) return Promise.resolve();
  if (!bufferReady) {
    bufferReady = import("buffer").then(({ Buffer }) => {
      if (!g.Buffer) g.Buffer = Buffer;
    });
  }
  return bufferReady;
}
