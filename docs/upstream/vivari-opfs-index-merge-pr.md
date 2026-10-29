# PR draft — fix(opfs): merge the mirror's index across tabs, and replace it atomically

**Status:** draft, **pushed** (2026-10-29). Branch `fix/opfs-crosstab-index` on
`kele23/vivari`, based on `v1.1.3` (`cec9e81`); commit `e16a963`. Apply with
`git am docs/upstream/vivari-opfs-index-merge.patch` (includes the changeset).

**Base repo:** [maitrungduc1410/vivari](https://github.com/maitrungduc1410/vivari)

## Summary

The write-behind mirror is per ORIGIN, not per tab: a second Studio tab restores the same tree
and mirrors its own writes into the same OPFS directory. `writeManifest()` serialized this
kernel's whole in-memory `meta`, so a tab that had never seen another tab's paths silently
dropped them from the index. Separately, the index had no atomic replace: OPFS has no rename,
and `truncate(0)` + `write()` leaves the file EMPTY for a few milliseconds.

## Evidence (two real Chrome tabs, one origin, React + Vue projects)

- After tab A wrote one file, the shared index held **0 of tab B's 10 paths**; reloading tab B
  lost its whole project (`vv-stat` answered that it does not exist).
- A tab that booted while another was rewriting the index parsed an empty file and restored
  **nothing** — the index was intact afterwards, so this was a read/write race, not corruption.
  Reproduced deterministically once a third tab kept the first one busy.

## Change

- Track the paths THIS kernel changed — writes, deletes, and entries `restore()` drops because
  `shouldPersist` now rejects them — and apply exactly those to the index on disk. Paths another
  tab mirrored and this kernel never saw stay in the index.
- Serialize the read-modify-write with a `vv-vfs-manifest` Web Lock, so two tabs cannot
  interleave it. Without the API the merge still runs, just without the interleave guard.
- Replace the index atomically: write a complete `manifest.json.new`, then `move()` it over the
  live file (falling back to a copy where `move()` is unavailable). Readers try the staged copy
  and retry for ~0.6 s before giving up, so a mid-write index is never mistaken for an empty one.
- Never overwrite an index that exists but cannot be parsed: log once and leave the changes
  queued, instead of writing the kernel's own (empty) view over other tabs' paths.

## Verification

- Two tabs, then a third: tab A writes, tab B reloads — both projects restore, and the index
  keeps both tabs' paths (855 entries, split correctly across the two projects).
- The single-tab path is unchanged: the mirror still restores a project after a reload (A12 in
  the superproject's write checks).

## Notes

- `vv-depcache`'s index is a single blob with the same shape of race. It is not fixed here: two
  tabs installing at the same time can lose one snapshot entry (the blob stays, the index entry
  does not) — wasted bytes, not corruption, fixed by the next install of that project.
- `navigator.locks` is used best-effort throughout, matching how the mirror already treats an
  unavailable OPFS.

