# D-140 — A git operation that rewrites the working tree reloads the open editor buffers
**Status:** accepted (2026-11-10)

`ScmSession` already fired `onWorkdirChanged` after a checkout or discard, so the controller
reloaded the Explorer and the open Monaco models. A remote **pull** took the other path
(`GitRemoteSession`) and never told the controller: after a pull the Source Control list and every
open tab still showed the pre-pull bytes, and saving one of them would have written stale content
over the files git had just merged. D-139 made this easy to hit — `git_sync({ action: "pull" })`
can succeed while the user is looking at an editor that did not change.

**Decision.**

- `GitRemoteSession` gets the same `onWorkdirChanged` callback as `ScmSession`, fired only after
  a successful **pull** (fetch and push leave the file bytes alone).
- The controller wires both sessions to one reload callback (`ide/src/vv/workdir-reload.ts`,
  created in the constructor): it refreshes the SCM change list and the Explorer tree, and reloads
  every open text buffer whose bytes changed on disk. Checkout, discard, pull, the Remote git
  dialog and the AI git tools therefore converge on the same refresh.
- **A dirty buffer is never clobbered.** A path in `snap.dirty` (unsaved edits) keeps its Monaco
  model and `localFiles` cache untouched, and the count is reported with `toast.warning` under
  the new `editor.workdir.unsavedKept` key (en/it). When every buffer is clean the reload is
  silent. Saving a kept buffer over the pulled file stays the user's explicit action.
- The reload logic lives in its own module because `controller.ts` is pinned by the file-length
  ratchet: the controller keeps only the narrow host closures, and the module is unit-tested
  without Monaco.

**Rejected.** Reloading dirty buffers and discarding the edits (silent data loss); refusing the
pull while any buffer is dirty (unsaved bytes are not in the repository, and the pull itself is
safe); polling the VFS (the git RPC is the only writer that bypasses `vv-fs-changed`).

**Consequences.** After any git worktree change the editor matches the repository and the SCM list
is current; the only way to lose unsaved work is the user's own deliberate save. Diff tabs and
non-text tabs are skipped, as before.

**Verification.** `workdir-reload.test.ts` (clean reload, dirty kept + reported, all-dirty, deleted
file skipped), `git-remote-session.test.ts` (the callback fires after a successful pull, never for
fetch/push or a failed pull), i18n parity, IDE typecheck and the full gate set.
