# D-164 — The framework packages publish to npm under `@facilis.dev` on every deploy
**Status:** accepted (2026-11-11)

**Context.** O-006 left the publish target open until Phase 6, and every generated project has
installed the framework packages from tarballs the IDE serves on its own origin (D-022). The npm
organization `facilis.dev` now exists, and an npm scope is the organization name: the packages
must move from `@facilis/*` to `@facilis.dev/*`, because an owner of `facilis.dev` cannot publish
under the `facilis` scope. npm has no alias or relocation mechanism, so keeping the old names
would mean occupying a second organization instead.

**Decision.**

- **Scope.** Every workspace package is renamed `@facilis/*` → `@facilis.dev/*` across imports,
  package manifests, the IDE template, the lockfile and the docs. Nothing outside this repo
  consumes the old names, so this is a one-shot breaking rename rather than a compatibility shim.
- **Publishing rides the deploy.** `.github/workflows/publish-packages.yml` runs on every push to
  `main` that can change `packages/**`. It gates the published surface (`turbo lint/typecheck/
  test/build` scoped to `./packages/*`, plus the file-length gate) and then runs
  `scripts/publish-packages.mjs --skip-build`; the IDE is not published and stays out of the gate.
- **Versions are derived, not committed.** The nine packages release in lockstep on the next patch
  after the highest version already on npm (`0.1.0` for the first release); the workspace version
  stays `0.0.0` as the placeholder. A half-failed release retries on a version no package has yet,
  so the set never splits. Runs are serialised (`cancel-in-progress: false`) so two deploys cannot
  derive the same version.
- **What is uploaded.** `scripts/publish-packages.mjs` stages each package into a temp directory:
  `exports` are rewritten to `dist/*.js` with `main`/`types` derived, declaration specifiers are
  repaired to `.js`, `workspace:` deps are pinned to the release version, `devDependencies`/
  `scripts` are dropped, README/LICENSE are copied in and test modules are filtered out. The
  workspace tree is never modified, so local development keeps resolving `src/` (and the IDE
  keeps its own dist-rewritten tarballs, D-022).
- **Credentials.** The workflow authenticates with the `NPM_TOKEN` repository secret (granular
  token with read/write on the organization); a missing secret fails before the first upload with
  a named error. Trusted publishing (OIDC) can replace the token once the packages exist and a
  trusted publisher can be attached to each.
- **Amended 2026-11-14 — publishing is tokenless (trusted publishing).** The secret is gone: the
  job requests a short-lived GitHub OIDC token (`permissions: id-token: write`) and the npm CLI
  (≥ 11.5.1, Node ≥ 22.14) exchanges it for a publish credential, with provenance attached
  automatically and no token that can leak or rotate. A trusted publisher is configured per
  package on npmjs.com (`facilis-dev`/`facilis`, workflow `deploy-ide.yml`, `npm publish`
  allowed, no environment); a new configuration must complete its first publish within 2 days or
  it expires, and a token in the environment would silently take precedence over OIDC — so the
  workflow asserts the CLI version, the permission and the absence of a token before the upload.
  GitHub-hosted runners only.

**Consequences.** O-006 is resolved: the packages are installable by name, which unblocks the
`starter/` task D-027 deferred. **Amended by D-166:** generated projects no longer install vendored
tarballs; they install these published packages at the exact version the IDE build pins. The repo version is a floor, not the published version — the workflow
derives it — and a manual release uses the same script (`pnpm publish:dry-run`, then
`pnpm publish:packages` after `npm login`). The old `@facilis/*` names stop resolving.
**Amended by D-166:** the separate publish workflow is gone — publishing is the first job of
`.github/workflows/deploy-ide.yml`, which then builds the IDE against the version it just published.
