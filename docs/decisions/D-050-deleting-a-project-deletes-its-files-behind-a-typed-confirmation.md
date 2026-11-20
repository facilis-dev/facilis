# D-050 — Deleting a project deletes its files, behind a typed confirmation
**Status:** accepted (2026-10-31)

Home's trash action removed the project from the recent-projects registry only. Its files
stayed in the VFS/OPFS, so recreating a project at that path failed with "That directory is
not empty", and the action read as a delete that did not delete.

**Decision.** The action is **Delete project**, not "Remove from list". It hydrates the
project first — its subtree may still be deferred in the OPFS mirror (D-036) — and then issues
one recursive `vv-rm`, whose unlink/rmdir calls reach the mirror through fs-server's
`onDelete`. The folder and its run terminal are closed before the delete so no editor model or
write-behind flush can race it. A project claimed by another live tab is refused: that tab
holds the tree in RAM and its mirror would recreate what was just deleted. The confirmation is
typed: the destructive button stays disabled until the input equals the folder's name
(`confirmsProjectName`), because the action is irreversible.

**Consequences:** a path can be reused after deletion and OPFS stops keeping dead projects.
There is no undo, which is what the typed confirmation is for. A registry entry whose files
are already gone is still pruned by `openProject`, as before.

**Verification.** `project-name.test.ts` pins the typed match; `pnpm ide:smoke` deletes the
project through Home's dialog (typing its name) and asserts both the files and the registry
entry are gone.
