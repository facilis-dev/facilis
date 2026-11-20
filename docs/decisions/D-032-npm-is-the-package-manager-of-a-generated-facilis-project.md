# D-032 — npm is the package manager of a generated Facilis project
**Status:** accepted (2026-10-29); supersedes D-022

D-022 made generated projects pnpm-only because npm 10 could not reach the IDE's tarball URLs
inside the VM. Two measurements changed the calculus.

- **pnpm can no longer be kept current.** 12.x ships no JS bundle at all: the npm package is a
  wrapper that installs and spawns `@pnpm/exe.<platform>/pnpm`, a native executable that a
  browser container cannot run. 11.x is the last JS major, and its store index requires
  `node:sqlite`, which the runtime does not serve (pnpm 10.34.9 does not even load — measured
  on 2026-10-28). A developer-facing IDE shipping a
  2025 package manager against a 2026 `latest` is exactly the "already old" signal we refuse
  to ship, and no version bump fixes it.
- **The URL dependency was never necessary.** The four `@facilis.dev/*` tarballs are static files
  the IDE already serves (17-57 KB each). The IDE fetches them at create time (template
  `manifest.assets`) and inlines them into the create request, so they land in the project's
  `./vendor`, which declares them as `file:` dependencies. The install touches no HTTP at all — no agent/egress split, no host
  alias — and the generated project installs unchanged outside the IDE.

**Decision:** generated projects install with **npm**, vendored by the IDE and pinned in
lockstep with the VM's Node: `NPM_VERSION` in `scripts/dev/vendor-assets.sh` equals the
template's `"packageManager"` (both `12.2.1`), and npm 12's engines
(`^22.22.2 || ^24.15.0 || >=26.0.0`) contain the `v24.18.0` the runtime reports. The
`preinstall` guard rejects anything that is not npm. `.npmrc` keeps only VM-relevant
switches (audit/fund/progress/update-notifier off); the flat `node_modules` npm produces is
what Nitro's undeclared transitive requires (`ufo`, …) rely on, so pnpm's
`node-linker=hoisted` workaround is gone. Templates list their binary assets in the manifest;
the IDE fetches them same-origin and inlines them as bytes in the create request's `files`,
which the kernel writes with the text files in one batch.

**Update (2026-11-13, pin `0a1eea1`):** the runtime now serves `node:sqlite` (upstream
`v1.2.0`) and the vendored kernel ships pnpm 11, so the first bullet's "pnpm 11 cannot run"
no longer holds. The decision is unchanged — a generated project still installs with npm
12.2.1 — and pnpm remains the internal rolldown fallback, now pinned at 11.28.9 (D-180).

**Consequences:** npm is the one package manager whose distribution cannot go native — it is
the manager Node ships with, and it has been a pure-JS tree its whole life — so "aligned with
Node" becomes a maintenance routine we own (bump the version, rebuild the pack, re-run the two
smokes; the vendoring patch to Arborist's `#loadPeerSet` is the only coupling, and it fails
loudly when npm refactors it). pnpm remains in the VM only as the tool rolldown invokes for
its wasm binding inside a Vite 8 project (`pnpm i @rolldown/binding-wasm32-wasi`): pinned,
internal, and carrying no version promise. The `@facilis.dev/*` `file:` specs are interim —
when the packages are published (O-006) the dependency specs change and nothing else does.


**Follow-up (2026-10-29, same day): npm re-derives a RELATIVE `file:` target, and that broke
installs.** The first generated projects failed with
`npm warn tarball ... @facilis.dev/auth@file:../../../../user/projects/<name>/vendor/...` and then
`ENOENT /user/projects/<name>/vendor/...`: the `package.json` on disk was correct
(`file:./vendor/...`) and `path.resolve` inside the VM was correct, but npm normalizes a
relative `file:` dependency by storing `file:` + `path.relative(where, resolvedPath)`
(`npm-package-arg`) and reading that back — in that environment the re-derived target lost
`/home` and every install retried a file that exists. The project's specs are now **resolved
before npm runs**: `scripts/vendor-paths.cjs` rewrites the four `@facilis.dev/*` dependencies to
absolute tarball paths (and refuses a project whose `vendor/` assets are missing), and the
template's install command is `node scripts/vendor-paths.cjs && npm install`, so the IDE's Run
and a later bare `npm install` both work. The specs stay relative *in the template* (a project
exported before its first in-IDE install is still relocatable); after the first install the
resolved absolute paths are what npm caches in the lockfile. The same change removed the
`npm_config_store_dir` / `npm_config_package_import_method` env vars from the base process
environment — they are pnpm's own config, and npm 12 warned `Unknown env config` for them on
every install (fork commit `a6d6aa5`, rebased onto upstream `v1.1.4`, which also moved that
release's `strict-store-pkg-content-check` into the shim; a future npm major turns the warning
into an error).

**Update (2026-10-31, pin `97d90ab`):** the vendored kernel moved to upstream `v1.2.0`, whose
realignment reverts the fork-only `e2f4246` (`manifest.assets` fetched by the kernel worker).
The template keeps the asset list, but the IDE now fetches the tarballs in the page and passes
their bytes through the create message's `files` (`ide/src/facilis/project-assets.ts`) — the
mechanism the kernel already had (`writeFilesBatch` takes bytes) and the one the fork's
`FORK.md` recommends to embedders. The created project is byte-identical.

**Amended by D-164/D-166:** the packages are published, so the `file:` tarball delivery described
above is gone. Generated projects declare exact versions and install the `@facilis.dev/*` packages
from npm; the version is injected by the release build (D-166).
