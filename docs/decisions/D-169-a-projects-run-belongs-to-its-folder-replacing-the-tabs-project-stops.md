# D-169 — A project's run belongs to its folder: replacing the tab's project stops the old dev server

**Status:** accepted (2026-11-12)

**Context.** D-035 makes the browser tab the unit of work: one project per tab, and opening
another replaces the tab's root. The replacement closed the folder's editor state but never its
run. `closeFolder` left the `runningProjects` entry, the run terminal and the kernel listener
alive, so the Ports view kept a row for a project the tab no longer had open, the preview panel
kept a tab bound to that port, and the Run control's Stop could not clear it: `runTerminalId` is
single-slot and the next run overwrites it. Observed from a user report (two projects created
back to back from Home's dialog): the Ports view listed both dev servers, 3000 and 3001, with two
preview tabs. Two browser tabs each bind the in-VM port in their own kernel, so both listeners
were in one tab — a replaced project's server that outlived its folder.

**Decision.** `IdeController.closeFolder` calls the new private `stopFolderRun(root)` before it
drops the folder's state: close the run terminal (`terminals.closeTerminal` posts `term-close`,
so the VM kills the dev server), delete the `runningProjects` entry, remove the port from
`portMap` and re-sync the Ports view, close every preview tab mirroring that port
(`PreviewSession.closePortTabs`), re-push the keep-prefix ports and end the run phase when it
belongs to this root. `deleteProject`'s `stopProject` hook reuses the same teardown, so deleting
a project also drops its preview tab.

**Consequences.** Opening another project (a Home row, the New project dialog, or the
`?project=` boot of a folder that replaces one) now frees the previous project's dev server, its
Ports row and its preview tab, instead of leaving a listener the UI cannot stop. Reopening the
replaced project no longer finds its server still running: Run starts it again, and until it is
up the preview behaves exactly like a stopped run (the tab is gone rather than sitting on a dead
port). A server the user started by hand in a terminal is not tracked per root and is untouched.

**Verification.** `pnpm ide:smoke:multitab` — the D-035 section now runs beta in tab A while
alpha is running and asserts one Ports row and one preview tab after the replacement, and zero of
both after closing beta; the alpha preview checks that used to rely on the leftover server now
run alpha again first. `pnpm --filter @facilis.dev/ide typecheck`, `pnpm --filter @facilis.dev/ide test`
and `pnpm lint` cover the touched modules.
