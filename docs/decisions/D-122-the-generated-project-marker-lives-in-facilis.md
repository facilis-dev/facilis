# D-122 — The generated project marker lives in `.facilis/`
**Status:** accepted (2026-11-08)

`facilis.app.json` is written by the template loader and by the upgrade engine, never by the
user (D-065); it sat at the project root next to authored files, where it read like source the
user should maintain.

**Decision.** The marker moves to `.facilis/facilis.app.json`. `APP_MANIFEST_FILE` is the single
constant the template writer, the admission gate, the update checker and the upgrade engine use;
no code hard-codes the path. `.facilis/` is already the generated-state directory (logs, binary
store, graph layout) and the project's `.gitignore` keeps it out of git.

**Consequences:** the marker is now local environment state: an exported or freshly cloned
project reports "unknown environment" for the update indicator and, under a managed
`facilis-only` admission, is not admitted until an upgrade or the adoption step writes one
(adoption remains the follow-up APP-UPDATES.md records). Projects created before this decision
keep an unread root marker and take the same path. That is the accepted trade-off of putting
generated state under `.facilis/`; a tracked root file is what this decision rejects.
