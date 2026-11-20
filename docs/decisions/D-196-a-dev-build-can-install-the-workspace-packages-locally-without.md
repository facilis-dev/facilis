# D-196 — A dev build can install the workspace packages locally, without publishing
**Status:** accepted (2026-11-19)

**Context.** D-166 made a generated project install `@facilis.dev/*` from npm at the version the
IDE build pins, so a change under `packages/**` reaches the WebContainer only after a release.
That blocks end-to-end verification of framework work in `pnpm ide:smoke`: the dev schema
reconcile (D-193) has a PGlite unit test, but its boot/template/migrations/preview integration
could not be exercised in the browser without publishing first (issue #41). The pre-D-166
tarball path was removed because relative `file:` *tarball* specs were mangled by the in-VM npm;
directory `file:` deps are a different mechanism and do not carry that defect.

**Decision.**

- **Dev-only local route.** `pnpm ide:dev` serves the built workspace packages from its own
  origin: `GET /__facilis/dev/packages/index.json` plus each package's `dist/` and a rewritten
  `package.json` (`ide/vite.local-packages.ts`). The plugin is `apply: "serve"` and registered
  only for the dev server, so a production build has no such route and the path 404s there
  (security invariant 6). The route is same-origin guarded, mirroring `isOriginAllowed`
  (D-146). The packages must be built first (`dist/` is what the native ESM loader imports
  under `node_modules`); the smoke builds them as a pre-step.
- **Copy into the VFS at create.** In a dev build with the path enabled, the create pipeline
  (`withTemplateAssets`) fetches the index and every package file and writes them into the
  project under `vendor/facilis/<pkg>/` through the create payload (`kernel.writeFiles`,
  invariant 7). The template pins `"@facilis.dev/<name>": "file:./vendor/facilis/<name>"`, and
  each vendored manifest rewrites its internal deps to `file:../<sibling>`, so the in-VM
  `npm install` resolves the whole closure locally and never reaches the registry for a
  framework package.
- **Compiled flag, release default.** `__FACILIS_LOCAL_PACKAGES__` is true only for a real dev
  server, never a production build and never under Vitest; `FACILIS_IDE_LOCAL_PACKAGES=0` opts
  back into npm to test a pinned release. A production build keeps D-166 exactly: exact
  published versions, no `vendor/`, no `file:` deps, no local route.
- **The analyzer is unchanged.** `framework-sources.ts` still inlines `auth`/`db` source at IDE
  build time; the analyzer never reads installed packages from the VFS, so local vendoring
  cannot affect the project graph.

**Consequences.** A framework change is exercised end to end (boot, schema reconcile, migrations,
preview) by `pnpm ide:smoke` before any release; the smoke asserts the `file:` deps, the vendored
manifest and that no `@facilis.dev/*` request reaches npm. The release path is untouched, so a
deployed IDE still installs installable published packages. Dev project creation is heavier (it
copies the package bytes), but that cost is confined to dev builds and never ships in the template.

**Rejected alternatives.** *A private registry (Verdaccio)*: an extra server to run and keep in
sync. *Tarball vendoring*: the pre-D-166 mechanism whose relative `file:` tarball specs the in-VM
npm mangled. *Serving `src/` with a source-pointing manifest*: Node refuses type stripping under
`node_modules` (`--configLoader native`), so `dist/` is mandatory.
