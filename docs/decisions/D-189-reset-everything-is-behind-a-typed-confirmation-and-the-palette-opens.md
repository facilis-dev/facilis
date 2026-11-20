# D-189 — "Reset everything" is behind a typed confirmation, and the palette opens that dialog
**Status:** accepted (2026-11-15)

**Context.** Home's "Reset everything" wiped the browser — every project's files, the
dependency cache and the recent-projects list — with a single click on the dialog's
destructive button, and the command palette ran the same wipe behind a browser `confirm()`,
the fastest path to an action with no undo. D-050 already fixed the policy for the
destructive action next to it: deleting one project requires typing the project's name.

**Decision.** Both entry points open one dialog, mounted in `AppShell` so Home and the
palette share it, and the palette entry no longer calls `confirm()`. The destructive button
stays disabled until the user types `RESET` (`confirmsResetEverything`: trimmed,
case-insensitive). The word is a fixed token rather than a project name or a localized
phrase: the wipe spans the whole origin, so nothing names it, and a token neither drifts
with the locale nor asks the user to reproduce a translation exactly.

**Consequences.** A stray Enter in the palette can no longer erase the browser; the extra
step is typing, not a second click-through. The open flag is a small store
(`ide/src/vv/reset-ui.ts`), like `scaffold-ui.ts` and `git-remote-ui.ts`, because
`controller.ts` sits at its file-length ratchet — the wipe itself stays on
`IdeController.resetEverything`. Lowercase is accepted on purpose — the token
identifies nothing, so a case difference is not the near miss that a project name would be.
The dialog still locks while the reset runs, because the wipe reloads the page and cannot
be cancelled.

**Verification.** `reset-confirmation.test.ts` pins the typed match (case, whitespace, near
misses); `pnpm --filter @facilis.dev/ide typecheck` and `test` cover the wiring.
