// The Studio-side write path for AI-downloaded assets (D-175).
//
// A download is the one chat write that is not source code: it lands under public/ and the
// §9.3 validator never sees it (invariant 9 governs source changes). That is not a bypass:
// the bytes still go through the kernel bridge — never OPFS — so the in-VM dev server
// hot-updates the preview and the OPFS mirror persists the file.
//
// It lives beside IdeController instead of on it because controller.ts is pinned by the
// file-length ratchet (scripts/file-length-baseline.json), the same reason apply-patch.ts
// gives. No explicit refresh is needed after the write: the kernel worker emits
// `vv-fs-changed` for every vv-mkdirp/vv-write, and the controller bumps the Explorer tree
// and re-reads any open editor model on that event.

import type { PatchBridge } from "./apply-patch";

export interface VfsWriteInput {
  bridge: PatchBridge;
  /** Absolute VFS path of the project root (no trailing slash). */
  root: string;
  /** Project-relative destination, e.g. "public/logo.png". */
  path: string;
  bytes: Uint8Array;
}

/** Join root + relative path without ever doubling a slash (same rule as apply-patch.ts). */
function absolutePath(root: string, relative: string): string {
  return root.replace(/\/+$/, "") + "/" + relative.replace(/^\/+/, "");
}

/** Create the parent directory, then write the bytes; resolves once the VFS has the file. */
export async function writeProjectAsset(input: VfsWriteInput): Promise<void> {
  const absolute = absolutePath(input.root, input.path);
  const slash = absolute.lastIndexOf("/");
  // A project write always has a parent; the guard only keeps a root-level "/name" path from
  // asking for the filesystem root as its directory. mkdirp is idempotent, so re-creating the
  // project root for a file at the root is harmless.
  if (slash > 0) {
    await input.bridge.request("vv-mkdirp", { path: absolute.slice(0, slash) });
  }
  await input.bridge.request("vv-write", { path: absolute, bytes: input.bytes });
}
