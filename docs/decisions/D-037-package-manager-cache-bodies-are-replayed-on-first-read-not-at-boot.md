# D-037 — Package-manager cache bodies are replayed on first read, not at boot
**Status:** accepted (2026-10-30)

D-036 scoped the boot restore to the projects a tab opens; the package-manager caches were left
eager, and they are the bulk of the mirror. Measured on the multi-tab smoke origin (two
projects): 829 of 873 index entries are npm's cache — 415 files, 147 MB — and replaying them
accounted for essentially all of the 4.0 s boot and the 42 MB compressed Wasm footprint. They
are shared by every project on the origin, so an eager replay makes a tab carry the cache of
projects it may never install.

**Decision:** the boot pass materializes the cache **directories** (an inode is free, and a cache
directory must list and stat normally) and leaves the cache **file bodies** on OPFS. The FS
worker replays one body the first time a syscall observes its bytes, before the syscall runs
(`FsServer.beforeRequest`), so the caller's synchronous read contract is untouched. The rules
are explicit in `installDeferredHydration` (`vendor/vivari/.../fs-worker.ts`):

- replay on `read_file`, `open` (read, read+write, append), `stat`/`lstat`, `link` source,
  `rename` source, `chmod`/`utimes`;
- a truncating write (`O_WRONLY|O_TRUNC`) does **not** replay: it replaces the bytes;
- `unlink`/`rmdir` **drop** the OPFS copy instead of replaying it (cacache's `rm`), and the index
  records the delete;
- `exists` is answered from the mirror's index (it is a probe, not a read);
- `readdir` merges the deferred names, so a cache directory lists what the mirror holds;
- a write/delete/rename invalidates the deferred entry, and a replay that loses that race is
  discarded instead of writing stale bytes back; a cross-tab write is seen, because the replay
  reads the current OPFS bytes.

**Why not the alternatives:** loading the whole cache at the first package-manager spawn still
carries every project's cache; per-project cache namespaces would break the content-addressed
dedupe the caches rely on; a size column in the manifest (to answer `stat` without bytes) was
considered and is not needed — in npm/pnpm's warm-install paths a `stat` of a cache blob is
always followed by its read (cacache `content.read`), so replay-on-stat costs nothing extra.

**Consequences:** a tab pays for the cache entries its own installs read, and nothing else.
Measured on a fresh origin (one react install, 297 cache files): cold install 27.9 s; a reload
with the cache deferred boots in 1.16 s carrying 27 MB of VFS (127 MB with the cache resident);
a later `rm -rf node_modules && npm install` takes 8.5 s and replays **73 of the 297** cache
files (deferred 297 → 224, +22 MB), leaving the other 224 on OPFS. A project whose
`node_modules` comes from the dependency cache reads no package cache at all. Hydrated bodies
stay in the tab's VFS once read (no eviction), so the tab carries exactly the blobs its installs
used.
Acceptance: `pnpm ide:smoke:multitab` (cache stays deferred on an idle tab, only the requested
file is replayed, a reloaded project still restores) and `TEMPLATE=Facilis pnpm ide:smoke`
(reboot, framework contract, write/git paths), plus the root gates.
