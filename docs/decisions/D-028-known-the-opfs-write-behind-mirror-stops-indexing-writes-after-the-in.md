# D-028 — Known: the OPFS write-behind mirror stops indexing writes after the in-VM install
**Status:** root cause found and fixed (2026-10-28); the fix is carried by the pinned fork
(`facilis/main`, D-030), so A12 passes as a normal check and the harness `knownIssue` path is
only a fallback for an unpinned tree

A12 expects an uncommitted file to survive a reboot through the OPFS mirror. It does not, and
the failure is inside the kernel, not the Studio:

- **The mirror is active.** After a fresh boot the reloaded Studio restores the project tree
  and the package-manager cache from `vv-vfs/` (581 manifest entries; `package.json` reads
  back as 2357 bytes after `Page.reload`), so boot restore itself works.
- **Late writes never reach it.** A `vv-write` succeeds and is readable through the VFS, but
  `vv-vfs/manifest.json` keeps the same 581 entries (sampled before the first write, 2 s
  after it, before the reload and after it) and
  `vv-vfs/files/.../vv-write-probe.txt` does not exist on disk. Nothing is restored because
  nothing was mirrored.
- The queue was never wedged — it was **overloaded, and the index was gated on it emptying**.
  `shouldPersist` excludes `node_modules` but persists the package-manager caches, and a cold
  pnpm install enqueues **8,000–12,000** paths (`~/.local/share/pnpm/store/v3/files/**`,
  `~/.cache/pnpm/metadata-*`) while the drain runs at ~500 entries/s. `drain()` rewrote
  `manifest.json` only once the queue was empty, which under that flood never happened:
  `lastManifestWrite` froze ~20 s in while the in-memory index grew past 3,000, so the on-disk
  manifest stayed at 514 entries and the probe (written later, behind the backlog) was never
  indexed. A reload then restored the stale index. `scripts/dev/smoke-write.mjs` records this
  as a `knownIssue` (with the counts) in `report.json`, so a future fix turns it into a normal
  pass without editing the harness.

The Studio half of the SPEC §13 risk-9 mitigation is in place: `ide/src/vv/vfs-flush.ts`
posts `fs-flush` on `visibilitychange`/`pagehide` and `KernelBridge` already flushes on
`pagehide`. A flush cannot help when the queue is minutes behind.

**Fix (upstream, validated 2026-10-28).** Route package-manager-cache paths to a low-priority
queue that drains only when nothing project-level is queued; rewrite the manifest while the
queue is busy (existing 1 s debounce); and make `flush()` on page-hide promise only the project
paths plus the index, leaving cache work queued. Applied temporarily to the vendored tree, this
turns A12 into a normal pass — 24/24 write checks, zero known issues, the probe survives the
reload. The fix is pinned through the fork (D-030, branch `fix/opfs-mirror-priority`) and was filed
upstream as PR #21. The Studio's writes, editor state, HMR and git are correct in-tab either
way.
