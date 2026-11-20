# D-166 — Generated projects install the published packages at the version the IDE build pins
**Status:** accepted (2026-11-11)

**Context.** D-032 kept the `@facilis.dev/*` dependencies of a generated project as `file:`
specs pointing at tarballs the IDE served from its own origin, because the packages were
workspace-only (O-006). D-164 published them and resolved O-006, and D-032 already said the
follow-up was only a change of dependency specs. The tarball path also carried machinery that
existed for that reason alone: `scripts/dev/vendor-facilis-deps.sh`, an `ide:facilis-deps`
deploy step, ~900 KB of assets inlined into every create request, a `scripts/vendor-paths.cjs`
rewrite in every generated project, and the workspace `0.0.0` version leaking into manifests.

**Decision.**

- **Exact version, injected at build time.** The generated project declares every
  `@facilis.dev/*` dependency at one exact version, `frameworkPackagesVersion`, and installs
  with plain `npm install`. The version is not stored in the repo: the IDE build reads
  `FACILIS_PACKAGES_VERSION`, compiles it in through Vite (`__FACILIS_PACKAGES_VERSION__`) and
  writes it into the template; a dev build without the variable pins `0.1.0`.
- **Publishing rides the deploy in one workflow.** On a push that changes `packages/**` (or a
  manual dispatch with the `publish` input), the release job first gates and publishes the
  packages, takes the version the publish script returns, then builds and deploys the IDE with
  it. On a deploy-only change the version is the current npm `latest`. Two parallel workflows
  would race: the IDE would pin the version it saw before the publish finished.
- **The publish script verifies the registry before the build continues.** It polls until every
  package reports the new version as `latest` and fails the release otherwise. This catches a
  stage-only npm token (which stages versions and leaves a `0.0.0-stage` placeholder instead of
  publishing them) before an IDE is shipped pointing at packages that are not installable.
- **The tarball machinery is removed.** No `vendor/` assets in the template, no
  `vendor-paths.cjs`, no `TEMPLATE_PACKAGES`-driven asset inlining (the template-asset plumbing
  stays with an empty list for future binary files), no `ide:facilis-deps` script or deploy
  step, and the IDE no longer serves `/vendor/facilis/*.tgz`.
- **The analyzer is unchanged.** `framework-sources.ts` keeps inlining `packages/auth` and
  `packages/db` source at IDE build time, so the project graph is correct before (and without) a
  successful install; `analyze-files.ts` already reads `node_modules/@facilis.dev/` from the VFS,
  which is exactly what a registry install produces.

**Consequences.** A created project installs the framework like any other dependency, from the
registry, inside the VM, and keeps working outside the IDE with no vendored files. Create
requests get smaller and the generated manifest carries a real semver. The deploy now fails if
the packages cannot be published or verified — by design, because the deployed IDE must point at
installable packages — so a red npm token blocks the IDE release instead of silently producing a
stale one. Dev builds (`pnpm ide:dev`) pin the fallback `0.1.0`; a project created there installs
that version from npm, so a change in a package requires a deploy (or a build with
`FACILIS_PACKAGES_VERSION` set) before it appears in newly created projects.
**Amended by D-196:** a *dev* build can instead install the workspace packages locally from the
IDE origin (`file:` directory deps under `vendor/facilis/`), so a package change is testable in
`pnpm ide:smoke` without publishing; the release path described here is unchanged.
**Amended by D-198:** the single injected version is gone — each package publishes the version
committed in its own manifest, the IDE build compiles those manifests into a per-package
minimum (`__FACILIS_MINIMUM_PACKAGES__`), new projects pin each framework dependency to its own
package's version, and a project below the minimum is blocked with an explicit update instead
of booting.
