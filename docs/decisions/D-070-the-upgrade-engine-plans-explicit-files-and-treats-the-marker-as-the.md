# D-070 — The upgrade engine plans explicit files and treats the marker as the commit point
**Status:** accepted (2026-11-01)

[APP-UPDATES.md](./APP-UPDATES.md) §4 promised a reversible upgrade; this fixes the engine's
shape before the first recipe ships, because the shape is what makes a rollback possible.

**Decision.**

- A recipe declares, it does not write: \`files(read)\` returns the files in their final
  state (\`null\` = delete) and every path is project-relative and validated
  (\`assertRecipePath\` refuses absolute paths, backslashes and \`..\`). The build ships
  recipes as code, tested with the build, so an air-gapped deployment needs no download.
- The planner turns the selected recipes into an explicit operation list
  (\`{ path, before, after }\`), executing them over an overlay so a later step sees what an
  earlier one wrote; a file already in its target state is dropped; two recipes for the same
  target version or a step that does not move forward fail the plan instead of guessing.
- The applier re-checks every \`before\` against the VFS immediately before writing (the plan
  was made from a read; another tab, an AI patch or the user may have written since), applies
  the files, runs the caller's postflight, and writes \`facilis.app.json\` **last**. A failure
  restores every touched path in reverse and leaves the marker on the old version;
  \`UpgradeError.rolledBack\` records whether the rollback itself completed.
- The VFS sits behind an injected \`UpgradeIo\`, so the engine has no kernel dependency, is
  unit-tested without a browser, and the controller stays the only writer (D-042).
- A recipe's title is an i18n key (\`MessageKey\`), so adding a recipe forces a localized
  label (D-043).

**Consequences.** A recipe that fails halfway cannot leave a half-upgraded project; the
marker is the single commit point and a retry starts from the same version. The guarantee
covers file writes, not side effects of the postflight itself (an \`npm install\` that ran
before a later step failed is not undone) — safe because the plan is idempotent. The apply
action in the UI and the postflight wiring (install, \`tsc --noEmit\`, DB migration, D-052)
are still to come, so the panel is a dry run and the table ships empty.
