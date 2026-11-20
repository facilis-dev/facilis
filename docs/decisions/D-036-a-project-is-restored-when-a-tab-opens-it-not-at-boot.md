# D-036 — A project is restored when a tab opens it, not at boot
**Status:** accepted (2026-10-30)

The OPFS mirror survives reloads, but its manifest is the index of the whole **origin**: every
project, plus the package-manager caches. Booting a tab replayed all of it into that tab's VFS,
so a tab carried every project on the origin — RAM and restore time for projects it never opens
(a second tab paid it again). The manifest is shared and is what lets cross-tab writes merge, so
per-project OPFS namespaces (considered in D-033) are the wrong tool: what is needed is a
**scope** on the replay.

**Decision:** the boot restore is scoped, and a project is materialized when it is opened.

- The IDE passes Home's known roots as `BootOptions.deferRestoreRoots` (fork commit
  `3376ba1`). The FS worker reads the manifest but leaves those subtrees on OPFS: they stay in
  the shared index — so this tab's writes and deletes, and the cross-tab merge, keep working for
  them — but they are not in the VFS.
- Opening a project (`IdeController.openProject`) asks the kernel for `vv-restore-roots`
  before it stats/opens the folder; the kernel replays exactly that subtree (dirs shallow→deep,
  files, symlinks) and answers once the files are readable. Nothing outside the requested roots
  is materialized, so a project the tab never opens is never carried.
- The hydration re-reads the manifest, so a project another tab created after this kernel booted
  opens without a reload; a brief retry covers that tab's write-behind mirror not having reached
  OPFS yet, instead of dropping the project from Home as "no longer on disk".
- A project stays in the VFS once opened (closing a folder does not unload it): unloading would
  have to tell mirrored from unsaved state apart, and it is not needed for the boot win.

**Consequences:** boot cost and VFS footprint scale with the projects a tab opens, not with the
origin. Measured on a fresh four-template origin (40 manifest entries, 32 project files): a
reload replays 4 entries instead of 40 (VFS 28 seed files instead of 60) and reaches
`kernel-online` in 671 ms; opening one project replays its 9 entries in 135 ms end to end
(`openProject`, folder indexing included). Package-manager caches were the next step — they are
the bulk of a real origin (830 of 873 entries in the multi-tab smoke origin) and are now deferred
per file on first read (D-037). Unknown roots are not deferred (restored at boot as before), so a
stale or missing registry entry costs at most one boot, never data.
Acceptance: `pnpm ide:smoke:multitab` asserts both directions — a reloaded tab restores the
project it opens, with its real contents, and does not carry a project it never opened.
