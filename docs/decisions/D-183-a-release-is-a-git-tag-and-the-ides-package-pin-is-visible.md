# D-183 — A release is a git tag, and the IDE's package pin is visible
**Status:** accepted (2026-11-14)

**Context.** D-164/D-166 publish `@facilis.dev/*` from the deploy workflow with a patch version
derived from npm, and the IDE build compiles that version in as `FACILIS_PACKAGES_VERSION`. Nothing
in the repository recorded it: no tag, no release, no changelog, and the pin reached the browser
only as a literal in the bundle. "Which version is online?" and "which packages does this IDE
expect?" were answerable only from npm or the deploy log.

**Decision.** Every published version gets the tag `vX.Y.Z` at the commit that produced it and a
GitHub Release with generated notes, created by the deploy job immediately after the publish
(`gh release create --target $GITHUB_SHA --generate-notes`, `contents: write`); an existing
release is left alone, so a re-run is safe. The tag is the ledger and npm stays the distribution.
`pnpm release:status` reports the last tag, the npm `latest` per package and the IDE pin together
(`--check` fails on drift), and the IDE status bar shows the pinned version. A
`workflow_dispatch` may name the version (`version=0.2.0`), which is the only way to cut a
minor/major release; the default bump stays a patch.

**Consequences.** The version is visible in three places that now disagree loudly instead of
silently: the tag (git), the dist-tag (npm) and the status bar (browser). Publishing stays
automatic and patch-only — the release is a record, not an approval gate, so "explicit" here means
inspectable, not gated. `0.1.0` predates tagging and has no tag; the first tagged release is the
next publish. A run cancelled between publish and tag leaves a version on npm with no tag, which
`pnpm release:status` reports and one `gh release create` fixes; a separate retryable tag job is
a follow-up if that becomes common.
**Amended by D-198:** the tag names the released SET by its headline (highest committed) version
and the release notes carry the full `name@version` ledger, verified after creation; the
`version` dispatch input is removed — a minor/major release is a manifest edit in a PR — and
`pnpm release:status` compares the committed manifests with npm, the tag being information only.
