# PR draft — fix(opfs): drain project paths ahead of package-manager caches

**PR:** [#21](https://github.com/maitrungduc1410/vivari/pull/21) (opened 2026-10-29). Branch
`fix/opfs-mirror-priority` on `kele23/vivari`, based on `v1.1.4` (`8e91ade`); commit
`831c0d5`. The same change applies with `git am docs/upstream/vivari-opfs-mirror-priority.patch`
(includes the changeset).

**Base repo:** [maitrungduc1410/vivari](https://github.com/maitrungduc1410/vivari)

## Summary

The OPFS write-behind mirror persists the package-manager caches on purpose, and a cold
`pnpm install` enqueues thousands of their files. Two things then go wrong at once:

1. Project writes sit **behind the cache backlog**. A file written during the install waits
   for thousands of unrelated cache paths, and a reload discards the in-memory queue — the
   edit is simply lost.
2. `manifest.json` is rewritten only when the queue **empties**. During the install flood it
   never empties, so OPFS holds file bytes whose names are not in the index. On reload the
   VFS is restored from an index that is minutes behind what is actually on disk.

`flush()` (page hide) had the same shape: it drained everything, cache files included, before
writing the index, so a tab closing during an install had no chance to finish.

## Evidence (instrumented browser session, WebContainer)

- During a cold install the queue held **8,000–12,000** pending paths, almost all of them
  `/home/user/.local/share/pnpm/store/v3/files/**` and
  `/home/user/.cache/pnpm/metadata-v1.3/**`; the drain ran at ~500 entries/s while the
  install kept producing.
- `lastManifestWrite` froze **~20 s** after boot while `meta` grew past 3,000 entries: the
  on-disk manifest kept **514** entries. A probe file written after the install was readable
  through the VFS but never mirrored; after `Page.reload` it did not come back.
- The worker was never wedged: a heartbeat written from the message handler kept advancing
  (16k → 35k messages) and the drain kept processing; the queue simply never emptied.

## Change

- `opfs-persistence.js`: a second `pendingLow` queue; `isLowPriority(path)` (new option)
  routes cache paths there. The drain always prefers project paths, and only runs cache work
  when nothing urgent is queued. The manifest is rewritten **while the queue is busy** (same
  1 s debounce as before). `flush()` sets a flag, drains only project paths, writes the index,
  and leaves the cache backlog queued (it resumes on the next drain).
- `fs-worker.ts`: `isPmCachePath()` marks `/home/user/.local/share/pnpm`,
  `/home/user/.cache/pnpm`, npm/yarn/corepack caches and the `.npm`/`.yarn`/`.bun` homes as
  low priority. Their durability is unchanged — they still drain, just not ahead of the user.
- `scripts/spike-opfs-delete-recreate.mjs`: a regression case — 200 queued cache writes, one
  project write, `flush()`; the project file must restore and the last cache entry must still
  be queued. It fails on the unpatched mirror (the flush waits for the cache queue).

## Verification

- **Browser, end to end** (Facilis IDE smoke on the same WebContainer setup that reproduced
  the failure): with the patch applied, the previously-known upstream failure becomes a normal
  pass — `A12 uncommitted file survives the reboot (OPFS mirror) — restored from OPFS`, 24/24
  write checks, zero known issues. Without the patch the same check reports the stale
  manifest (514 entries) and the probe is lost.
- `node scripts/spike-opfs-delete-recreate.mjs`: **PASS** (all existing cases + the new one).
- `npm run verify` was **not** run locally: this machine has no Rust toolchain/wasm-pack, so
  `packages/vfs/pkg-node` (imported by `scripts/fs-worker.mjs`) cannot be built. CI covers it;
  the change touches neither the Wasm VFS nor the runtime.
- Changeset included: `.changeset/tidy-mirrors-drain.md` (`@vivari/core`, patch).

## Notes

- The fix is conservative: the condition order, the `shouldPersist` exclusions and the
  manifest debounce are unchanged; priority only reorders work that was already queued.
- `ARCHITECTURE.md` persistence section updated with the drain-priority rule.
- Cache persistence stays: the point is that cache work must not keep *project* writes out of
  OPFS, not that caches are worthless.
