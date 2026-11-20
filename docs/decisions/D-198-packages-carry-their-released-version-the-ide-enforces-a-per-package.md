# D-198 — Packages carry their released version; the IDE enforces a per-package minimum
**Status:** accepted (2026-11-20)

**Context.** D-164/D-166 published every `@facilis.dev/*` package in lockstep on a version
derived at publish time (highest on npm + patch), and the IDE build compiled that one number in
from `FACILIS_PACKAGES_VERSION` with a silent `0.1.0` fallback. Nothing in the repository said
which version a package was at: the manifests stayed at the `0.0.0` placeholder, the pin existed
only in the deploy environment and the bundle, and a minor/major release needed a workflow
input. A project created against an older pin could boot against a framework older than its
config/schema expects — the failure mode docs/DEV.md's troubleshooting documents. Issue #40 asks
for the released version to live in each package and for the IDE to enforce a minimum. (Issue
#40 calls this decision D-197; that number was already accepted for the commit-box generator on
2026-11-19, so this ADR takes the next free number.)

**Decision.**

- **Committed versions, no lockstep.** Every `packages/*/package.json` carries the version that
  package publishes — all nine at `0.1.10` today; versions may diverge from here on. A
  minor/major release is a manifest edit in a PR, reviewed like any code change.
- **Publish exactly what is committed.** `scripts/publish-packages.mjs` uploads each package's
  committed version and refuses a `0.0.0` placeholder, an unparseable version, or a version
  already on npm for that package; internal `workspace:*` deps pin to the TARGET package's
  committed version. The `--version` flag and `FACILIS_PUBLISH_VERSION` are gone. A half-failed
  release retries the same committed version once npm serves it — no spare versions. The staging
  mechanism (temp dir, exports -> dist, test filtering, registry verification polling, trusted
  publishing) is unchanged from D-164/D-166. `--dry-run` rehearses staging and skips the script's
  registry pre-check; npm's own dry-run still refuses an already-published version, which after
  a release is the expected "nothing to publish" answer.
- **The tag names the set; the notes are the ledger.** The release tag is `v<headline>` (highest
  committed version in the released set) at the commit that produced it, and the GitHub Release
  notes carry every published `name@version`, rendered and verified with the script's own
  helpers (`renderReleaseLedger`/`verifyReleaseLedger`). The script writes `version` (headline)
  and `set` (name->version JSON) to `GITHUB_OUTPUT`.
- **Build-time per-package minimum.** The IDE build reads `packages/*/package.json` and compiles
  `__FACILIS_MINIMUM_PACKAGES__`, a name->version table covering every non-private
  `@facilis.dev/*` package. `FACILIS_PACKAGES_VERSION`, `__FACILIS_PACKAGES_VERSION__`,
  `frameworkPackagesVersion` and the `0.1.0` fallback are removed everywhere.
- **New projects pin per-package.** The template pins each `@facilis.dev/*` dependency to that
  package's own committed version (exact), never a range.
- **Below minimum: block, then offer the update.** Opening a project whose pins are below the
  table does not boot silently: the IDE blocks and offers an explicit update through the existing
  upgrade engine (D-065/D-070: `upgrade/{recipe,plan,apply}.ts`, `updates.ts`,
  `update-recipes.ts`, `app-status.ts`). The update targets are the committed versions — which
  the shipping release published — so no nearest-version fallback is needed. `file:`/`workspace:`
  pins (dev-local, D-196) and projects without framework deps pass; pins at or above the minimum
  boot normally.
- **release-status reads manifests.** `pnpm release:status` compares the committed versions with
  npm `latest` per package and exits non-zero on any drift; the last tag is information only, not
  a source of truth (amends D-183).

**Why.** The version becomes a reviewed artifact instead of a side effect of a deploy: the tree
says what it releases, and the IDE's minimum derives from the same manifests — one source of
truth, no environment variable to forget or mis-set. A stale project fails loudly with a repair
path instead of booting against stale packages. Per-package versions let a fixed package ship
without dragging eight unchanged ones through a version bump.

**Consequences.** A release is a two-step ritual: bump the manifests in a PR, merge; the deploy
publishes exactly those versions. The publish refuses to re-upload an existing version, so a
force-publish after a successful upload fails loudly instead of minting a spare — the operator
bumps a manifest, or leaves it because npm already serves the set. A deploy-only change now pins
the committed versions rather than npm `latest`: the IDE and the repo never disagree about what
a new project installs. The tag alone no longer identifies every package's version — the
release-notes ledger does, and the workflow verifies it names the whole set.
`pnpm release:status` exits non-zero between a version-bump merge and its publish (committed
ahead of npm): that drift is the expected pre-release state, not an incident. Dev builds are
unchanged (D-196): local `file:` vendoring, or committed pins with `FACILIS_IDE_LOCAL_PACKAGES=0`.

**Rejected alternatives.** *Keep deriving the version at publish time*: the repo still would not
say what it releases, and the IDE minimum would need a second source. *One lockstep version for
all packages*: a one-line fix in one package bumps nine versions and nine tarballs. *A single
global minimum version*: with diverging versions it either blocks projects that are fine or
admits projects that are stale. *Nearest-version fallback in the update path*: the shipping
release published exactly the committed versions, so the update target is known; guessing
reintroduces the drift this decision removes. *Warn instead of block below minimum*: the silent
boot against stale packages is precisely the defect issue #40 reports.

**Verification.** `scripts/publish-packages.test.ts` and `scripts/release-status.test.ts`
(committed-version publishing, placeholder/existing/unparseable refusal, per-package internal
pins, ledger render/verify, a staging fixture, drift detection; the registry is mocked, no
network). `node scripts/release-status.mjs` reports all nine packages in sync at `0.1.10`. The
IDE-side enforcement (minimum table, boot block, update action) lands with the same issue and is
covered by the ide tests; the full gates run at integration.
