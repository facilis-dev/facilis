// Reload the Explorer and the open editor buffers after a git operation rewrote the working
// tree (D-140).
//
// ScmSession (checkout/discard) and GitRemoteSession (pull) rewrite files through the silent
// `vv-git-fs` kernel RPC, which never emits `vv-fs-changed`: without this the Explorer and the
// open Monaco models keep the pre-git bytes, and saving one of them would write stale content
// over the files git just updated. Kept out of controller.ts, which the file-length ratchet pins
// at its upstream size.
//
// A buffer with unsaved edits is never clobbered — a git operation must not silently discard the
// user's work — and the caller reports how many buffers were kept.

export interface WorkdirReloadHost {
  /** Absolute paths of the open text tabs (diff and binary tabs are not editor buffers). */
  tabs(): readonly string[];
  /** Absolute paths with unsaved edits. */
  dirty(): readonly string[];
  /** Current bytes of a path in the working tree. */
  read(path: string): Promise<string>;
  /** Apply new bytes to the editor cache and the Monaco model. */
  store(path: string, text: string): void;
  /** Refresh the Explorer tree and the SCM change list. */
  refresh(): void;
  /** Tell the user that `n` unsaved buffers were kept on purpose. */
  unsavedKept(n: number): void;
}

/** The callback both git sessions call after they rewrote the working tree. */
export function createWorkdirReload(host: WorkdirReloadHost): () => void {
  return () => {
    host.refresh();
    void reload(host);
  };
}

async function reload(host: WorkdirReloadHost): Promise<void> {
  const tabList = host.tabs();
  const dirty = new Set(host.dirty());
  const clean = tabList.filter((path) => !dirty.has(path));
  // Read in parallel (open tabs are few), then store in tab order so the UI/state update is
  // deterministic; a file the git operation deleted is skipped, never cleared.
  const texts = await Promise.all(clean.map((path) => host.read(path).catch(() => null)));
  clean.forEach((path, index) => {
    const text = texts[index];
    if (text !== null && text !== undefined) host.store(path, text);
  });
  const kept = tabList.length - clean.length;
  if (kept > 0) host.unsavedKept(kept);
}
