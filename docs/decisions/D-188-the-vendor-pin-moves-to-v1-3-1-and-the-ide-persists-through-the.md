# D-188 — The vendor pin moves to v1.3.1 and the IDE persists through the mirror lane
**Status:** accepted (2026-11-15)

**Context.** `facilis/main` now carries upstream v1.3.1 plus the fork's **mirror lane**, an
opt-in `BootOptions.mirrorLane` (default `false`). With it the FS worker appends each persisted
file body to one journal handle instead of a `createSyncAccessHandle → write → flush` per file on
the FS thread, and a dedicated mirror worker — owned by at most one tab per origin, elected by a
Web Lock — fsyncs that journal once per drain and then rebuilds the per-path OPFS files. The win
is the per-file fsync (the fork measures ~4 ms per 3 KiB file before and ~0.1 ms after). Every
other tab, and any tab where the lane cannot start, stays on the direct path inside the kernel.

**Decision.** Move the pin to `daceb39` (`v1.3.1-19-gdaceb39`) and boot the IDE with
`mirrorLane: true` — the fifth `KernelBridge.boot` argument in `IdeController.start`. The IDE is
the tab a developer works in, so it should own the journal: taking the lane is what stops the
working tab from serializing one fsync per written file, and a second tab could not hold the lane
at the same time anyway.

**Consequences.** A tab crash still loses nothing: a journal left behind is replayed before the VFS
restore, and a boot that does not use the lane discards it. The loss window is only the last
un-drained journal, the trade the direct path made by fsyncing every file — an OS or power loss can
drop the last drain's bodies, never an earlier one, and a record is skipped on replay when the
index no longer lists its path or the OPFS body is newer than it. Because the direct path remains
the fallback, no downstream code may assume the lane ran — the same rule as the deferred cache
(D-037) and the scoped restore (D-036). The pin also carries the fork's `esm.js` specifier fix
(comments inside `export { … } from` broke `parse5`-derived packages), which reaches the Vite
graphs of generated projects.
