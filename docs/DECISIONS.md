# Decision log

ADR-style log for Facilis. The contract lives in [`docs/SPEC.md`](./SPEC.md); this file
records decisions taken **around** the spec (toolchain, conventions, ambiguities resolved)
so they are not re-litigated or lost.

Format: `D-0NN — title` · **status** (accepted / open) · context · decision · consequences.

---

## Accepted

### D-001 — Stack locked to spec §2.1
**Status:** accepted (2026-10-25)

Vite 8 · Nitro v3 as a Vite plugin (`nitro/vite`) · Drizzle · PGlite · React 19 ·
Zod · isomorphic-git · BYO LLM key. Nitro v3 is beta, so the version is **pinned exactly**
and upgraded deliberately (spec §13 risk 2).

**Consequences:** `vite dev` is the only dev command; `nitro dev` is never used.

### D-002 — Toolchain defaults
**Status:** accepted (2026-10-25)

- Node **>= 22.15** (`.nvmrc` = 22), pnpm workspace (v12) + turbo.
- TypeScript **strict**, ESM only.
- **oxlint** + **Prettier** (print width 100).
- **Vitest** for unit/integration tests.
- **Max 300 lines per source file**, enforced by `scripts/check-file-length.mjs` in CI.
- **Conventional Commits**; branches + PRs into `main`.

**Consequences:** CI runs install → lint → typecheck → test → build; the file-length check
is part of lint, not an optional advisory.

### D-003 — UI baseline is Tailwind + shadcn, not Radix
**Status:** accepted (2026-10-25)

The Studio we fork (Vivari) uses **Tailwind CSS v4 + shadcn/ui (`base-nova`) + Base UI
primitives** and React 19. Facilis follows that stack for Studio **and** for
`@facilis/blocks`/generated pages. The spec/README wording "Radix UI" was replaced
accordingly (§2.1, §5.4, README).

**Consequences:** styling is Tailwind utility-first; `@facilis/blocks` assume Tailwind is
present in the generated app; no second component system is introduced.

### D-004 — Docs hygiene
**Status:** accepted (2026-10-25)

`docs/specs.md` renamed to `docs/SPEC.md` (all README links now resolve); dangling
`[reference:N]` markers removed; README "four layers" corrected to the spec's **five**
layers. Spec remains authoritative over README.

### D-005 — Agent git access
**Status:** accepted (2026-10-25)

A repo-scoped **deploy key** (`facilis-dsh-agent`, write access) is used for agent git
operations over SSH. It is revocable at any time from the repository settings. Commit
identity for this repo: `Michele Scala <scala233@gmail.com>` (matches existing history).
No personal SSH key or PAT is required.

### D-006 — Phase 0 spikes are standalone
**Status:** accepted (2026-10-25)

Feasibility spikes live in `spikes/<name>/` and are **not** pnpm-workspace packages
(installed with `pnpm install --ignore-workspace`). They prove assumptions before
framework code depends on them (spec §12 Phase 0, §14.1). The Phase 0 spike was retired on 2026-11-01 once D-007 and D-008 were implemented; this entry stays the rule for future spikes.

### D-007 — A16: framework AST pass is required (Phase 0 outcome)
**Status:** accepted (2026-10-25)

Phase 0 proved that Nitro's route-meta scanner only recognises a **top-level**
`defineRouteMeta(...)`; the call inside `defineAuthorizedHandler` is invisible, so
`x-db-tables` never reaches `/_openapi.json` natively (A16 = fail). The fallback required
by spec §13 risk 3 is therefore **adopted as the design**: `@facilis/nitro` ships a
framework-owned AST pass (statically reads the wrapper config into a virtual module) plus a
facade that merges the metadata into Nitro's generated spec at `/_openapi.json`.
Nitro's own spec moves to the internal dev-only route `/_facilis/openapi.json`.

**Consequences:** spec §6.9/§13/§14.1 updated; Phase 1 must add route-edit invalidation
(Vite module graph) and a lint/review check for non-literal `dbTables` imports.
Prototype + evidence: the Phase 0 spike (commit `de17169`, retired 2026-11-01); the production pass is `packages/nitro/src/ast/extract-metadata.ts` with `packages/nitro/src/facade.ts`.

### D-008 — RLS policy composition fix
**Status:** accepted (2026-10-25)

Postgres ORs multiple permissive policies per command, so the spec's verbatim policies
(§8.4.5) let a manager see all tenant rows and an admin cross tenants. Adopted:
tenant isolation is `AS RESTRICTIVE` (always AND-ed), and role GUC reads use
`nullif(current_setting('app.roles', true), '')` before casting to jsonb (after `RESET`
the GUC is `''`, and `''::jsonb` throws). Spec §8.4.5 updated; `@facilis/db`'s RLS
generator must emit this shape. PGlite is a superuser and bypasses RLS, so tests must
`SET ROLE` to a non-superuser.

### D-009 — Headless dev-server caveat (environment only)
**Status:** accepted (2026-10-25)

In this sandbox Nitro inherits `PORT=8080` (occupied) and Vite's default `localhost`
binding resolves to IPv6 `::1`. Headless spike/CI scripts must override `PORT` and probe
`http://localhost:<port>` (or pass `--host 127.0.0.1`). This is a harness detail, not a
product decision; it does not affect Vivari, where the dev server runs in the browser.

### D-010 — Nitro v3 module API: no `defineNitroModule`
**Status:** accepted (2026-10-25)

Spec §5.6 and Appendix E show `import { defineNitroModule } from "nitro/kit"`. That export
**does not exist** in the pinned `nitro@3.0.260903-beta`: there is no `./kit` entry, and
Nitro v3 migration docs state modules are plain objects. Verified against the installed
package:

- a module is `{ name, setup(nitro) }`, typed as `NitroModule` from `nitro/types`;
- `Plugin.nitro?: NitroModule` is declared by `nitro/vite` (so `facilis()` can carry it);
- `nitro()` returns a `Plugin[]`, and `defineHandler` is an identity wrapper (a plain
  async function is a valid route handler).

**Consequences:** `@facilis/nitro` implements the plain-object module; the spec snippets are
corrected in the Phase 1 docs pass. No behaviour change to the design.

### D-011 — Vivari Studio is a vendored fork in `studio/`
**Status:** accepted (2026-10-25); the layout inside it was refined by D-017

`studio/` contains an import of `github.com/maitrungduc1410/vivari` (MIT) pinned to a single
upstream commit, imported as one commit with provenance in `studio/FACILIS.md`. Upstream CI,
marketing site, changesets and the very large planning docs are excluded; upstream
`README.md` is kept as `UPSTREAM-README.md`.

Root gates exclude the vendored tree (`studio` is skipped by
`scripts/check-file-length.mjs`, `.oxlintrc.json` and `.prettierignore`) and it is **not** a
pnpm workspace member, so the framework workspace stays small and CI fast. Facilis changes
go into new modules; upstream files are not rewritten, so re-syncing upstream stays a
path-by-path re-import.

**Consequences:** Studio build/runtime verification is environment-dependent (upstream needs
`bun`, `npm` for vendored assets, and Rust/`wasm-pack` for the VFS/codec/crypto packages -
none present in this sandbox). What can and cannot be verified is recorded in
`studio/FACILIS.md`; Phase 0 browser items (A1-A3, A6, A8-A12) remain open until a
WebContainer-capable browser harness exists.

### D-012 — Phase 1 work split, branch and PR strategy
**Status:** accepted (2026-10-25)

Phase 1 is split into four disjoint write scopes (one shared task each): `@facilis/core`,
`@facilis/db` + `@facilis/auth`, `@facilis/nitro`, and the `studio/` fork. Module boundaries
and exact public APIs are fixed in `docs/PHASE1-CONTRACTS.md` so the packages can be built in
parallel without import cycles: `db` (leaf) <- `auth` <- `core` <- `nitro`; `core`, `auth`
and `db` never import `nitro`/`vite`/`h3` (they type handlers against a structural event).

Branches: `feat/phase-0-foundation` (PR #1), then `feat/phase-1-core-packages` stacked on it
for packages + the Studio fork + the Phase 1 example app (PR #2). `main` is only updated via
PR.
### D-013 — `defineConfig` takes a partial input and resolves defaults
**Status:** accepted (2026-10-25)

Spec §7.1 declares the fully-resolved `FacilisConfig`, but §8.4.1 shows a `facilis.config.ts`
containing only `auth`. Adopted: `defineConfig(input: FacilisConfigInput)` with `auth`
required and every other section optional, resolving documented defaults (release `main`;
db pglite, `./drizzle`, tenant/owner column aliases; i18n `en`; no block packages; 7-day
sessions). Objects are strict (unknown keys rejected) and the auth block is cross-checked:
every permission a role references must be declared, `"*"` is valid only as a role entry,
`defaultRole` must exist. `facilisConfigSchema` validates the input form; the output is the
full `FacilisConfig`.

**Consequences:** `facilis.config.ts` stays short, typos fail at boot with a readable error,
and `@facilis/nitro`/`@facilis/db` always consume the resolved shape.

### D-014 — RLS enforcement identity, auth lookups and role policies
**Status:** accepted (2026-10-25)

Phase 0 found that PGlite connects as a superuser, which bypasses RLS (even `FORCE`).
Adopted: the dev bootstrap creates a non-superuser `facilis_app` role and grants it DML on the
public schema; `runWithPolicyScope` runs every handler transaction as `SET LOCAL ROLE
facilis_app` before setting the GUCs, so row-level security is actually enforced in dev.

Consequences and decisions taken from that:

- Auth lookups (`validateSession`, `registerInitialAdmin`) run on the **root** client, not
  inside a tenant scope: the `users` table is tenant-isolated by a restrictive policy, so a
  tenant-less lookup would be filtered out. `sessions` has no RLS (single-purpose table,
  only reachable through the session id). Phase 3 follow-up (a real Postgres pool) needs a
  privileged lookup path or a `tenant_id` on `sessions`.
- `users` ships one restrictive tenant policy **plus** a permissive "tenant GUC present"
  policy: Postgres denies by default when only restrictive policies exist.
- `rolePolicy(column)` means "the table column that holds the role name the caller needs",
  i.e. `nullif(current_setting('app.roles', true), '')::jsonb ? column`; the spec §8.4.5
  example hardcodes `? 'admin'`, which is a special case of the same generator.
- Giving `facilis_app` its grants is a dev bootstrap (`ensureAppRole`); a deployed Postgres
  must provision the role out of band.
### D-015 — Phase 1 verified end-to-end (and the Nitro deviations it surfaced)
**Status:** accepted (2026-10-25)

`examples/todo-app` is the Phase 1 acceptance app and it runs headlessly: health, full and
summary manifest (547 chars), `/__facilis/manifest/revision`, ETag/304, invalid `sections`
400, cross-origin 403, `/_openapi.json` with `x-permission`/`x-db-tables`/`x-db-columns`,
registration with `FACILIS_INITIAL_ADMIN`, default-role assignment, login/session with
expanded permissions, todo CRUD, RLS isolation (second user sees nothing, cross-user DELETE
is a 404), invalid body/query 400s and anonymous 401. Reproduce with
`cd examples/todo-app && ./scripts/verify-headless.sh`.

Deviations accepted while getting there:

- `#facilis/openapi-meta` is owned **only** by the `facilis()` Vite plugin, not registered as a
  Nitro virtual module: inside the Nitro environment, Nitro's virtual plugin resolves that id
  before user plugins, which served stale metadata and broke HMR. `#facilis/config` and
  `#facilis/db-schema` stay Nitro virtuals.
- `?format=summary` returns `{ revision, generatedAt, sections, summary, warnings }`; the
  compact view is not a `Partial<FacilisManifest>` (spec §6.1 note added).
- The revision hash uses the AST metadata map (the Facilis-owned part of the spec) rather than
  the merged OpenAPI document, avoiding a self-fetch and staying deterministic without Nitro's
  generator.
- Dev boot applies migrations, seeds `role_permissions` and runs `ensureAppRole`; the
  production facade is only mounted when `openAPI.production` is enabled.
- Dev PGlite runs in-memory (the config `dataDir` is not wired yet): the dev database resets
  when the Nitro worker restarts. Tracked as later-phase work; tests and the example do not
  depend on persistence.

### D-016 — `.ts` relative imports, workspace examples, excluded fork
**Status:** accepted (2026-10-25)

A Vite config is loaded by **Node's native ESM loader**, which does type stripping but requires
explicit extensions. Because packages export their `src`, the plugin entry graph
(`@facilis/nitro/vite` -> core/db/auth) must be loadable that way. Adopted: relative imports
inside `packages/*/src` carry `.ts`, with `allowImportingTsExtensions` +
`rewriteRelativeImportExtensions` so `tsc` rewrites them to `.js` on emit. `tsconfig.base.json`
also sets `types: ["node"]` (source-exporting packages are typechecked by their consumers, so
the lib/types surface must be uniform).

`examples/*` is a pnpm-workspace glob so the acceptance app is linted, typechecked, tested and
built by the same gates as the packages. `studio/` (the app fork) and `vendor/vivari/` (the
pinned kernel) are explicitly excluded from the workspace, the file-length check, oxlint and
Prettier: they are upstream-owned code with their own toolchain (D-017).
### D-017 — The IDE app and the upstream Vivari sources are separate trees
**Status:** superseded by D-018 and D-019

Vendoring Vivari as one tree under `studio/` left a second npm workspace root inside the repo
(`studio/packages/studio` = app, `studio/packages/*` = kernel, `studio/{scripts,worker,examples}`
in neither), so the tree was partitioned by role. D-018 then made the upstream half a real
git clone (submodule) instead of a copied tree, and renamed the app folder to `ide/`; D-019
brought that app under the repository's own toolchain. The split itself stands: one upstream
tree, one app tree, no duplicated files.

### D-018 — Upstream Vivari is a git submodule; the app folder is `ide/`
**Status:** accepted (2026-10-25); the submodule URL and branch are superseded by D-030

A copied tree is bad at the one operation that matters: staying aligned. `vendor/vivari` is a
**git submodule** (initially of `github.com/maitrungduc1410/vivari`, MIT, pinned at `1f00a48…`
/ tag `v1.1.2` with `branch = master`). D-030 moved it to our fork
`github.com/kele23/vivari`, pinned to `facilis/main`; the pin is a commit either way,
`git status` shows a single changed pointer, and nothing upstream is copied into our history.

The app folder is renamed `studio/` -> `ide/`: it is the Facilis IDE (the product is the IDE;
"Studio" was the upstream/vendor name), it starts as the full upstream `packages/studio` at the
pinned tag, and from there it is a fork that follows our conventions (D-019). The kernel is
consumed from the submodule by source: `@vivari/core` alias, `fs.allow` widened to the repo
root, and five deep imports — the complete patch set is in `ide/README.md` and
`vendor/README.md`.

**Consequences:** a fresh checkout needs `git submodule update --init vendor/vivari` before the
IDE typechecks (CI checks out submodules recursively); `vendor/` stays out of the pnpm
workspace and out of every gate; `ide/` **is** a workspace member (D-019).

### D-019 — The IDE follows the repository toolchain, not upstream's
**Status:** accepted (2026-10-25)

`ide/` is a pnpm-workspace member and is held to AGENTS.md like the framework packages:
**TypeScript strict** (`tsc --strict` and the pinned TypeScript 7: 0 errors on 756 files), the
root **oxlint** config (the upstream per-app `.oxlintrc.json` was removed; its 89 rule errors
were fixed — mostly `eqeqeq`, with the repo rule refined to `"smart"` so `== null` stays
idiomatic), repo **Prettier** (print width 100; the tree was formatted once when the fork
started, a mechanical no-behaviour-change commit), and **vitest** (`src/vv/run-phase.test.ts`,
the pure phase machine). Scripts: `build` = `tsc -b` (passes everywhere), `build:app` = the
full `vite build` which stays blocked on the missing Rust->Wasm `pkg/` outputs.

The 300-line limit is a hard rule for new code. Fourteen inherited files are above it
(`templates.ts` 11.4k lines of template payloads, `controller.ts` 4.3k, ten components,
`vite.config.ts`); they are recorded in `scripts/file-length-baseline.json` and
`scripts/check-file-length.mjs` enforces a **ratchet**: listed files may shrink but not grow,
entries must be deleted when a file drops under the limit, and nothing new can be added.
Splitting them (starting with `controller.ts`) is Phase 2 refactor work.

**Consequences:** `pnpm lint/typecheck/test/build/format:check` cover the IDE (217 files linted,
12 typecheck tasks, 222 tests, 8 build tasks); CI checks out submodules; `ide/README.md` carries
the complete delta vs upstream so an upstream bump stays a mechanical diff.

**Update (2026-10-31):** the Phase 2 split is under way (D-042). `controller.ts` is down from
4,294 to 2,518 lines, its baseline entry is lowered at every step, and the extracted modules are
all under the 300-line limit.

### D-020 — Project site and canonical domain: facilis.dev
**Status:** accepted (2026-10-25)

`facilis.dev` is registered and becomes the canonical project home — the site, the docs at
`/docs`, and the identity used in public naming. `.dev` is the right signal for a developer tool,
and the domain is short enough to say out loud.

**Context:** "Facilis" collides with three existing products (facilis.com media storage,
facilis.ai agentic manufacturing, Facilisgroup), so the wordmark alone is not searchable.

**Consequences:** every page title carries a descriptor ("Facilis — …"); `www` 301s to the apex;
docs stay on the apex path until they outgrow it; GitHub org, npm scope `@facilis` (O-006),
social handles and `hello@facilis.dev` must be claimed early. Site strategy — including the
two-pillar message architecture — lives in [`docs/WEBSITE.md`](./WEBSITE.md) (W-1, W-9).

### D-021 — The IDE dev environment is scripted, and the browser path is verified
**Status:** accepted (2026-10-25)

The IDE can only run when four artifacts exist, all of them gitignored upstream build outputs:
the kernel's Rust->Wasm `pkg/` dirs, the kernel's real-CLI assets (`npm-pack.bin`,
`pnpm-pack.bin`, `sqlite3.wasm`), and a browser with system fonts. They are produced by
`scripts/dev/` (`build-kernel-wasm.sh`, `vendor-assets.sh`, `fetch-browser.sh`) and exercised
by `scripts/dev/smoke-ide.mjs`, wired as `pnpm ide:wasm`, `ide:assets`, `ide:browser`,
`ide:dev`, `ide:smoke`. The recipe, pinned versions and troubleshooting are
[`docs/DEV.md`](./DEV.md); the scripts must stay the only way in.

**Context:** the target sandbox has no root, no writable `$HOME`, no `cc`, no `xz`, no
browser and no fonts, but it does have network. Reproducing upstream's pipeline therefore
means: Zig as the host linker for Rust build scripts, a prebuilt `wasm-bindgen` seeded into
wasm-pack's cache, npm/pnpm tarballs extracted instead of installed, and Chromium + its .deb
dependency closure unpacked into a private sysroot with a generated `fonts.conf`. Without
fonts, Chromium measures zero-height line boxes: the UI renders blank and even `innerText`
is empty.

**Consequences:** the browser path is proven — kernel online 572 ms, project created, in-VM
`npm install`, dev server bound, preview painted at 31 s, 16/16 smoke checks; evidence under
`$FACILIS_TOOLING_DIR/smoke-artifacts/`. **All Vite templates now resolve `vite@^7.1.0`
instead of upstream's `^8.0.0`**: Vite 8's rolldown wasm binding pins
`@emnapi/core@2.0.0-alpha.5`, which `@napi-rs/wasm-runtime@1.2.6` rejects
(`TypeError: Cannot set properties of undefined (setting 'initWorker')`), and rolldown's
webcontainer fallback reinstalls the same broken set. Vite 7.3.7 boots in 259 ms in the same
VM. Upstream fix: [rolldown#11292](https://github.com/rolldown/rolldown/pull/11292)
(opened 2026-10-25) moves the wasi binding to `@emnapi/core@2.0.0-beta.2`; rolldown releases
weekly and Vite 8 depends on `rolldown ~1.2.14`, so the next rolldown patch release unblocks
Vite 8 with no Vite bump — then the templates go back to `^8.0.0` and `pnpm ide:smoke` is the
gate (`docs/DEV.md` §6.1). The `@rolldown/binding-wasm32-wasi` entries stay in the templates so
the retry is a version bump. `build:app` (the IDE's full
`vite build`) is still not part of the pass. This unblocks the Phase 0 browser items A1-A3,
A6 and A8-A12 that were waiting on a harness.

---

### D-022 — Facilis projects install with pnpm only, from IDE-served tarballs
**Status:** superseded by D-032 (2026-10-29); kept for the investigation it records

A generated Facilis project installs `@facilis/*` from `pnpm pack` tarballs served by the
IDE origin, and it does so with **pnpm only**. Both halves are forced by the WebContainer,
not preferences:

- **Tarball delivery.** The packages are workspace-only (O-006), so the template declares
  them as `http://host.vivari.internal:<studio-port>/vendor/facilis/facilis-<pkg>-0.0.0.tgz`.
  It cannot use the studio origin verbatim: the kernel's virtual network owns loopback, so
  `127.0.0.1:<port>` inside the VM is the VM, and npm/pnpm get `ECONNREFUSED`. The kernel's
  documented host alias is rewritten to the studio hostname in the browser before the fetch.
- **pnpm, not npm.** npm 10 builds its HTTP agent with `agent-base`, whose custom
  `createConnection` makes the runtime decline the fetch-backed egress path for plain-http
  requests (`internal/http-egress` only egresses when the agent is the stock one). npm then
  dials the virtual network and fails with `ENOTFOUND` for the tarball URLs — reproduced in
  npm's own debug log, while `https://registry.npmjs.org` traffic is unaffected. pnpm's fetch
  uses the stock agent, reaches the alias, and installs. The template therefore runs
  `pnpm install`, ships a `preinstall` guard that fails under any other package manager, and
  sets `packageManager: "pnpm@9.15.9"` (the vendored `pnpm-pack.bin`).
- **`node-linker=hoisted`.** The isolated link farm hides packages that Nitro's shipped dist
  imports without declaring (D-024), and hoisted linking gives the flat layout the VM module
  resolver expects. The template pins those packages itself.

**Consequences:** the generated project is pnpm-only by design and its README says so; npm
inside the VM remains broken for plain-http URL dependencies until upstream fixes the egress
split (a vendor change, not ours). The kernel's dependency cache is namespaced per package
manager and snapshots `node_modules` by package.json hash, so a **second Facilis project in
the same browser restores it in one blob instead of reinstalling** — the cross-project cache
this decision leans on. Each headless smoke run still starts from a fresh profile, so it pays
a cold install (prebuilt `vendor/depcache` is the later optimisation). Switching `@facilis/*`
to published packages changes the dependency specs only; pnpm stays the installer.

### D-023 — Packed Facilis tarballs expose compiled dist
**Status:** accepted (2026-10-27, Phase 0 browser spike)

The generated project's Vite config is loaded with `--configLoader native` (Vite's own config
bundler cannot run in the WebContainer), and a native ESM loader refuses to strip types from
files under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). The config imports
`@facilis/nitro/vite`, so that entry must be JavaScript. `pnpm ide:facilis-deps` therefore
builds each package, packs it, and rewrites the packed manifest's `exports` from `./src/*.ts`
to `./dist/*.js`; the workspace source keeps its `src` entry points. `@facilis/nitro` also
derives its Nitro handler file paths from the extension of its own module (`RUNTIME_EXT`),
because a dist build previously registered `dist/routes/*.ts` handlers that do not exist.

**Consequences:** the packaging script builds before packing (a stale dist is a real bug, not
a warning), tarballs ship both trees, and the `.ts` handler assertions in the package tests
stay valid because tests import `src`.

### D-024 — Nitro runs in the WebContainer through the in-process runner
**Status:** accepted (2026-10-28, Phase 0 browser spike; first green Facilis smoke)

Because the generated project's Vite config is loaded natively (D-023), Nitro's shipped dist
is executed as-is by the VM's ESM loader instead of being bundled for the browser. Two
packaging facts then decide whether the dev server boots:

1. **Nitro's traced `dist/node_modules` copies are ESM-only, and the VM loader resolved CJS
   conditions.** `nitro@3.0.260903-beta` does ship its external imports under
   `dist/node_modules`, but pruned to the ESM build: `defu` declares `main`/`require` →
   `lib/defu.cjs`, which is absent (only `dist/defu.mjs` ships), and `ufo`, `destr`, `scule`,
   `croner`, `rendu`, `youch` and the rest are pruned the same way. Node's ESM loader would
   pick the `import` condition; the VM loader (`vendor/vivari/packages/runtime/module.js`,
   `resolveFilename`) picked the CJS/`main` target even for ESM imports and did not fall back
   to `module` when that file was missing. Resolution then walked up to the project's
   `node_modules`, found nothing, and the boot died with `Cannot find module …` (thrown from
   `module.js:452`). **Resolved in the fork** (`fix/runtime-esm-only-targets`, PR #19): the
   resolver now collects every candidate target in condition order and returns the first one
   that exists on disk, so the vendored ESM copies load. The template therefore no longer
   pins them: measured 2026-10-29 on the pinned fork, with the whole pin list removed,
   `TEMPLATE=Facilis pnpm ide:smoke` → **SMOKE PASSED** (52 checks, preview painted, A12 OPFS
   restore included), and the generated `package.json` is ~320 bytes lighter. Two packages
   stay pinned because nitro does not vendor them: `picomatch` (nitro's builder
   `__require`s it at run time) and `@vercel/queue` (lazy-imported only by the Vercel Queues
   preset). Dropping those needs a build / Vercel-path check, not a dev smoke.
2. **The out-of-process dev runners cannot start.** `node-worker` and `node-process` resolve
   their entry with `fileURLToPath(import.meta.resolve(...))`; the VM runtime's
   `import.meta.resolve` does not hand back a file URL, so `fileURLToPath` throws
   `TypeError: Invalid URL`. `devServer: { runner: "self" }` keeps the Nitro environment in
   the Vite dev-server process. With that runner Nitro owns the listening socket on port
   3000, so the template's preview port is **3000**, not Vite's default 5173 — one process,
   one origin, which is the property SPEC §10.6 actually needs (the roles are swapped: Nitro
   fronts Vite instead of the other way round).

**Fix candidates:** the next Nitro RC bundles the runtime and stops shipping
`dist/node_modules` (nitrojs/nitro #4701, merged but unreleased — the latest npm beta is
still `3.0.260903-beta`), which removes the traced ESM-only copies; the other half is
Vivari's loader honouring the `import`/`module` condition and falling back to `module` when
`main` is missing (upstream). A patch for that half is prepared and validated — Facilis smoke
green with the template pins removed — and is carried by the fork pin (D-030, branch
`fix/runtime-esm-only-targets`) and was filed upstream as PR #19 (merged in `v1.1.5`). The
template's 14-package pin
list is therefore redundant: dropping it and re-running `TEMPLATE=Facilis pnpm ide:smoke` is a
follow-up. Vite's `--configLoader`
does not help: all three modes externalise package imports (the default `bundle` loader
resolves every dependency to a file URL and marks it `external`), so no loader inlines
Nitro's dist, and `bundle` cannot run in the WebContainer anyway.

**Consequences:** the Facilis smoke is green end to end in the WebContainer — preview painted
(~36-40 s cold), `/__facilis/health` ok, `/__facilis/manifest` ok with **zero warnings**
(PGlite opened, migrations + seed + app role applied), `/_openapi.json` carries
`x-db-tables` for `/api/todos`, and an unauthenticated `/api/todos` returns 401. Upstream
work worth filing: the Nitro RC that bundles the runtime (nitrojs/nitro #4701) and Vivari's
`import.meta.resolve` returning a file URL. Client-side HMR through the swapped
Nitro-fronts-Vite arrangement is the first thing to verify in the next phase.

---

### D-025 — The VFS write path is verified in the WebContainer (A8/A9/A10/A12)
**Status:** accepted (2026-10-28, Phase 0 browser spike)

SPEC §14.1 items 4-7 now have a scripted, repeatable proof in
`scripts/dev/smoke-write.mjs` (run by `TEMPLATE=Facilis pnpm ide:smoke`), driving the real
Studio controller through the dev-only `window.__ide` handle:

- **A8 — `vivari.fs.writeFile`.** A kernel write lands in the VFS, shows up in the Explorer
  index and, once opened, in the editor. Saving an edited `src/App.tsx` hot-updates the
  preview **without reloading the preview document** (asserted by comparing
  `contentWindow.performance.timeOrigin` before and after), and writing a server route
  (`server/routes/api/ping.get.ts`) makes the in-VM Nitro handler answer with the new body —
  so the swapped Nitro-fronts-Vite arrangement keeps both HMR and server reload alive.
- **A9 — `vivari.fs.writeFiles`.** The kernel has no batch RPC (one `vv-write` per file), so
  the framework's batch is its own loop: `applyPatch()` (below). The check applies three
  files at once, asserts the files are readable through the VFS, that an unsafe path is
  rejected before any write, that a delete lands, and that editing `locales/en.json` moves
  `/__facilis/manifest/revision` — the write → manifest loop end to end.
- **A10 — isomorphic-git on the VFS.** `git init`, status over the working tree and a commit
  all succeed against the VFS through the existing `ScmSession` (SPEC §14.1 item 6).
- **A12 — reboot.** After a flush, a `Page.reload` restores the VFS from the OPFS mirror: the
  uncommitted probe file is readable again from the reloaded Studio.

**Durability fix found by A12.** `KernelBridge` only flushes the OPFS write-behind buffer on
`pagehide`, which a hidden, frozen or discarded tab may never receive.
`ide/src/vv/vfs-flush.ts` adds the SPEC §13 risk-9 mitigation: flush on
`visibilitychange` (plus `pagehide`), installed by `IdeProvider` because `controller.ts` is
pinned by the file-length ratchet.

**Where `applyPatch()` lives.** SPEC §10.2 names it as an `IdeController` method, but
`controller.ts` cannot grow (ratchet). It is therefore a function in
`ide/src/facilis/apply-patch.ts` taking the controller's bridge and folder root — which is
also what AGENTS.md asks for ("isolate Facilis changes in new modules"). It validates with
`@facilis/ai`'s `validatePatch` before any write (security invariant 9), writes
sequentially through the kernel bridge (SPEC §10.3), and returns the refreshed manifest
revision. The read side is `ide/src/facilis/manifest-client.ts` (SPEC §6), throw-free
so a booting or broken project renders as "unreachable" instead of taking the editor down.

**Consequences:** Phase 0 browser items A8, A9 (as the framework write path), A10 and A12 are
closed with evidence. A11 (PAT modal + WebCrypto-encrypted clone) stays open: the Studio's git
layer is local-only today (SPEC §6.4/§10.4), so remote auth is Phase 2 work, not a missing
spike.

---

### D-026 — Known: Monaco 0.55.1's TS worker throws on "cannot find module" diagnostics
**Status:** accepted as a known upstream defect (2026-10-28); not Phase 2 blocking

The first content change in a JS/TS model makes `ts.worker` compute diagnostics for every
background model. A diagnostic whose module resolution failed carries TS 6.0's
`repopulateInfo` callback; Monaco's `clearFiles()` spreads that diagnostic into the worker
reply, and structured clone rejects the function:

`DataCloneError: Failed to execute 'postMessage' on 'DedicatedWorkerGlobalScope': () => ({
moduleReference, mode, packageName: … }) could not be cloned.`

The Facilis template triggers it because its `tsconfig.json` aliases `"~/*"`, which the
Studio's TS language service does not read (it configures fixed compiler options), so
`"~/db/schema"` is unresolved in the editor. `scripts/dev/smoke-ide.mjs` therefore filters
exactly this error (`/could not be cloned/`) out of its "no page errors" assertion and
records it as `knownPageErrors` in `report.json`. It is an editor/worker defect, not a VFS
one: the write + HMR path is unaffected.

**Follow-up:** load each project's `tsconfig.json` `paths`/`baseUrl` into
`typescriptDefaults` (fixes the alias, and with it most of the noise for Facilis projects),
and/or bump `monaco-editor` once upstream stops spreading non-cloneable diagnostics.

---

### D-027 — `starter/` stays empty until the packages have a publish target
**Status:** accepted (2026-10-28)

SPEC §4 lists a `starter/` template that users clone. Today every Facilis project installs
`@facilis/*` from tarballs the IDE serves on its own origin (D-022), and those URLs are only
reachable from inside the WebContainer. A committed `starter/` tree would declare dependencies
nobody outside the IDE can install — a copy that rots instead of a starter.

The generated tree is the reference app (`examples/todo-app`, D-062) plus the IDE wrappers in
`ide/src/facilis/`, and the IDE template is the only consumer. `starter/` gets created when
O-006 (publish target) is decided and the packages are installable by name; until then the
template payload is the single source of truth.

**Consequences:** the Phase 2 "starter" item is a publish-time task, not a UI one — the same
decision as O-006, not a new one.

---

### D-028 — Known: the OPFS write-behind mirror stops indexing writes after the in-VM install
**Status:** root cause found and fixed (2026-10-28); the fix is carried by the pinned fork
(`facilis/main`, D-030), so A12 passes as a normal check and the harness `knownIssue` path is
only a fallback for an unpinned tree

A12 expects an uncommitted file to survive a reboot through the OPFS mirror. It does not, and
the failure is inside the kernel, not the Studio:

- **The mirror is active.** After a fresh boot the reloaded Studio restores the project tree
  and the package-manager cache from `vv-vfs/` (581 manifest entries; `package.json` reads
  back as 2357 bytes after `Page.reload`), so boot restore itself works.
- **Late writes never reach it.** A `vv-write` succeeds and is readable through the VFS, but
  `vv-vfs/manifest.json` keeps the same 581 entries (sampled before the first write, 2 s
  after it, before the reload and after it) and
  `vv-vfs/files/.../vv-write-probe.txt` does not exist on disk. Nothing is restored because
  nothing was mirrored.
- The queue was never wedged — it was **overloaded, and the index was gated on it emptying**.
  `shouldPersist` excludes `node_modules` but persists the package-manager caches, and a cold
  pnpm install enqueues **8,000–12,000** paths (`~/.local/share/pnpm/store/v3/files/**`,
  `~/.cache/pnpm/metadata-*`) while the drain runs at ~500 entries/s. `drain()` rewrote
  `manifest.json` only once the queue was empty, which under that flood never happened:
  `lastManifestWrite` froze ~20 s in while the in-memory index grew past 3,000, so the on-disk
  manifest stayed at 514 entries and the probe (written later, behind the backlog) was never
  indexed. A reload then restored the stale index. `scripts/dev/smoke-write.mjs` records this
  as a `knownIssue` (with the counts) in `report.json`, so a future fix turns it into a normal
  pass without editing the harness.

The Studio half of the SPEC §13 risk-9 mitigation is in place: `ide/src/vv/vfs-flush.ts`
posts `fs-flush` on `visibilitychange`/`pagehide` and `KernelBridge` already flushes on
`pagehide`. A flush cannot help when the queue is minutes behind.

**Fix (upstream, validated 2026-10-28).** Route package-manager-cache paths to a low-priority
queue that drains only when nothing project-level is queued; rewrite the manifest while the
queue is busy (existing 1 s debounce); and make `flush()` on page-hide promise only the project
paths plus the index, leaving cache work queued. Applied temporarily to the vendored tree, this
turns A12 into a normal pass — 24/24 write checks, zero known issues, the probe survives the
reload. The fix is pinned through the fork (D-030, branch `fix/opfs-mirror-priority`) and was filed
upstream as PR #21. The Studio's writes, editor state, HMR and git are correct in-tab either
way.

---

### D-029 — The facilis.home proxy's HTTP/2 request cap breaks long IDE sessions
**Status:** accepted (2026-10-28) — environment fix, no engine change

Serving the IDE dev server through the `facilis.home` HTTPS reverse proxy made every
generated-project install fail while the same tree on `http://127.0.0.1:<port>` passed. It is not
the certificate, the host alias, the SAB/preview path, pnpm, or the number of concurrent Process
Workers: **the proxy retires its HTTP/2 connection after 1000 requests, and Chromium loses a few
module fetches across that boundary.**

- Measured against the proxy with a bare Node HTTP/2 client: `GOAWAY` on request **#1000**
  exactly (`lastStreamID=1999`, advertised `max_concurrent_streams=100`) — nginx's
  `http2_max_requests` default (folded into `keepalive_requests` from 1.25.1 on), also 1000.
- A dev page session issues **thousands** of module requests: every guest process is a browser
  Worker that loads the runtime's ~190-module graph (the build ships one file per worker, dev
  serves each module separately). ~19 processes ≈ 3,600 requests → 3–4 connection retirements
  per install.
- Reproduced without the real proxy: a loopback HTTP/2 proxy in front of the same Vite server,
  with **only** a `GOAWAY` after 1000 requests added, loses **5 of 19** simultaneous module
  Workers; the identical proxy without that cap loses **0 of 19**. The same 19 through the real
  nginx with `--disable-http2`, or over loopback, lose 0 — HTTP/1.1 has no multiplexed in-flight
  requests to lose when a connection retires, which is why `pnpm ide:smoke` was always green.
- An empty-message `error` from a module Worker means "module graph failed to load"; the kernel
  correctly treats it as a fatal boot failure, so the install dies with
  `worker.js: process worker failed to start` and then `Worker pnpm#4 exited with code 1`.
- Both plausible engine-side workarounds were measured and **rejected**: throttling concurrent
  Process Worker boots (a validated patch capped the burst at three; request volume still crossed
  the boundary, so it only shifted the probability) and capping pnpm's pool from the generated
  template (`PNPM_WORKERS`; same flaw, plus a browser-VM limit in user-visible config). A dev
  cache header for `vendor/vivari/**` does not help either: worker graph fetches do not reuse the
  browser HTTP cache (193/193 requests from a warm Worker).

**Decision:** fix the proxy, not the engine. On the studio vhost raise or disable the
per-connection request cap — `keepalive_requests 100000;` (nginx ≥ 1.25.1) or
`http2_max_requests 100000;` (older) — or serve that vhost over HTTP/1.1 (`http2 off`), which is
a complete workaround for dev. Raising `http2_max_concurrent_streams` (the proxy advertises 100)
also helps the burst. Measurements: 1000 requests per connection, `GOAWAY` on request #1000 — the working notes were
Vivari-side and are not kept in this repo.

**Follow-up (same day):** D-031 removes the request *volume* instead of the cap — the IDE dev
server now runs Vite's full-bundle mode, so a dev session no longer issues thousands of module
requests and the `facilis.home` smoke passes with this proxy unchanged. Raising the cap is still
the right thing for any middleware-mode or otherwise long-lived dev session.

**Consequences:** this issue needs no fork of Vivari and no vendor patch; the IDE behind a
correctly configured proxy behaves like loopback, and bundle mode (D-031) makes it behave from an
unmodified proxy too. HTTP/1.1 remains the workaround for middleware mode until the proxy is
adjusted; the loopback smoke is unaffected either way.

---

### D-030 — Vivari is consumed through our fork, pinned to `facilis/main`
**Status:** accepted (2026-10-28)

The IDE depends on upstream fixes we authored and validated (D-024 ESM-only targets, D-028 OPFS
mirror priority, `import.meta.resolve` returning a path). Keeping them as patch files applied by
hand meant the product, CI and the smoke harness all executed an **unpatched** kernel: every
validation required apply/revert, and the repo's own assertions (A12) stayed a `knownIssue`
against the pinned tag.

**Decision:** `vendor/vivari` is a submodule of **our fork**,
[`github.com/kele23/vivari`](https://github.com/kele23/vivari), pinned to `facilis/main` =
upstream tag `v1.1.4` + the five fix commits and four repository-driven commits (branch map in
the fork's `FORK.md`, inside the submodule). The fork's `master` mirrors upstream and carries
no commits of ours; each fix is also its own branch (`fix/…`) based on upstream `master` and is
proposed upstream as a PR from the fork. `.gitmodules` records the fork URL and
`branch = facilis/main`; the pin is a **commit**, so a checkout is reproducible. The submodule
worktree is never edited, so `git -C vendor/vivari status` is clean by construction.

Workflow (branch map in the fork's `FORK.md`, dev recipe in
[`vendor/README.md`](./vendor/README.md)):

- **bump the engine:** rebase the fix branches onto the new upstream tag in the fork, push
  `facilis/main`, then `git -C vendor/vivari fetch origin && git -C vendor/vivari checkout <sha>`
  and commit the gitlink;
- **upstream release:** `git -C vendor/vivari fetch upstream --tags` (second remote in the same
  clone) and rebase in the fork;
- **fix merged upstream:** drop its commit from `facilis/main`, pin the upstream release that
  carries it, delete the branch;
- **verify a bump:** `pnpm ide:smoke` and `TEMPLATE=Facilis pnpm ide:smoke` (and the
  `facilis.home` proxy smoke in `docs/DEV.md` when the proxy is involved).

**Consequences:** the IDE runs the code this repo asserts — A12 and the OPFS probe pass as
normal checks, no manually applied patches — and the fork is public MIT code linked to upstream,
so CI needs no credentials to clone. What stays invariant: never pin a branch head, never commit
a dirty submodule, and keep `facilis/main` = upstream + exactly the fixes still unmerged
upstream.

---

### D-031 — The IDE dev server runs Vite's full-bundle mode
**Status:** accepted (2026-10-28)

Middleware-mode dev serves every module as its own request. A dev page session of the IDE is
therefore thousands of requests: each guest process is a browser Worker whose first act is
loading the runtime's module graph — ~190 `/@fs/` requests **per spawn** — and an install spawns
~11 of them. That volume, not the engine, is what brings the session into trouble (D-029: the
`facilis.home` proxy retires an HTTP/2 connection every 1000 requests and Chromium loses a few
in-flight fetches across the boundary; the loss kills a worker's graph load and with it the
install). Two measurements pointed the same way: the graph cannot be HTTP-cached from a Worker
(193/193 requests from a warm worker), and throttling concurrent boots only shifted the
probability.

**Decision:** the IDE's `dev` script runs `vite --host --experimentalBundle` (Vite 8's full
bundle mode, `experimental.bundledDev`). Rolldown serves a small set of chunks instead of one
response per module, so the request volume collapses: a process Worker no longer fetches a
190-request graph at all, and a whole dev session stays far below the proxy's per-connection
request cap. `dev:middleware` keeps the old server one command away for debugging Vite-plugin
behaviour (HMR semantics under bundle mode differ — boundaries are computed in the browser, and
`import.meta.hot` calls in dead branches fall back to a full reload; see Vite's
`experimental.bundledDev` note).

**Validation:** `TEMPLATE=Facilis pnpm ide:smoke` through `https://facilis.home/` with the
proxy **unchanged** (still retiring HTTP/2 connections at 1000 requests) is green end to end —
preview painted, framework checks, A8/A9/A10/A12 (the OPFS probe included) — where middleware
mode failed 15 checks on the same proxy. The loopback smoke is green in both modes.

**Consequences:** the IDE no longer depends on the dev proxy being configured for long
connections (raising the request cap in D-029 is still recommended for other reasons, but it is
no longer on the critical path); production builds were already bundled, so this only brings dev
in line with what ships. The cost is a bundling pass on the dev server (one ~1.3 MB chunk on
first request instead of hundreds of small ones) and Vite's experimental HMR semantics;
`dev:middleware` is the escape hatch if a Vite plugin misbehaves in bundle mode.

### D-032 — npm is the package manager of a generated Facilis project
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
- **The URL dependency was never necessary.** The four `@facilis/*` tarballs are static files
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

**Consequences:** npm is the one package manager whose distribution cannot go native — it is
the manager Node ships with, and it has been a pure-JS tree its whole life — so "aligned with
Node" becomes a maintenance routine we own (bump the version, rebuild the pack, re-run the two
smokes; the vendoring patch to Arborist's `#loadPeerSet` is the only coupling, and it fails
loudly when npm refactors it). pnpm remains in the VM only as the tool rolldown invokes for
its wasm binding inside a Vite 8 project (`pnpm i @rolldown/binding-wasm32-wasi`): pinned,
internal, and carrying no version promise. The `@facilis/*` `file:` specs are interim —
when the packages are published (O-006) the dependency specs change and nothing else does.


**Follow-up (2026-10-29, same day): npm re-derives a RELATIVE `file:` target, and that broke
installs.** The first generated projects failed with
`npm warn tarball ... @facilis/auth@file:../../../../user/projects/<name>/vendor/...` and then
`ENOENT /user/projects/<name>/vendor/...`: the `package.json` on disk was correct
(`file:./vendor/...`) and `path.resolve` inside the VM was correct, but npm normalizes a
relative `file:` dependency by storing `file:` + `path.relative(where, resolvedPath)`
(`npm-package-arg`) and reading that back — in that environment the re-derived target lost
`/home` and every install retried a file that exists. The project's specs are now **resolved
before npm runs**: `scripts/vendor-paths.cjs` rewrites the four `@facilis/*` dependencies to
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
---

### D-033 — Several projects at once: one project per browser tab
**Status:** accepted (2026-10-29)

The last engine-level gap for an IDE people can live in: two projects side by side. A browser
tab is the unit — the same project in two tabs is refused, different projects each get their own
tab, kernel, dev server and preview.

**Measured (2026-10-29, one React project + one Vue project, two tabs on one origin).** Two
kernels coexist with no engine change: each tab boots its own VM (the second tab's
`kernel-online` is +2.5-2.9 s because it restores the shared tree), each dev server binds 5173
in its own VM, and the pair costs ~355 MB + ~362 MB of JavaScript/worker memory (~0.7 GB), against
an 11 GB storage quota (308 MB OPFS, shared by both). The constraint was never "can two kernels
run": it was two pieces of per-origin state written as if one kernel existed.

- **Preview routing was per origin, not per kernel.** The Service Worker picked "the window that
  hosts a kernel" and posted every `/preview/<port>/` request there. Both tabs announce
  themselves, both run a server on 5173, and the second tab to boot won the lookup: measured, a
  `fetch('/preview/5173/')` from tab A returned tab B's app, and reloading tab A's preview
  painted tab B's project. Fixed in `sw.js` (upstream #23, released in v1.1.5): a navigation is
  attributed to the window that started it (`event.clientId`) and the frame it creates is
  recorded under `event.resultingClientId`, so every later subresource of that frame goes back to
  the same kernel. The follow-up measured the assumption Chrome 156 breaks: a frame's *first*
  navigation carries an **empty** `clientId`, so the bridge now puts its per-boot kernel token in
  same-origin preview URLs (`__vv_kernel`), the SW records the resulting frame against that tab
  and redirects the token away (`resultingClientId` survives the redirect), and the routing maps
  are pruned of clients that are gone. keep-prefix ports became per kernel
  (`keepPrefixByClient`) and ws/SSE tunnel frames are scoped to the kernel's own preview windows.
- **The OPFS mirror's index was rewritten from one kernel's memory.**
  `vv-vfs/manifest.json` is per origin; each tab wrote the whole index from the paths it happened
  to know. Measured: with both tabs running, one write in tab A dropped every one of tab B's paths
  from the index (`beta` entries 10 → 0) and reloading tab B lost the project (`vv-stat` →
  does not exist). Fixed in `opfs-persistence.js` (upstream #22, released in v1.1.5): the index
  write is a read-merge-write of *this kernel's* changed paths under a `vv-vfs-manifest` Web Lock,
  so two tabs cannot interleave it. The follow-up closed two gaps the test exposed: the batch of
  changed paths is taken before the write's first `await` (a path recorded mid-write was lost for
  good), and `restore()` reads the index under the same lock (a sync access handle held by a
  booting tab could make another tab's `move()` and its copy fallback both fail). Our
  `hydrate()` takes the lock too.

**Decision:** tabs are the unit of work, and the Studio enforces one project per tab.

- Each open workspace folder is claimed with a Web Lock (`facilis-project:<rootPath>`), released
  when the folder closes or the document goes away. A folder already claimed by another live tab
  is closed again and a toast says why — two RAM copies of one project would diverge and then
  mirror over each other.
- A tab opened from another one carries `?project=<rootPath>`: on boot it opens **and runs** that
  project, so F5 lands back on it instead of Home. The parameter is dropped when the tab loses its
  project; a tab that started on Home stays parameterless.
- "Open in a new tab" is on each Home recent-project row, and the title bar gains a "New tab"
  button (Home in a fresh tab, other boot params such as `?net=` preserved).
- The browser title names the project (`alpha — Vivari Studio`), so tabs are distinguishable.

**Deliberately not done:** per-project OPFS namespaces. Partitioning the store by project would
cut the second tab's restore time and memory, but it makes the project→store mapping a *boot*
parameter, which rewrites the Home → open flow, the create flow and the multi-root workspace — a
large refactor for a feature that already fits. The shared tree costs one restore per tab
(measured 2.5-2.9 s for the two-project tree) and one RAM copy per tab; revisit only if that grows
with real projects.

**Known limitation:** two tabs installing at the same time can lose one snapshot entry in the
dependency cache's own index (the blob stays on disk, the index entry does not). The next install
of that project re-creates it: wasted bytes, not corruption. The VFS mirror is not affected.
Acceptance: `pnpm ide:smoke:multitab` (D-033's four properties), the two existing smokes
(unchanged), and the fork pins.

**Amended 2026-10-30 (D-035):** the tab unit is now strict — a tab holds exactly one project
root (opening another replaces it), and the label is the workspace folder's name, not a stored
title.

---

### D-034 — One config file: `facilis.config.ts` owns Nitro options, and `facilis()` mounts Nitro
**Status:** accepted (2026-10-29)

A project carried two config files for one runtime: `facilis.config.ts` for the framework and a
`nitro.config.ts` that every generated project copied — `serverDir: "./server"` and
`experimental.openAPI: true` — plus a `vite.config.ts` that imported `nitro()` itself. That is
two committed files expressing framework defaults, and a registration order for a user to get
wrong (SPEC §13 risk 12).

**Decision:** a Facilis project has **one** config file, `facilis.config.ts`, and never names
Nitro in `vite.config.ts`.

- `facilis.config.ts` gains an optional **`nitro`** section: pass-through Nitro options, which
  `@facilis/core` validates only as an object (`FacilisNitroOptions =
  Readonly<Record<string, unknown>>`) because they are Nitro's options, not the framework's. A
  project declares only what it overrides.
- Facilis applies the framework defaults underneath — `serverDir: "./server"` and
  `experimental.openAPI: true` — in `@facilis/nitro`'s `mergeNitroOptions`, deep-merged for
  plain objects (so `experimental: { openAPI: false }` flips that switch and keeps the rest of
  the block).
- `facilis()` from `@facilis/nitro/vite` **mounts Nitro itself**: it returns
  `FacilisPlugins = [FacilisVitePlugin, ...Plugin[]]` — the Facilis plugin first
  (`name: "facilis"`, `enforce: "pre"`, carrying the Nitro module on its `nitro` key),
  followed by `nitro()`'s plugins.
- The Facilis plugin's Vite `config` hook loads `<root>/facilis.config.ts` with a native
  dynamic import and returns `{ nitro: mergeNitroOptions(config.nitro) }`. `enforce: "pre"`
  makes its config hook run before Nitro's, so Nitro boots with those options and the order
  inside the user's `plugins` array cannot matter.
- `@facilis/nitro` value-imports `nitro/vite`, so `nitro` is a **required** peer dependency
  (`vite` stays optional: only the `/vite` entry needs it).

**Consequences:** the generated project, the starter and `examples/todo-app` ship no
`nitro.config.ts` and no `nitro` import; their plugins are `[facilis(), react()]`. The IDE's
generated template keeps `nitro: { devServer: { runner: "self" } }` in `facilis.config.ts`
because Nitro's default node-worker runner needs `worker_threads` and a file-URL
`import.meta.resolve`, neither available in the WebContainer — an environment constraint, not
a framework default (D-024). A project that still keeps a `nitro.config.ts` keeps working:
Nitro's own c12 loader reads it, but `facilis.config.ts` wins; new projects never create one.
The template's `package.json` also pins `@types/react` / `@types/react-dom` 19.3.0, because
the IDE's Monaco TypeScript service only knows installed `@types/*.d.ts` — the report that
started this pass was TS2307 "Cannot find module 'react'".

**Why:** Nuxt parity — one committed config — and framework defaults belong in framework code,
not copied into every project. `vite.config.ts` stops naming Nitro at all.

**Alternatives rejected:** requiring `facilis(config)` with `import config from
"./facilis.config"` (still two references in the Vite config, plus a cast for untyped Nitro
options); an async `facilis()` that returns a plugin promise (works, but keeps config loading
on a less-tested Vite path).

**Verified:** a `resolveConfig` probe showed the pre-plugin `config` hook's `nitro` key
reaching Nitro's `setupNitroContext` (server directory resolved, `experimental.openAPI` true),
with `nitro()` listed before or after `facilis()`.

---

### D-035 — A project is its directory: one folder per tab, the folder name is the label
**Status:** accepted (2026-10-30)

The Studio inherited Vivari's multi-root workspace, and the IDE inherited its label from
whichever name/title happened to be at hand. Two consequences, both measured by the user:

- `openFolder()` **appended** a root instead of replacing it, so opening a second project added
  it to the same Explorer: one tab showed two projects at once, while the Web Lock, the run
  phase and the browser title still described "the" project.
- The label was a **stored or separate name** — the create-form name, the kernel manifest's
  title, the registry's stored name — none of which is the directory. Measured:
  `/home/user/projects/facilis-ts-appx` displayed as `facilis-ts-app`, indistinguishable from
  the project already open, because the label and the folder could drift.

**Decision:** the directory is the project. A tab holds **one** workspace folder and the label
is that folder's name:

- `openFolder()` closes the tab's other roots first; the editor tabs/models/index and the
  project's Web Lock follow the folder. Opening another project *replaces* the project in that
  tab; "Open in a new tab" is how two projects are worked on at once.
- `?project=<rootPath>`, the browser title, the Web Lock, the run phase and the Explorer all
  describe that one project.
- `projectName(rootPath)` (the last path segment) is the **only** label source: the Explorer
  root, the title bar, the browser title and Home's recent rows all derive from it.
  `WorkspaceFolder.name` and `snap.projectTitle` are derived, not authored.
- `ProjectMeta` no longer stores a name: it is
  `{ rootPath, template, createdAt, lastModified }`, and a legacy registry entry's `name` is
  ignored on read.
- The create dialog's project-name field only seeds the default directory; the project's
  label, the kernel's project title, and a blank project's `package.json`/`README` use the
  folder name.

**Consequences:** a tab cannot show two roots, and a project cannot be mislabelled by a stale
title or a name typed at creation. Home's recent-projects registry is per origin, so it stays a
read-merge-write (D-033): a tab must merge its own paths, never rewrite the whole list.
Acceptance: `pnpm ide:smoke:multitab` asserts one root and the directory label; the two
existing smokes stay green.

---

### D-036 — A project is restored when a tab opens it, not at boot
**Status:** accepted (2026-10-30)

The OPFS mirror survives reloads, but its manifest is the index of the whole **origin**: every
project, plus the package-manager caches. Booting a tab replayed all of it into that tab's VFS,
so a tab carried every project on the origin — RAM and restore time for projects it never opens
(a second tab paid it again). The manifest is shared and is what lets cross-tab writes merge, so
per-project OPFS namespaces (considered in D-033) are the wrong tool: what is needed is a
**scope** on the replay.

**Decision:** the boot restore is scoped, and a project is materialized when it is opened.

- The IDE passes Home's known roots as `BootOptions.deferRestoreRoots` (fork commit
  `3376ba1`). The FS worker reads the manifest but leaves those subtrees on OPFS: they stay in
  the shared index — so this tab's writes and deletes, and the cross-tab merge, keep working for
  them — but they are not in the VFS.
- Opening a project (`IdeController.openProject`) asks the kernel for `vv-restore-roots`
  before it stats/opens the folder; the kernel replays exactly that subtree (dirs shallow→deep,
  files, symlinks) and answers once the files are readable. Nothing outside the requested roots
  is materialized, so a project the tab never opens is never carried.
- The hydration re-reads the manifest, so a project another tab created after this kernel booted
  opens without a reload; a brief retry covers that tab's write-behind mirror not having reached
  OPFS yet, instead of dropping the project from Home as "no longer on disk".
- A project stays in the VFS once opened (closing a folder does not unload it): unloading would
  have to tell mirrored from unsaved state apart, and it is not needed for the boot win.

**Consequences:** boot cost and VFS footprint scale with the projects a tab opens, not with the
origin. Measured on a fresh four-template origin (40 manifest entries, 32 project files): a
reload replays 4 entries instead of 40 (VFS 28 seed files instead of 60) and reaches
`kernel-online` in 671 ms; opening one project replays its 9 entries in 135 ms end to end
(`openProject`, folder indexing included). Package-manager caches were the next step — they are
the bulk of a real origin (830 of 873 entries in the multi-tab smoke origin) and are now deferred
per file on first read (D-037). Unknown roots are not deferred (restored at boot as before), so a
stale or missing registry entry costs at most one boot, never data.
Acceptance: `pnpm ide:smoke:multitab` asserts both directions — a reloaded tab restores the
project it opens, with its real contents, and does not carry a project it never opened.

---

### D-037 — Package-manager cache bodies are replayed on first read, not at boot
**Status:** accepted (2026-10-30)

D-036 scoped the boot restore to the projects a tab opens; the package-manager caches were left
eager, and they are the bulk of the mirror. Measured on the multi-tab smoke origin (two
projects): 829 of 873 index entries are npm's cache — 415 files, 147 MB — and replaying them
accounted for essentially all of the 4.0 s boot and the 42 MB compressed Wasm footprint. They
are shared by every project on the origin, so an eager replay makes a tab carry the cache of
projects it may never install.

**Decision:** the boot pass materializes the cache **directories** (an inode is free, and a cache
directory must list and stat normally) and leaves the cache **file bodies** on OPFS. The FS
worker replays one body the first time a syscall observes its bytes, before the syscall runs
(`FsServer.beforeRequest`), so the caller's synchronous read contract is untouched. The rules
are explicit in `installDeferredHydration` (`vendor/vivari/.../fs-worker.ts`):

- replay on `read_file`, `open` (read, read+write, append), `stat`/`lstat`, `link` source,
  `rename` source, `chmod`/`utimes`;
- a truncating write (`O_WRONLY|O_TRUNC`) does **not** replay: it replaces the bytes;
- `unlink`/`rmdir` **drop** the OPFS copy instead of replaying it (cacache's `rm`), and the index
  records the delete;
- `exists` is answered from the mirror's index (it is a probe, not a read);
- `readdir` merges the deferred names, so a cache directory lists what the mirror holds;
- a write/delete/rename invalidates the deferred entry, and a replay that loses that race is
  discarded instead of writing stale bytes back; a cross-tab write is seen, because the replay
  reads the current OPFS bytes.

**Why not the alternatives:** loading the whole cache at the first package-manager spawn still
carries every project's cache; per-project cache namespaces would break the content-addressed
dedupe the caches rely on; a size column in the manifest (to answer `stat` without bytes) was
considered and is not needed — in npm/pnpm's warm-install paths a `stat` of a cache blob is
always followed by its read (cacache `content.read`), so replay-on-stat costs nothing extra.

**Consequences:** a tab pays for the cache entries its own installs read, and nothing else.
Measured on a fresh origin (one react install, 297 cache files): cold install 27.9 s; a reload
with the cache deferred boots in 1.16 s carrying 27 MB of VFS (127 MB with the cache resident);
a later `rm -rf node_modules && npm install` takes 8.5 s and replays **73 of the 297** cache
files (deferred 297 → 224, +22 MB), leaving the other 224 on OPFS. A project whose
`node_modules` comes from the dependency cache reads no package cache at all. Hydrated bodies
stay in the tab's VFS once read (no eviction), so the tab carries exactly the blobs its installs
used.
Acceptance: `pnpm ide:smoke:multitab` (cache stays deferred on an idle tab, only the requested
file is replayed, a reloaded project still restores) and `TEMPLATE=Facilis pnpm ide:smoke`
(reboot, framework contract, write/git paths), plus the root gates.

---

### D-038 — Session cookies are staged on the event's response headers, not on a returned `Response`
**Status:** accepted (2026-10-30)

Wiring the Facilis probe to a real database roundtrip — register, log in, insert a todo, read
it back — found a lost header. The login route returned `jsonResponse(..., { "Set-Cookie":
sessionCookie(...) })`, the shape the reference app had: the browser saw **200** with the JSON
body, so nothing looked wrong, and the next request arrived with **no `Cookie` header at all**
(`/api/auth/session` reported `{ authenticated: false, cookiePresent: false }`). The preview's
cookie jar was not the cause — the fork's `spike-cookie-session.mjs` proves the kernel attaches
and harvests cookies for a plain `node:http` session server — so the header was lost before the
jar saw it. Measured in the WebContainer: a `Set-Cookie` carried on a `Response` a route returns
does not survive this Nitro dev path, while a header staged on the event is merged into the
final response by h3 itself and does.

**Decision:** routes set or clear cookies with the framework's `setSessionCookie` /
`clearSessionCookie` helpers (`@facilis/nitro/session`), which call h3's `setCookie` /
`deleteCookie`. h3 serialises the attributes and writes them to the event's response headers —
the same surface the first fix's manual `set("set-cookie", …)` used, but with append semantics
(a cookie another handler staged on that response is not clobbered) and one attribute set
(`HttpOnly`, `Path=/`, `SameSite=Lax`, `Secure` in production) for every app. A route returns a
plain body. The reference app's login and logout use those helpers, and the probe proves the
whole chain: the session survives to the next request, the insert runs as the logged-in user,
and the list reads the row back.

Hand-rolling the `Set-Cookie` string was the wrong level: h3 already owns cookie serialisation
and the append rule, and the framework helper is where the h3 import belongs. It is a separate
entry point (`@facilis/nitro/session`) because core's route contract is h3-free (contracts §4.1):
the single `FacilisRequestEvent` → `H3Event` narrowing lives in the helper, so handlers and
generated apps never import h3.

**Consequences:** any Facilis app sets cookies through `@facilis/nitro/session`, never through a
returned `Response` — a route returning its own `Response` with `Set-Cookie` looks successful and
logs the user out on the next request in the WebContainer. Acceptance:
`TEMPLATE=Facilis pnpm ide:smoke` asserts the session, the insert and the query
(`facilisAuth`/`facilisDbInsert`/`facilisDbQuery`).

---
### D-039 — PGlite is loaded from its CJS build, never its ESM build
**Status:** accepted (2026-10-31)

Opening a preview in the IDE killed the whole database: `/api/auth/session` answered
`{"code":"db_unavailable"}`, the probe's insert and query failed the same way, and the in-VM dev
server printed

```
ENOENT: no such file or directory, open
  '/user/projects/facilis-ts-app2/node_modules/@electric-sql/pglite/dist/pglite.data'
```

— the path had lost its `/home`. PGlite finds `pglite.wasm`/`pglite.data` next to its own module;
its ESM build does that with `new URL('./pglite.data', import.meta.url)`, and the in-VM loader
synthesises `import.meta.url` from the module id it was handed. A non-absolute id turns
`"file://" + id` into `file://home/…`, where the first path segment parses as the URL **host**:
`fileURLToPath` then yields `/user/projects/…`, outside the tree. Its CJS build resolves the
same artifacts from `__filename`, which stays an absolute VFS path.

**Decision:** `@facilis/db` loads `@electric-sql/pglite` through `createRequire` — the CJS build
— instead of an ESM `import` (resolved from this module's URL first, the project root second).
That is also the vendor's documented in-VM rule (`vendor/vivari/AGENTS.md`, "In-VM databases"):
PGlite must be required via its CJS build.

**Update (2026-10-31, pin `97d90ab`):** the vendor fixed the URL construction itself —
`9184ee5` builds `import.meta.url` from an absolute module id and `fileURLToPath` now throws
Node's `ERR_INVALID_FILE_URL_HOST` instead of silently converting a hostful URL (fork issue
[#1](https://github.com/kele23/vivari/issues/1), upstream PR #31) — so the malformed URL can no
longer be produced. The CJS load stays: the in-VM database rule has a second, independent reason,
"only the ENTRY module can block on top-level await in-VM", so an ESM import of a TLA-bearing
dependency from a non-entry module can hang.

**Update (2026-10-31, pin `e654919`):** a hostful `file:` URL is no longer fatal either: the
runtime's `fileURLToPath` (and `Bun.fileURLToPath`) now converts `file://home/…` back to
`/home/…` instead of throwing, because a browser can promote the first path segment of
`"file:" + path` to the host (Chromium on Windows) — see D-041. The CJS load stays, for the two
reasons above.

**Consequences:** the database no longer depends on a well-formed `import.meta.url` in the
server bundle, so a rewritten or relative module id cannot take it down; the ESM build stays
unused. Acceptance: `pnpm test` (db), the root gates, and `TEMPLATE=Facilis pnpm ide:smoke` with
`facilisAuth`/`facilisDbInsert`/`facilisDbQuery` = ok (57/57 verified).


### D-040 — The tenant is the deployment's, and the database default fills it
**Status:** accepted (2026-10-31)

Phase 1 serves one tenant per deployment (O-003), yet the tenant reached the RLS GUC through the
session: `AuthContext.tenantId` came from the user row, and every tenant-scoped insert had to name
`tenantId: auth.tenantId` by hand. The tenant was implicit twice — in application code (the insert)
and in the auth object (a per-user value driving a per-deployment scope). A tenant column apps must
remember to fill will eventually be forgotten; a scope that inherits a row value is surface for a
value the deployment does not own.

**Decision:** the tenant is the deployment's, in exactly two places and nowhere else.

1. **Scope.** `defineAuthorizedHandler` always sets `app.tenant_id` to `facilis.defaultTenantId`
   (`FACILIS_TENANT_ID`, else `DEFAULT_TENANT_ID`) for anonymous and authenticated requests alike.
   `AuthContext` carries no `tenantId`, and `sessionMiddleware` refuses a session whose user row
   names another tenant, so no session, request or row value can widen or change the scope.
2. **Storage.** `@facilis/db` exports `tenantColumn()` — a `uuid` `NOT NULL` column whose
   `DEFAULT` is `nullif(current_setting('app.tenant_id', true), '')::uuid`, exactly the expression
   the RLS policies read. A scoped table declares `tenantId: tenantColumn()`; inserts do not name
   the tenant at all (Drizzle marks defaulted columns optional in its insert type), and the
   RESTRICTIVE tenant policy still rejects a row written for another tenant. Anonymous
   registration gets the deployment tenant the same way, so the `tenantIdFromEnv()` helper
   disappears from generated apps.

**Consequences:** one tenant source (deployment config) and one enforcement point (RLS); the
insert path is automatic and typed, and `ownerId` stays explicit because an owner is not always
the writer. A missing or cleared scope yields `NULL` and a loud `NOT NULL` violation instead of a
guessed tenant, and an unscoped or cross-tenant insert stays `42501`. Existing generated projects
need recreating (their DB has no column default, as with D-032's tarballs); the example and the
template ship the `ALTER COLUMN … SET DEFAULT` migration generated by drizzle-kit. Multi-tenant
stays a deployment-level decision: a future multi-tenant product resolves the tenant per request
(host/subdomain) before the handlers and keeps this contract — the GUC and the column default do
not change. Acceptance: `pnpm test` (db/auth/core/nitro), `pnpm typecheck`, and
`TEMPLATE=Facilis pnpm ide:smoke` with the insert no longer naming the tenant.

---
### D-041 — A hostful `file:` URL is recovered in the engine's `fileURLToPath`, not worked around downstream
**Status:** resolved (2026-10-31) — fixed by the pin `e654919`

`TEMPLATE=Facilis` was green everywhere except one reporter's browser, where every project's
database died at dev-server boot:

```
TypeError: File URL host must be "localhost" or empty on posix
  [diagnostic: file://home/user/projects/x/node_modules/@electric-sql/pglite/dist/pglite.data]
```

The module id was correct: the loader compiled PGlite from
`/home/user/projects/x/node_modules/@electric-sql/pglite/dist/index.cjs` and `__filename` was
that absolute path (probed in the VM: `[pglite-probe] "/home/…/index.cjs" "file://home/…/index.cjs"`).
PGlite's CJS build locates its artifacts with `new URL("file:" + __filename)` — i.e. `file:/home/…`.
Node and Chromium on POSIX read that as an empty-host file URL (`file:///home/…`). **Chromium's
file-URL parser is platform-dependent** (`url/url_parse_file.cc`: on WIN32 anything that is not a
drive spec and does not have exactly three slashes is parsed as a UNC path, so the first path
segment becomes the **host**), so on Windows the URL is `file://home/…` with pathname
`/user/…`, and the fork's strict `fileURLToPath` (D-039) refuses it, loudly.

**Interim decision (2026-10-31, removed):** `@facilis/db` read the three artifacts beside the
resolved CJS entry (an absolute VFS path, no URL parsing) and passed them to PGlite:
`fsBundle` (the `pglite.data` bytes as a `Blob`), `pgliteWasmModule` and
`initdbWasmModule` (`WebAssembly.Module`), so the database no longer depended on how a
browser parses a `file:` URL. That could not be the end state: PGlite's Emscripten glue calls
`require("url").fileURLToPath(A)` during its own init, **before any option is consulted**, so
the boot still died in the runtime — and every other userland `"file:" + __filename` idiom in
the VM would die the same way.

**Update (2026-10-31, confirmed):** the platform dependence is in Chromium itself, not in the
browser version: Chrome `156.0.0.0` on Windows parses `new URL("file:/home/user/x")` as
`file://home/user/x`, the same version on Linux as `file:///home/user/x` (Node 24 agrees with
Linux). Chromium's `url/url_parse_file.cc` documents the WIN32 branch — "Anything not beginning
with a drive spec (\"c:\\\") on Windows is treated as UNC, with the exception of three slashes
which always means a file" — while the POSIX branch only gives a host to exactly two slashes.
The same parser also turns a relative module id into a host, i.e. D-039 is platform-specific
on Windows, and upstream's lenient `fileURLToPath` would silently return `/user/…` there.

**Decision:** the fix belongs in the runtime's `fileURLToPath`, because a host in a `file:`
URL of this VFS can only be the first path segment a browser's parser promoted; a host cannot
mean a file host. The fork's `e654919` (**kele23/vivari#2**, the issue carries the Chromium
evidence) recovers `"/" + hostname + pathname`, with no join for a bare `/` pathname
(`file:/home` parses as host `home` + pathname `/`, and the intended path is `/home`, not
`/home/`), in `packages/runtime/node/internal/url.js` and `Bun.fileURLToPath` — plus
`Bun.file(URL)`, which now shares the rule through `createBunFile` instead of stripping a
`file://` prefix into a relative path. Three-slash URLs, `localhost` and the non-file-scheme
error are unchanged; the one deliberate deviation from Node is that a real UNC URL maps to
`/server/share` instead of throwing. With that pin, `@facilis/db` is back to the plain
constructor (`new PGlite({ dataDir })`): the artifact hand-off and the one-boot recovery shim
are deleted, and the database locates its own `.data`/`.wasm` again.

**Consequences:** DB boot is independent of the browser's URL parser *and* of any downstream
shim, and the fix covers every hostful `file:` URL in the VM (PGlite, any other Emscripten
module, `Bun.file`), where the shim covered one boot of one library. Acceptance: `pnpm test`
(db), the gates, and `TEMPLATE=Facilis pnpm ide:smoke` with
`facilisDbInsert`/`facilisDbQuery` = ok; a project created before the bump keeps working,
because the runtime — not the `@facilis/db` tarball — carries the fix.

### D-042 — The controller is a facade; each subsystem is a session object
**Status:** accepted (2026-10-31)

`IdeController` (`ide/src/vv/controller.ts`) is the pinned file D-019's ratchet lets only shrink,
yet every new Studio panel would otherwise edit it. The split follows the shape upstream already
uses for `DebugSession`/`ScmSession`: a self-contained subsystem is a class that owns its state
and talks to the controller through a small host interface (`SearchHost`, `PreviewHost`,
`PreviewView`), while the controller keeps the single snapshot store, the project/port bookkeeping
and the status bar.

Rules that keep each step mechanical and reviewable: one subsystem per commit; the public call
sites stay the same (thin delegations, or `c.preview.<method>()` in the panels); logic that can be
tested without a browser moves to a helper module with a vitest file (`preview-url.ts`); the
ratchet entry is lowered in the same commit. Done so far: language/path helpers,
`memory-probe.ts`, `file-tree.ts`, `search-session.ts`, `preview-session.ts` +
`preview-devtools.ts`, `terminal-session.ts` + `terminal-theme.ts`, `project-export.ts` +
`project-import.ts` (with `synthesizeManifest` unit-tested), the editor language layer
(`editor-language.ts`, `editor-deps.ts`, `editor-python.ts`) and the editor session
(`editor-session.ts`: Monaco mount, status readouts, actions). Still to extract: the editor
model/tab layer, the project open/run lifecycle and Explorer file operations.

**Consequences:** a new panel calls a session (`c.preview.addPreviewTab()`) instead of growing the
controller, and the baseline entry keeps ratcheting down (4,294 → 2,518 lines so far). The split
is not a behaviour change: it is guarded by the same smoke suite (`pnpm ide:smoke`, the React
template and multitab) plus `preview-url.test.ts` for the pure preview helpers.

### D-043 — IDE UI: every string goes through `t()`, every surface works in both themes
**Status:** accepted (2026-10-31)

The Studio is a product surface, not a demo: its chrome has to be translatable and readable
in either theme from the first panel we ship. Both rules therefore apply to **everything this
project adds or touches**, and the upstream-inherited chrome is retrofitted file by file (the
checklist lives in `ide/I18N.md`).

**Strings.** Every user-facing string in `ide/` goes through `t()` from `ide/src/i18n`, with
its text in `ide/src/i18n/en.ts` and (where translated) `ide/src/i18n/it.ts`. The runtime is the
framework's own i18n (`@facilis/core/i18n`: flat keys per O-001, `{placeholder}` interpolation, a
missing key returns the key and is reported once) — the IDE imports that **subpath** so the
static SPA bundle does not pull the framework's zod/db modules. `it` may be partial: at boot
`registerCatalog("it", { ...en, ...it })` makes a missing translation fall back to English key
by key. The locale is the saved choice, else the browser language, else English; the catalogues
are registered and the locale applied by `initI18n()` before the first render, and
`document.documentElement.lang` follows.

**Themes.** next-themes drives the `.dark` class (`attribute="class"`); every surface uses the
semantic tokens (`bg-background`, `bg-sidebar`, `bg-card`, `bg-accent`, `text-foreground`,
`text-muted-foreground`, `border-border`, …) so one class flips the window. Raw palette colours
are reserved for brand marks (SVG logos, the VS Code-blue status bar) and scrims, each with a
comment. The theme is user-selectable from the command palette (Light / Dark / System); Monaco and
xterm are not CSS-themed, so `applyUiTheme()` mirrors the resolved theme into them.

**Verification.** `ide/src/i18n/i18n.test.ts` enforces catalogue parity (no unknown key, no empty
value, every `{placeholder}` preserved in translation) and the locale detection/interpolation
behaviour; the smoke suite continues to run the real UI in a browser.

**Consequences:** a new panel cannot merge with a hardcoded label or a light-only surface; adding
a language is a catalogue file plus one entry in `LOCALES`; and the retrofit is a visible,
incremental checklist instead of an open-ended debt.

### D-044 — Themes are complete variable sets; components only name roles
**Status:** accepted (2026-10-31)

D-043 required every surface to work in both themes; leaving that to `dark:` pairs per element
made each new theme a cross-component edit. The Studio therefore adopts the daisyUI-style split:
**a theme is one block of role values; a component only names roles.** Adding a theme means a new
`[data-theme="…"]` block in `ide/src/index.css` plus one entry in `ide/src/ui-themes.ts` — not a
component change.

**The roles** (each defined once per theme block, mapped into Tailwind via `@theme inline`):
the shadcn set already in use (`background/foreground`, `card`, `popover`, `primary`,
`secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `sidebar-*),
plus the IDE chrome roles this decision adds — `chrome`/`chrome-foreground` (tab strips,
toolbars), `editor`/`editor-foreground` (editor pane), `panel`/`panel-foreground` (terminal,
preview body), `overlay` (DevTools surface), `brand`/`brand-foreground` (status bar, active-tab
marker), `checker` (transparent-image checkerboard), and the status roles
`info`, `success`, `warning` (+ their `-foreground`). Except for brand marks (SVG logos in
`templateIcons.tsx`) and scrims (`bg-black/10` on dialogs), no component may contain a hex or a
raw palette class; the smoke run catches CSS parse/utility errors, and review catches a stray
literal.

**Mechanism.** next-themes writes `data-theme="facilis-light|facilis-dark"` on `<html>`
(`attribute="data-theme"`; the pre-paint script in `ide/index.html` applies it before first paint).
The Tailwind `dark` variant is bound to that attribute, `color-scheme` is declared in each block,
and `ui-themes.ts` maps a theme name to its attribute and to the appearance Monaco/xterm follow
(`appearanceOf`). xterm's base colours read `--panel`/`--panel-foreground` at apply time, so the
terminal follows a new theme too; its ANSI palette remains a per-appearance resource.

**Consequences:** a future theme (e.g. a midnight or high-contrast variant) is a CSS block + one
registry entry + a palette row; both the current themes are visually unchanged because the new
roles were initialized with the values that used to be hardcoded per component.

### D-045 — The AI chat is BYO-key, direct from the browser, with provider presets
**Status:** accepted (2026-10-31)

The Studio needs its AI chat (SPEC §10.2, Phase 4). The spec fixes the shape — the user's own
key, requests going straight from the browser to the provider, no Facilis inference bill — but
not the provider surface, where the key lives, or how the panel is wired into an imperative
controller.

**Providers.** `ide/src/ai/providers.ts` describes two wire protocols (OpenAI-compatible
`/chat/completions` SSE and Anthropic `/v1/messages` SSE) and gives each a preset: Anthropic,
OpenAI, OpenRouter, DeepSeek and Custom (any OpenAI-compatible base URL, so a local or proxied
endpoint works). A model name is free text with an editable per-preset default, and switching
provider clears the key field: a key is provider-specific and must never be sent to another
host by accident. O-007 is resolved by this: no single model is enforced; the presets document
what was tested.

**The key** is stored in `localStorage` (`vv-ai-settings`, per origin like the git identity and
the recent-projects registry), never in the repository, never in the VFS, never in a prompt,
and never anywhere except the chosen provider's own auth header. It is not encrypted at rest:
a key the panel must re-read at every boot can only be obfuscated by keeping its own
decryption secret beside it. PATs, which are read rarely and can prompt, get real encryption
when Phase 2 adds git auth. `ChatSettingsDialog` says where the key lives and the provider
hint says where to create it.

**Direct calls have one consequence:** the provider must allow browser origins. OpenRouter and
Anthropic (with `anthropic-dangerous-direct-browser-access: true`) do; a provider that does not
surfaces as the network-error card, which names CORS, and Custom is the escape hatch (local
server or own proxy). No Facilis server is introduced — SPEC §3 keeps the Studio a static SPA.

**Wiring.** `ChatSession` (`ide/src/ai/chat-session.ts`) owns the conversation and talks to the
editor through `ChatHost` (`files`, `read`, `activeFile`, `manifestBase`, `openFile`, `bridge`)
and to the model through an injected `call`, so the session is unit-tested with a fake host and
fake answers. `chat-host.ts` builds the host from `IdeController` and keeps one session per
controller in a WeakMap, so switching sidebar views keeps the conversation. The React surface is
a new activity view (`activeView: "chat"`), `ChatPanel` plus three small views, and a command
palette entry.

**Dev-only mock.** `callModel` dispatches "mock" to `ide/src/ai/mock.ts`, which answers with a
canned `AIResponse`; the preset is listed only when `import.meta.env.DEV`, and the client refuses
it otherwise, so a production build cannot select it. It makes the whole flow demonstrable
without a key and lets `pnpm ide:smoke` drive the real UI end to end (D-046).

**Consequences:** adding a provider is a preset entry (plus a protocol if its wire format is
new); tests never need network access; the browser, not a server, is the trust boundary for the
key, which is exactly what the BYO-key model promises.

### D-046 — The model proposes; only the user's Apply writes
**Status:** accepted (2026-10-31)

SPEC §9.1/§9.3 make the model's output an `AIResponse` that a validator gates before anything
touches disk (security invariant 9). The panel must therefore never apply a turn implicitly, and
the write path must be the one already verified in the WebContainer (`applyPatch`, D-025).

**Flow.** A turn is sent with the project as context (Model A: full manifest when the project is
running, the file list, the open buffer including unsaved edits, and `facilis.config.ts`; the
prompt is bounded and says so when it truncates). The answer must be one JSON object:
`{ message, patches[], notes[], requires_confirmation }`; a fenced block is tolerated, prose
around it is not. `parseAiResponse` rejects anything unusable and reports the parser/validator
output in the chat instead of guessing.

**Review.** A parsed answer with patches becomes a proposal: per file, the before-image is read
from the project, `fileDiff` renders a unified diff with three lines of context (capped at 400
rendered lines per file — a UI budget, not a security limit), and every file is accepted by
default but can be unchecked. Apply sends **only the accepted patches** through
`applyPatch()`, which re-validates them (`@facilis/ai`) and writes through the kernel bridge —
never OPFS — then refreshes the framework revision. Failures are reported per file; a partially
applied patch is shown as such and is not retried blindly. `requires_confirmation` is surfaced as
a banner on destructive turns; it is not yet a blocking modal.

**Scope now vs Phase 4.** Only the structural validator rules (`file-path-allowed`,
`content-present`) are enforced today. The other 14 SPEC §9.3 rules need a TypeScript program,
the manifest and the O-009 path allowlist; they land in `@facilis/ai` and are called from the
same `parseAiResponse`/`applyPatch` seam. The SPEC §9.4 retry loop is not implemented yet: a
failure is reported in the chat and the user re-asks. Neither gap weakens invariant 9 — the
model still writes nothing on its own.

**Verification.** `chat-session.test.ts` proves a turn yields a proposal with no bridge writes and
that Apply writes only accepted files; `chat-proposal.test.ts` covers create/update/delete diffs;
the smoke opens the real panel, configures the dev mock, sends, reviews and applies, then reads
the written file back from the VFS (`scripts/dev/smoke-chat.mjs`).

**Consequences:** per-file accept/reject and the proposal card are in place before the full
validator, so the remaining Phase 4 work plugs into a tested seam; the mock provider keeps CI
honest without a key.

### D-047 — The chat streams the message field, warns at the browser boundary, and can undo an apply
**Status:** accepted (2026-10-31)

Three gaps showed up in the first real session with the chat: a turn sat silent until the whole
`AIResponse` arrived; an applied patch could put Node-only code in client files and break the
preview with `Uncaught ReferenceError: process is not defined`; and Apply had no way back.

**Streaming.** The contract stays SPEC §9.2: the model answers with one JSON object, so streaming
the raw bytes would show JSON. `ide/src/ai/stream-message.ts` walks the growing prefix as a JSON
tokenizer (string/escape state, brace depth) and returns the decoded value of the top-level
`message` field, partial but readable; a "message" inside a patch body never matches. ChatSession
renders that prefix in the assistant bubble with a caret, throttling store emits to ~30 ms so the
panel does not re-render per token, and replaces it with the parsed `message` when the answer
finishes. Nothing is parsed early: the full response still goes through `parseAiResponse` and the
proposal is built from it. The dev mock now trickles its canned answer through `onText` as well,
so the streaming path is demonstrable and tested without a provider.

**Browser boundary.** The generated project has two runtimes in one tree: `src/` and
`components/` are the browser; `server/` is Nitro in the VM. The model had no rule for that, so
`process.env` or a server-only import in a client file compiled and then killed the preview. Two
guards: the system prompt gains rules 10-11 (no Node globals or server-only imports in client code;
use `import.meta.env`, call `/api/...`; `process.env` only in `server/`), and the review card
runs `scanPatchWarnings` (`ide/src/ai/patch-warnings.ts`) over `src/` and `components/`
patches, listing Node globals and server-only specifiers as non-blocking warnings under a
`warning` role. Warnings never prevent Apply: the user decides.

**Undo.** A proposal already read every before-image to render its diff; those are now kept and,
for the files that actually landed, stored as an undo plan. `chat-actions.ts` turns that plan back
into patches (a created file becomes a forced delete, an updated or deleted file is rewritten with
its previous content) and writes them through the same validated `applyPatch` path. The applied
card offers Undo until the plan is consumed; a new turn clears it. A partial apply is only undoable
for the files that landed, and a failed undo keeps the plan so it can be retried.

**Verification.** `stream-message.test.ts` and `patch-warnings.test.ts` cover the extractor and
the scanner; `chat-session.test.ts` asserts the partial bubble, the dropped bubble on a parse
failure, the undo plan, and that Undo deletes a created file; `chat-proposal.test.ts` covers the
warnings. The smoke applies the mock patch, reads it from the VFS, clicks Undo, and asserts the file
is gone again (`scripts/dev/smoke-chat.mjs`).

**Consequences:** the chat feels live without weakening the one-object contract; the boundary class
of mistake is caught at review time instead of breaking the preview; and an Apply is reversible
without git. The full 16-rule validator and the SPEC §9.4 retry loop remain Phase 4 (D-046).

### D-048 — Project instructions come from AGENTS.md
**Status:** accepted (2026-10-31)

The chat's context was entirely automatic: manifest, file list, open buffer and
`facilis.config.ts`. That is what keeps patches applicable, but it leaves no room for the
project's own conventions — the user asked for a way to customise the context, even partially.
The first, deliberately small step is a project instructions file rather than context switches:
the assistant's behaviour is what a user actually wants to steer, and a plain file is portable.

**Decision.** The project's instructions live in a root `AGENTS.md`, the name the agent-harness
ecosystem already uses. It is read on every turn, after the framework rules and before the
project context, under `## Project instructions (AGENTS.md)` with an explicit precedence
sentence: it refines style, structure and approach but cannot override the rules, the JSON
response contract or the security invariants. The unsaved Monaco buffer wins over the VFS copy
(same rule as the active file), the content is capped at 6,000 characters with a `[truncated]`
marker, and the file is simply absent from the prompt when the project has none.
The chat header gets a **Project instructions** action that opens the file in the editor and
creates it from a short template through the validated `applyPatch()` path when missing; it is
never overwritten. The composer's context line appends `AGENTS.md` when the last turn included
it.

**Why a file.** It is versioned with the project and travels with a clone, needs no IDE storage,
and works for anyone using another harness that reads `AGENTS.md`. Making it an IDE setting
would hide it from the repository and from teammates.

**Scope.** This is level 1 of the customisation discussed with the user: no per-turn selection of
context sections, no file attachments, no exclusions, and no replacement of the system prompt
(levels 2-3). Those remain open; the seam is `PromptContext` / `buildChatContext`.

**Verification.** `prompt.test.ts` pins the section order, the precedence sentence, the omission
and the cap; `chat-context.test.ts` pins the unsaved-buffer precedence; `instructions.test.ts`
pins create/no-overwrite/refused-write; `chat-session.test.ts` pins the action's write + open;
and the smoke clicks the action and asserts `AGENTS.md` lands in the VFS.

**Consequences:** a project can now tell the assistant how it wants to be worked on without the
user re-stating it in every conversation; because it is a normal file, the assistant can also
update it (no special-casing), and a clone carries the instructions.

### D-049 — A reloaded tab boots into its project, never Home
**Status:** accepted (2026-10-31)

A tab's URL already names the project it shows (`?project=<rootPath>`, D-035), but the
snapshot always started on `home` and switched to `workspace` only after the kernel booted
and the bootstrap pass opened the project. Every reload therefore painted the project picker
first and then swapped to the IDE — a visible, avoidable jump, and one that invited a click on
"New project" during the swap.

**Decision.** The first paint's view is derived from the URL (`boot-target.ts`, pure and
tested): `?project=` — or a `#share=` payload — starts on `workspace`; everything else on
`home`. The project-opening pass is a snapshot field (`bootProject`): while it is non-null a
blocking overlay shows the boot progress, and it is cleared once the project is open, or when
the pass gives up (the project is missing from the registry or is claimed by another tab) —
in which case the tab goes Home rather than lingering on an empty workspace.

**Consequences:** no Home flash on reload; the URL remains the single source of truth for what
a tab shows, so a tab opened with `?project=` behaves like a reload. The overlay blocks
interaction until the project is open: an empty IDE is much easier to misread than a spinner.

**Verification.** `boot-target.test.ts` pins the URL cases. The smoke's A12 reload step
asserts the reloaded tab starts in the workspace with the project named in its URL, not on
Home.

### D-050 — Deleting a project deletes its files, behind a typed confirmation
**Status:** accepted (2026-10-31)

Home's trash action removed the project from the recent-projects registry only. Its files
stayed in the VFS/OPFS, so recreating a project at that path failed with "That directory is
not empty", and the action read as a delete that did not delete.

**Decision.** The action is **Delete project**, not "Remove from list". It hydrates the
project first — its subtree may still be deferred in the OPFS mirror (D-036) — and then issues
one recursive `vv-rm`, whose unlink/rmdir calls reach the mirror through fs-server's
`onDelete`. The folder and its run terminal are closed before the delete so no editor model or
write-behind flush can race it. A project claimed by another live tab is refused: that tab
holds the tree in RAM and its mirror would recreate what was just deleted. The confirmation is
typed: the destructive button stays disabled until the input equals the folder's name
(`confirmsProjectName`), because the action is irreversible.

**Consequences:** a path can be reused after deletion and OPFS stops keeping dead projects.
There is no undo, which is what the typed confirmation is for. A registry entry whose files
are already gone is still pruned by `openProject`, as before.

**Verification.** `project-name.test.ts` pins the typed match; `pnpm ide:smoke` deletes the
project through Home's dialog (typing its name) and asserts both the files and the registry
entry are gone.

### D-051 — The IDE is Facilis-only: one creation path, no template catalog
**Status:** accepted (2026-10-31)

Phase 2 inherited the whole Vivari template catalog — 55 templates across 9 categories, ~11.4k
lines of payloads plus a brand-icon module — and Home offered "Start from blank", "Start from
template" and the import path. The product direction is Facilis-only: a generated project is
Nitro + PGlite + React following `facilis.config.ts`, and every other template (and the blank
project) was dead product surface that also kept a ~99 KB lazy chunk and its transform cost in
the IDE.

**Decision.** Remove `src/vv/templates.ts`, `src/vv/templates-lazy.ts`, `templateIcons.tsx` and
the brand SVGs only they used. The run manifest moves to `src/vv/project-manifest.ts` — the
kernel contract only (id, name, port, entry, install, dev, hmr/reload and the preview flags);
`src/facilis/facilis-template.ts` is the one template, loaded lazily by
`src/facilis/template-loader.ts`. Home has one creation card and one dialog (name, directory,
run-or-not) calling `IdeController.createProject`. `synthesizeManifest` for
imported/shared projects keeps only the runtime fields it actually sets.

A project created before this decision with one of the removed templates still opens, but with
no known run manifest: Run drops into a shell in the project instead of starting the wrong dev
command. The file-length baseline and `check-ide-theme.mjs` lose their template entries.

**Consequences:** smaller entry/lazy chunks, one obvious creation flow for users and for the
AI, and no product surface the framework cannot support. The trade-off is that importing an
existing non-Facilis project (folder/GitHub/npm) still works as an editor, but the IDE no
longer scaffolds one.

**Verification:** `pnpm --filter @facilis/ide typecheck|test` (the asset tests build the Facilis
template directly); `pnpm lint` (the file-length ratchet and theme check no longer exempt the
deleted files); `pnpm ide:smoke` drives the new dialog and the framework probes.

### D-052 — The dev database is an in-memory PGlite restored from a .facilis snapshot
**Status:** accepted (2026-11-01)

PGlite runs in memory and was thrown away on every Nitro worker restart — i.e. on every
edit to a server route — so the dev loop was "register a user, change a handler, lose the
session and the data". `dataDir` was not wired (D-015). Two persistence shapes were measured
on PGlite 0.5.11 first: a real data directory (NodeFS) is ~978 files / ~40 MB for an empty
cluster, so it would cross the VFS/OPFS mirror per file and replay on every project open;
`dumpDataDir("gzip")` is one ~4.6 MB archive (~300 ms on the host) and
`PGlite.create({ loadDataDir })` restores it in ~200 ms.

**Decision.** Keep the cluster in memory and persist one snapshot at
`<project>/.facilis/db/snapshot.tar.gz`. On boot the runtime reads it (if present) and
passes it to `createDb({ loadSnapshot })`; `@facilis/db` exposes `snapshot()` and a
monotonic `activity()` count, and `@facilis/nitro` installs a snapshotter that dumps only
when the cluster changed, from a 1 s ticker, and writes atomically (temp + rename).
Migrations are tracked by statement hash (`migrator.ts`), so a restored cluster re-applies
only new migrations. A corrupt or incompatible snapshot is a manifest warning and the
runtime starts empty rather than refusing to boot.

**Ignoring it.** `.facilis` is dev state, not source: it is dimmed in the Explorer (D-054),
kept out of the file index and search, excluded from export/share, and the runtime writes a
`.facilis/.gitignore` containing `*` so git ignores it even in projects whose own
.gitignore predates the directory.

**Consequences and limits.** At most ~1 s of writes can be lost if the process is killed
abruptly; a dev-server restart restores the last snapshot. Production is unaffected (real
Postgres). The snapshot is per project, so deleting the project removes it (D-050) and
"reset the database" is deleting the file.

**Verification.** `client.test.ts` round-trips `snapshot()`/`loadSnapshot` and pins
`activity()`; `dev-db-persistence.test.ts` pins the atomic write, the no-dump-on-idle rule
and `.facilis/.gitignore`; `pnpm ide:smoke` asserts the snapshot exists after DB activity
inside the WebContainer.

### D-053 — Binary storage is content-addressed, S3-compatible and behind a signed-URL proxy
**Status:** accepted (2026-11-01)

Files uploaded by a generated app need a home that works in the browser IDE and in
production without changing the app's code. Bytes never go in Postgres (only metadata):
the database stays small, RLS stays about rows, and the same blob can be shared by several
records.

**Blobs.** Addressed by their sha-256 hex digest, so identical content is stored once
(`put` is idempotent, there is no update-in-place). Dev writes
`<project>/.facilis/binary/<hh>/<hash>` through the project filesystem, which means the
VFS mirror persists them to OPFS like the dev database (D-052). Production uses a
S3-compatible bucket with the key `blobs/<hash>`. One Signature V4 driver covers AWS S3,
Cloudflare R2 and MinIO (endpoint + path style for the latter two); signing and presigning
are implemented on `node:crypto` + `fetch` — no AWS SDK in the framework.

**Package.** `@facilis/storage` exports `contentHash`, `createLocalStorage`,
`createS3Storage` (`StorageDriver`: `put/get/exists/delete`, plus `signedGetUrl` on S3)
and the token helpers. Access control is not the driver's job: it never exposes the store
root, and the app's proxy route decides who may read a blob.

**Signed URLs.** A route checks access (the caller owns the file, or can read the entity it
is attached to) and then signs a short-lived HMAC token carrying `fileId`, `tenantId`,
`subject` and `expiresAt` (`buildSignedDownloadUrl`, default 5 min). `GET
/api/files/:id?token=…` verifies the token and streams the blob in dev or `302`s to a
driver-presigned S3 GET in production. GET is token-only so `<img src>` and shared links
work without a cookie; every mutation stays session-authenticated. The token is opaque
enough for URLs but readable (not encrypted); any change breaks the signature.

**Metadata and attachment.** `facilis_files` (id, hash, name, mime, size, owner_id,
tenant_id, created_at) ships from `@facilis/db` with a restrictive tenant policy; access
to the bytes is decided by the routes that issue tokens. An entity "contains" files through
a generated link table: `fileLinks(todos, { table: "todo_files", column: "todo_id" })`
returns a table with cascading FKs to the parent row and `facilis_files`, a restrictive
tenant policy and a permissive `parent_access` policy:
`EXISTS (SELECT 1 FROM parent WHERE parent.pk = link.parent_id)`. Postgres evaluates that
subquery with the parent's own policies, so the link inherits the parent's access rules
instead of restating them — and the relation is a real, introspectable table in the schema,
manifest and release preview (a polymorphic `(entity_table, entity_id)` pair would have
neither FK integrity nor inherited RLS).

**No GC (for now).** Bodies are immutable and deduplicated, so an orphaned body costs only
space for content no longer referenced; reference counting or a sweeper is deferred. The
metadata row is what users see and delete.

**Verification.** `local.test.ts` pins dedupe, read, delete and the traversal guard;
`signing.test.ts` pins token round-trip, tamper, expiry and URL building; `s3.test.ts` pins
SigV4 headers, presigned URL shape, determinism and path-style vs virtual-host addressing;
`files.test.ts` pins the metadata/link schema and proves the RLS inheritance (a caller sees
only links to parents it can read, and cannot link to someone else's row). Cloud providers
still need an integration check against a real bucket; the signing vectors are structural
until then.

**Open.** Runtime wiring: the `storage` section in `facilis.config.ts`, `event.context.storage`
and the ready-made upload/download routes for the template (and the `FileUpload` block) are
the next slice; the package APIs above are the contract they build on.

### D-054 — The Explorer lists git-ignored paths, dimmed; index and search skip them
**Status:** accepted (2026-11-01)

D-052 hid `.facilis` from the Explorer along with the file index and search, and the index
walk had a hard-coded skip list for `node_modules`, `dist` and friends. Hiding is the wrong
answer for the Explorer: the files exist, `ls` shows them, and a project's own `.gitignore`
already states what belongs to its source tree — but a user cannot learn that from a tree
that silently omits rows. Search is the opposite case: its results are a promise that a match
is actionable source, so ignored paths must not appear there.

**Decision.** The Explorer lists every entry except `.git` (VCS internals, which git itself
never tracks); entries matched by a `.gitignore` are dimmed through the `data-git-ignored`
attribute (60% opacity, theme-neutral). The quick-open index and full-text search exclude
them, but the rule is now the project's `.gitignore` rather than a fixed list:
`ide/src/vv/workspace-index.ts` walks each root, parses every `.gitignore` it meets (root or
nested) with the same `ignore` matcher isomorphic-git uses, and applies the per-directory
rules outermost-first so a nested file wins, exactly as git does. It yields the searchable
file list plus the two sets (`ignoredFiles`, `ignoredDirs`) the UI consults. An ignored
directory is not descended into; `.facilis` is skipped (D-052) yet still recorded as ignored,
so its contents dim. Search filters result batches on this side — the kernel's walk has its
own fixed skip list and the runtime is read-only — and recomputes the summary counts from
what survives the filter.

**Consequences:** what the Explorer shows and what search covers now agree with git, and the
project's own `.gitignore` decides both. The walk reads one `.gitignore` per visited
directory on every tree refresh, bounded by depth and file count as before, so a path outside
the bound is neither indexed nor known to be ignored. Edits to a `.gitignore` (terminal or
save) show up on the next refresh because the read is not cached. Heavy directories are still
skipped without a rule — a freshly created project may have no `.gitignore` — but they are
dimmed only when a rule actually ignores them.

**Verification.** `workspace-index.test.ts` pins root and nested rules, negation, anchoring,
directory-only patterns, the unreadable-`.gitignore` fallback and the ignored-ancestor
prefix; `search-session.test.ts` pins the batch filter and the recomputed counts;
`pnpm --filter @facilis/ide typecheck|test|build`; `pnpm ide:smoke`.

### D-055 — The base UI kit is plain CSS + daisyUI-style role variables
**Status:** accepted (2026-10-31)

Generated projects need a small set of base components (table, toaster, inputs, fields,
badge, alert) that a project can use, restyle or copy. The kit must work in the project the
IDE generates today — a plain Vite + React app with no CSS framework installed — and as a
tarball with no build configuration (D-023/D-032). It therefore ships as `@facilis/ui`:
**plain CSS classes (`.fc-*`) plus one block of role variables**, not Tailwind utilities.
This keeps the whole component copy-pasteable (the directive's "recreate it if you need
more") and leaves Tailwind to the app for its own layout.

**Decision.** A theme is a complete variable set in `theme.css` (`:root` light,
`[data-theme="light"]`, `[data-theme="dark"]`): `--color-base-100/200/300`,
`--color-base-content`, `--color-primary|secondary|neutral|info|success|warning|error`
(+ `-content`), `--radius-selector|field|box`, `--border-width`. Components only name roles
(never a literal colour); rebranding means editing those values, adding a theme means another
`[data-theme="…"]` block. The prop surface is deliberately tiny: variants and sizes only, no
per-component colour/radius props.

**Consequences:** the kit is usable without Tailwind and works with any stack the project
chooses; `@facilis/blocks` may still be Tailwind/shadcn (D-003) because it builds app screens
on top of the base kit. Deep customisation is "copy the component and its `.fc-*` rules into
the project", not a configuration system.

### D-056 — Date/time logic is `Intl`, explicit zones and calendar-day strings
**Status:** accepted (2026-10-31)

The framework must not add a date library (bundle + in-VM install cost) and cannot rely on
Temporal: it is not in Node 22/24 and is not guaranteed in the WebContainer browser. The base
logic therefore lives in a zero-dependency `@facilis/time` package built only on `Intl`:

- formatting takes `{ locale, timeZone }` explicitly (runtime zone only as a documented
  default); instants are `Date`/ISO strings;
- a calendar day is the `YYYY-MM-DD` string, with `dateOnlyOf`/`today` producing it *in a
  zone* and `formatDateOnly`/start-of-day/end-of-day consuming it without shifting it;
- start/end of day are DST-aware (offset probing, no arithmetic on naive local time);
- invalid input throws instead of rendering garbage.

**Consequences:** one small module with a tested time-zone contract; no configuration. An app
that needs recurring rules, duration math or a picker writes/copies that on top.

### D-057 — Database i18n: translated content fields first, optional catalogue overlay
**Status:** accepted (2026-10-31; clarified by the product owner the same day)

"Translatable texts in the DB" means **a text stored in a row can carry several languages,
and the app serves only the user's language** — e.g. `{ en: "Todo", it: "Fare" }` on a
product/blog row. It is not a switch for the UI catalogue. `@facilis/i18n-db` is an opt-in
package with two independent pieces; a project imports what it needs.

**A. Translated content fields (primary).**
- The stored shape is one JSONB column per translatable field, typed `Translations =
  Readonly<Record<string, string>>`; `translatedText("title")` is the Drizzle column helper,
  `translationsSchema` the Zod validator. The project schema re-exports it, drizzle-kit
  generates the migration (no migration ships with the package).
- Serving picks one language: `resolveTranslation(value, locale, fallbackLocale = "en")`
  tries exact locale → base language (`it-CH` → `it`) → fallback locale → first present
  value → `""`, never throws. The API maps rows through it, so the raw translations object
  only leaves the server if the API says so.
- The user's language is resolved too: `resolveUserLocale({ userLocale, acceptLanguage,
  supported, defaultLocale })` — saved preference first (the app persists it, e.g. on the
  profile), then `Accept-Language`, then the default; `parseAcceptLanguage`/`matchLocale` are
  exported for the same logic. Persistence is app-owned: the package is a pure resolver.
- Client and server share the pure helpers through the `/client` subpath, which must not pull
  drizzle.

**B. Catalogue overlay (optional).** UI message keys can be overridden per deployment through
the tenant-scoped `i18n_messages` table; the JSON catalogues of `@facilis/core/i18n` stay the
base and a per-key fallback. The table needs the restrictive tenant policy **and** the
permissive tenant gate `i18n_messages_tenant_access` — a restrictive-only policy admits no
rows (D-008), the same reason `@facilis/auth` has `users_tenant_access`. It ships a public
`loadCatalogs` and the project writes the explicit `defineAuthorizedHandler` route (the AST
pass cannot see a re-exported handler, so the route metadata would be lost). `hydrateCatalogs`
on the client merges the DB rows over the JSON per key and registers the catalogues.

**Consequences:** content translations become a normal typed column, not a framework mode;
the UI catalogue overlay is available but optional; both are disabled by not importing the
package.

### D-058 — The generated frontend is pages + layouts + components + lib
**Status:** accepted (2026-10-31)

The project UI needs an explicit organisation before it can be tried: base components alone
do not tell a developer (or the AI) where a route, a shell or a fetch helper lives. The
reference implementation is `examples/todo-app` (real Nitro/PGlite backend), and
`docs/FRONTEND.md` is the contract.

**Layers.** `src/pages/*` = one component per route (data fetching + `Page` header, no shell
markup); `src/layouts/*` = page shells composed with the project's router and session;
`src/components/*` = app-specific pieces (promoted to `@facilis/ui` only when generic and
themeable through role variables); `src/lib/*` = framework-free logic (`api`, `session`,
`theme`, `i18n`, `dates`) whose pure helpers take their inputs and are unit-tested.

**Routing.** `react-router-dom` v7 declarative mode, one explicit route table in
`src/app.tsx`; `<BrowserRouter basename={appBasePath()}>` so the same app works at `/` and
under the IDE preview's `/preview/<port>/`. No file-based magic, no second router.

**Cross-cutting contracts.** `lib/api.ts` is the only `fetch` (JSON, session cookie,
`ApiError { code, details, status }`, `network_error`); API prose never reaches the UI —
errors map to `t("errors.<code>")`. Session = the framework cookie, loaded once by
`SessionProvider` with `RequireAuth`/`PublicOnly` guards. Theme = `data-theme` on `<html>`
with a stored preference (the kit stays variable-driven, D-055). i18n = project JSON
catalogues registered at boot, persisted locale with a switcher, optional
`hydrateCatalogs` overlay (D-057). Dates = `@facilis/time` with the user's zone, never
`Date#toLocaleString`.

**UI templates in the kit.** Neutral shells live in `@facilis/ui`: `Page` (header +
content), `AuthShell` (centred auth card), `EmptyState`, `Spinner`. Navigation-aware shells
(sidebar/user menu) stay in the project, because they need the router and the session.

**Consequences:** a project can be generated by copying four obvious folders; pages stay
small (state × view, no plumbing); the IDE template is generated from this example
(D-062), so the structure is not just a proposal — it is what a new project ships. Tailwind remains the app's utility layer, but the reference app
uses only variables and `.fc-*` classes so no CSS framework is required to boot.

### D-059 — Direction A is the app base: institutional, green accent
**Status:** accepted (2026-10-31)

After the design lab (`examples/design-lab`, D-058 follow-up) the owner picked **A —
Institutional** as the base visual layer for generated apps: light-first neutrals, forest-green
primary (`#15803d` light, `#4ade80` with dark content in dark mode), one green signal accent,
dense but airy layout (control 38 / row 44 / sidebar 248 / page max 1280), radius 8/12, subtle
shadows, Geist Variable, designed light+dark.

The **brand layer remains open** (B violet or C warm, each light+dark) and is temporarily
rendered with A; when chosen, its complete theme blocks are added alongside the operations ones,
and auth/onboarding/empty states opt into them.

**Consequences:** the kit keeps one component set with role-based tokens; the lab's A tokens and
pattern CSS are promoted into `@facilis/ui/theme.css`, the existing primitives are polished
(no API changes), the lab patterns (Card, StatCard, Tabs, Dialog, Switch, Avatar, Pagination,
TableToolbar, Menu, Skeleton) become kit components, and the gallery + todo app are restyled as
the first acceptance. Brand names stay out of the docs and code.

### D-060 — One stylesheet per component, theme.css only tokens + global
**Status:** accepted (2026-11-01)

Owner feedback after reviewing the promoted kit: a single stylesheet holding every component's
rules is hard to navigate and maintain. Each component now owns its styles.

**Decision.** `src/<component>.css` sits next to `src/<component>.tsx` and the module imports
it (`import "./button.css";`); shared visual atoms live in small partials imported by the
components that use them (`icon-button.css`). `theme.css` keeps **only** the Geist `@import`,
the three complete token sets and the global base layer (reset, body, links, global focus
ring) — no `.fc-*` component rules. The build runs `tsc` plus `scripts/copy-css.mjs`, which
copies every stylesheet into `dist/` so packed tarballs (D-023) resolve CSS next to the
compiled JS; `src/` and `theme.css` still ship for copy-paste. `css.test.ts` enforces that
every styled component imports its stylesheet, every stylesheet is imported, `theme.css` has
no component rules, and component CSS contains no colour literals and only tokens defined in
`theme.css`.

**Consequences:** adding a component means the module, its stylesheet and a test; copy-pasting
a component brings its CSS; the CSS bundle carries a little deliberate duplication but stays
organised. This is the structure new components and the IDE template follow.

### D-061 — Content components: a safe Markdown subset and the translations value shape
**Status:** accepted (2026-11-01)

Owner asked for a rich text editor ("markdown is fine") and a component to manage the
multi-language value of a text. Both ship in `@facilis/ui` as content components:
`MarkdownEditor` + `Markdown` (renderer) and `TranslationsInput`.

**Decision.** The editor is Markdown source, not WYSIWYG: a toolbar transforms the real
textarea selection, Write/Preview tabs render the value, and `Markdown` is exported so pages
render saved content with the same code. Markdown is a **fixed, safe subset**: headings,
paragraphs, bold/italic/inline code, bullet/ordered lists, blockquote, fenced code, hr, line
breaks and links; the renderer builds React elements (never `dangerouslySetInnerHTML`), raw
HTML stays text, and link targets are limited to `http(s)`, `mailto:`, `#` and relative
URLs, so previewing untrusted content cannot inject markup. No new dependency.

`TranslationsInput` edits `Translations = Readonly<Record<string, string>>`, the same shape
`@facilis/i18n-db` stores (D-057) but declared in the kit instead of importing the server
package. Locales come from the project config (`locales`, tab order); `availableLocales`
feeds the add-language action; the default locale is marked and cannot be removed; tabs
carry a filled/empty dot so missing translations are visible. It is a client input only —
no catalogue, no persistence.

**Consequences:** a generated project with a Markdown field or a translated field stays
copyable and dependency-free; the renderer's subset is the contract (extending it means
extending the parser + tests, not adding an HTML sanitiser); the translations value plugs
into `translatedText`/`resolveTranslation` unchanged.

### D-062 — The IDE template is generated from examples/todo-app
**Status:** accepted (2026-11-01)

The base kit restyled and reorganised `examples/todo-app` (pages/layouts/lib, `@facilis/ui`,
`@facilis/time`, router), but the IDE still scaffolded its own probe app: different client
files, plain CSS, no kit, no router. The starter users get and the reference app they should
copy had drifted apart, and the base-kit contract left the wiring explicitly out of scope
("wiring the packages into the IDE template" was reported, not done).

**Decision.** The generated project IS `examples/todo-app`, not a copy of it. At IDE build time
`ide/src/facilis/example-template.ts` inlines the example's `src/`, `server/`, `db/`,
`locales/`, `index.html`, `vite.config.ts` and `facilis.config.ts` through
`import.meta.glob(..., { query: "?raw" })`; `facilis-template.ts` then assembles example files
+ IDE wrappers + a small override map (`template-overrides.ts`). The wrappers are the only
files written by hand: `package.json` (built from the example's versions, with `@facilis/*`
rewritten to vendored tarballs plus the in-VM extras), the standalone `tsconfig.json`,
`.npmrc`, README and the npm hooks. The overrides are the few places the IDE cannot take the
example verbatim: add the HMR hint plus its `.muted` style to `app.tsx`/`styles.css`, and
the in-process Nitro runner + `main` release ref to `facilis.config.ts`. Each
override is an anchored replacement that throws when the anchor disappears, and
`example-template.test.ts` asserts every untouched example file is byte-identical, so an
example refactor fails the IDE suite instead of generating a different app.

The probe is not in the generated app at all: `scripts/dev/smoke-facilis.mjs` drives the
framework endpoints from the IDE page against the preview's same-origin
`/preview/<port>/` base (so the session cookie the login sets applies), which keeps a
user's starter free of test instrumentation — it never auto-registers a probe user or
inserts probe rows. The only IDE-only route is the public liveness `ping` the write smoke
edits. `@facilis/time` and `@facilis/ui` join the vendored tarball set
(`TEMPLATE_PACKAGES`, `scripts/dev/vendor-facilis-deps.sh`), and `ide/vitest.config.ts`
enables `test.css` so `?raw` CSS is real in tests instead of Vitest's empty stub.

Two supporting fixes came out of making the starter real. The IDE language service now uses
TypeScript's `Bundler` module resolution instead of classic NodeJs: the generated app imports
its own packages through `exports` maps (`@facilis/ui`, `@facilis/core/i18n`), which node10
ignores — every such import would be a red TS2307 in the editor, and the IntelliSense smoke
now proves it does not. The vendor packer, in turn, mirrors each package's root export as
`main`/`types` and rewrites `.d.ts` relative specifiers to the emitted `.js` (and drops CSS
imports), because declaration emit preserves the source `.tsx` specifier, which cannot be
resolved out of `dist/`.

**Consequences:** editing `examples/todo-app` changes what "New project" scaffolds, and the
generated app opens on the todo login page rather than a probe page; the smoke's HMR edit now
targets `src/app.tsx`. The generated `vite.config.ts` keeps the example's dev-vhost
`allowedHosts` (dev-only, harmless) and its `release.ref` becomes `main` instead of
`origin/main`. `starter/` stays empty until `@facilis/*` has a publish target (D-027).

**Verification:** `example-template.test.ts` (drift guard, overrides, tarball deps);
`starter-contract.test.ts`, `project-files.test.ts` and `package-manager.test.ts` updated to
the assembled template; `pnpm --filter @facilis/ide typecheck|test|build`;
`pnpm ide:facilis-deps`; `pnpm ide:smoke` (endpoints driven from the IDE page, IntelliSense
on the router/kit imports, HMR, server reload, database roundtrip).

### D-063 — A deployment has two build profiles, `open` and `managed`, and no server
**Status:** accepted (2026-11-01)

The base product is open source and browser-resident: it must let anyone install any package
from any registry. An organisation that deploys it for its employees needs the opposite —
which libraries may be installed, which registry is reachable, which projects may run — and
will not accept a backend in the loop. One behaviour cannot satisfy both.

**Decision.** The IDE is built in one of two **deployment profiles**, chosen at build time:
`open` (default: today's behaviour, no restrictions) and `managed` (a company build driven by
a `facilis.deploy.json` config, served on a dedicated origin). `managed` is not a fork and has
no runtime policy switch: the restrictions are compiled into the artifact. Enforcement is
explicitly L0 (build) + L1 (runtime checks) + L2 (network: CSP, registry mirror, host egress).
Server-side approval (L3) is out of scope by decision, which is why the contract states what a
deployment does *not* guarantee. Contract: `docs/MANAGED-DEPLOYMENT.md`.

**Consequences:** the OSS base keeps zero friction; an adopter's build is reproducible from
the same sources; each company is one build on its own origin, which gives per-origin browser
storage isolation for free (O-003: a deployment is single-tenant). The security claim is "the
sanctioned origin loads only build-time code and reaches only configured hosts", never "a
browser cannot run other code". Implementing it requires making the app compatible with a
strict CSP and a custom registry: today it hardcodes the public registry and ships no CSP.

### D-064 — One build-time config is the single source of truth for a managed deployment
**Status:** accepted (2026-11-01)

A managed deployment has several places that must agree: what the IDE allows, what the
registry serves, what the CSP allows, what the generated project's `.npmrc` says, and what the
update checker treats as approved. Configured separately they drift, and drift in the
allowlist is a security bug.

**Decision.** A single `facilis.deploy.json` is compiled into the build and
emits every other artifact: the dependency allowlist, `mirror-allowlist.json` for the
registry, the AI provider and skills allowlists, `npmrc.template`, `headers.conf`
(COOP/COEP + CSP) and an `environment.json` manifest.
Invalid configs fail the build. No secrets in the config: the mirror is anonymous read-only. The
build reads the config path from the **build-time** `FACILIS_DEPLOY_CONFIG` variable (unset means
`open`; set-but-missing or invalid fails the build) and hashes the resolved config into
`environment.json`. The file is JSON under one schema: no code executes during a deployment
build, and the config is a build input, never fetched at runtime - a served file that changes
policy is rejected, because that would make L0 switchable from the browser.
Artifacts and hosting requirements: `docs/MANAGED-DEPLOYMENT.md` §4-§6.

**Consequences:** adding a package to a deployment is a config change plus a rebuild, and the
mirror and the IDE cannot disagree; the CSP is generated, not hand-maintained; a mirror is a
hard requirement of `managed`, not an add-on. One CI pipeline can build every company's
artifact by pointing `FACILIS_DEPLOY_CONFIG` at that company's config.

### D-065 — App updates are an in-IDE project-versus-environment diff, not a server feed
**Status:** accepted (2026-11-01)

Generated projects outlive the build that created them, and adopters need a simple signal:
"this app has updates to apply". A server-driven feed would reintroduce the backend the
architecture refuses (D-045 trust boundary) and would not work air-gapped.

**Decision.** Every generated project carries `facilis.app.json` (template and environment
version, lockfile hash). The running build knows its own version, so the IDE compares locally
and shows a badge plus a panel when the project is older. Upgrading applies ordered,
idempotent recipes shipped with the build, regenerates the dependency tree against the
configured registry, runs the DB migration, and rolls back on failure; the project's git repo
is the undo. In `managed`, the comparison is against the deployment's approved baseline, so
the same indicator also reports dependencies outside policy. Contract: `docs/APP-UPDATES.md`.

**Consequences:** no network needed for the check; recipes are code, reviewed with the build;
the upgrade path is bounded by the versions a build actually contains. Environment updates
stay a redeploy — the user never "updates the IDE".

### D-066 — The AI runs inside the deployment's boundary, and its provider is the one declared exception
**Status:** accepted (2026-11-01)

The AI reads project content, calls a remote provider and proposes writes. The browser sandbox
protects the machine, not the IDE's data: it does not stop a generated app from reading the BYO
key from the IDE origin, and it does not decide what leaves the browser. The settings can also
point the provider at a custom base URL, and the patch validator is still a Phase-0 skeleton.

**Decision.** AI is a deployment-governed feature, not an ambient one. Contract:
`docs/AI-SKILLS.md`.

- egress is one declared exception: `ai.mode` is `off`, `byo` (allowlisted provider presets) or
  `gateway` (internal endpoint); provider hosts are compiled into `connect-src`, and a custom
  base URL is rejected in `managed`.
- the BYO key stays in `localStorage` and requires preview isolation, so enabling AI and
  isolating the preview ship together.
- the instruction hierarchy is fixed: only the build's system prompt and the user's actions can
  grant capabilities; `AGENTS.md`, project files, the manifest, tool output and third-party
  skill content are data or subordinate instructions.
- provider output is untrusted and only the user's Apply writes; the blocking validator rules
  (auth/RLS/`dbTables`/raw db/package policy/secrets/paths, plus tool calls) are a prerequisite,
  so `managed` defaults to `ai.mode: "off"` until they exist.
- Model B tools are a closed primitive set with no shell and no network.

**Consequences:** AI is opt-in per deployment; in `managed` the key is not reachable from
generated code; O-009 (letting the AI edit `package.json`) is gated by the dependency policy;
`open` keeps today's BYO behaviour with a warning that a project can read the key.

### D-067 — Skills are a reviewed supply chain, not content
**Status:** accepted (2026-11-01)

A skill is a versioned bundle that instructs the model for a class of tasks. Its text steers
code generation, so it has the reach of a dependency without the code a review usually reads.

**Decision.** A skill is a manifest (`skill.json`), instructions (`SKILL.md`) and resources,
with declared `capabilities` (read/write globs, tool subset, no network, command subset) that
act as a maximum enforced at the existing boundaries (context assembly, validator,
`applyPatch`, the tool router, the egress policy). Skills carry integrity and a publisher
signature, a deployment allowlist (`skills.allow`) and an approved version baseline, are
enabled by the user from the allowed set (never automatically), and update through the same
path as the app (D-065). Contract: `docs/AI-SKILLS.md` §8.

**Consequences:** an unapproved third-party skill is untrusted text and is never inserted into
the prompt; the deployment's skill catalog is a signed artifact like the mirror allowlist;
skill authoring and review become a process the product must support (capabilities shown,
diffs reviewed, changes attributable in git).

### D-068 — Postgres is the production driver, and the runtime connects as the app role
**Status:** accepted (2026-11-01)

Development runs PGlite (WASM Postgres) inside the browser VM; a deployment must run a real
Postgres. Phase 1 deferred exactly that with a typed "not implemented" error and an explicit
"do not add `pg`", which left every app undeployable. Contract: `docs/POSTGRES.md`.

**Decision.**

- `createDb({ driver: "postgres", url })` uses `pg` 8.23.1 with `drizzle-orm/node-postgres`,
  both loaded through `createRequire` (the D-039 pattern). The generated project runs server
  code inside the WebContainer, where `node:net`/`node:tls` are meaningless, so a static
  import would drag them into the in-VM bundle for a branch that cannot run there. `pg` is
  therefore an **optional capability**: `@facilis/db` does not depend on it and the
  deployment installs it. (Declaring it in the package gave pnpm two peer variants of
  `drizzle-orm` and broke type identity across packages - the same reason it must not be a
  transitive dependency.)
- One `PgDatabase`-based client type serves both drivers, with a specialised result HKT: the
  abstract one collapses `execute()` to `unknown`, which silently loses every `rows` access.
- The environment wins over the config: `FACILIS_DATABASE_URL` else `DATABASE_URL` means
  postgres whatever `db.mode` says (a blank value counts as unset). Two situations are refused
  with a manifest warning instead of degraded: pglite while `NODE_ENV=production`
  (`db_pglite_in_production`) and postgres without a URL (`db_url_missing`). A production app
  must never write to an in-memory cluster and look healthy. Migrations, the role seed and the
  `facilis_app` grants are a deploy step, never a production boot (`db_migrations_skipped`).
- **Least privilege:** the runtime connects as `facilis_app` (`NOSUPERUSER`, `NOBYPASSRLS`).
  Managed Postgres cannot create a `BYPASSRLS` role, and an unprivileged connection is what
  makes RLS the enforcement point for every query instead of a privilege we hope no bug
  abuses. `runWithPolicyScope`'s `SET LOCAL ROLE facilis_app` is then a no-op in production
  and the enforcement step in dev. Consequence for auth: the session middleware validates the
  session and loads `user_roles` inside one tenant `runWithPolicyScope` transaction, so the
  privileged root client is no longer needed (the explicit tenant check stays as defense in
  depth).
- `snapshot()` is a PGlite capability. The postgres driver rejects with
  `SnapshotUnavailableError`, and the dev snapshotter (D-052) is installed only for pglite.
- Sequences are part of the app-role grants: a `facilis_app` insert into a `serial` table
  needs `USAGE` on the backing sequence.

**Consequences:** any project is deployable to any Postgres (Neon, Supabase, RDS, self-hosted)
with one URL and one documented provisioning step; development keeps its zero-setup in-memory
database; `db.mode: "json"` stays declared-but-unimplemented; there is no provisioning CLI
yet, so the documented one-liner is the deploy step. The starter template does not ship `pg`
in its dependency list yet (IDE side of D-062), so a generated project adds it when it
deploys. Verification: `pnpm pg:e2e` builds the example for production, runs it against a
real Postgres wire endpoint (PGlite + `@electric-sql/pglite-socket`), provisions through the
owner connection and drives register/login/session/todo over HTTP, asserting the row is in the
cluster; `packages/db` covers pooling, transactions and RLS through the same wire.

### D-069 — The product presents itself as Facilis Studio; the upstream name stays in provenance
**Status:** accepted (2026-11-01)

The IDE is a fork of Vivari Studio (D-011) and inherited that name in its user-visible
surface: the document title, the title bar, the tab title, the runtime toast and the
Service Worker's synthesized preview screens ("Connecting to Vivari…", "Keep the Vivari
editor tab open"). Someone using `facilis.dev` must never be told they are running
someone else's product.

**Decision.** Every user-visible string says **Facilis** (or Facilis Studio) and the shell
points at `https://facilis.dev` (title, meta description, canonical link). The brand is a
catalogue message (`app.name`), not a JSX literal. The Vivari name survives only where it
is a fact rather than a label:

- attribution and provenance (LICENSE, `ide/README.md`, D-011, D-030);
- package and module identifiers (`@vivari/core`, `vendor/vivari/**`), which are the
  kernel's real names and would need a fork-wide rename;
- internal identifiers and protocols (`__vv*`, `vv-*`, `host.vivari.internal`), which are
  wire and storage contracts inside the kernel.

`ide/public/sw.js` is the one file that must stay in sync with the upstream copy: its
routing logic stays identical and only its brand strings diverge, noted at the top of the
file so a future upstream sync cannot quietly reintroduce the old name.

**Consequences:** the deployed IDE shows Facilis from the first paint, in the tab title
(which follows the locale), in the preview boot/error screens and in the runtime failure
toast; grepping `ide/src` and `ide/public` for "Vivari" returns only provenance comments and
kernel identifiers. The vendored kernel can still print its own brand in deep error
messages; renaming that belongs to the fork, not to this app.

### D-070 — The upgrade engine plans explicit files and treats the marker as the commit point
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

### D-071 — The managed CSP allows eval, because the runtime is an evaluator
**Status:** accepted (2026-11-01)

[MANAGED-DEPLOYMENT.md](./MANAGED-DEPLOYMENT.md) §5 drafted a CSP without \`unsafe-eval\`; the
spike (§12) measured the opposite: under that policy the Studio boots and a project is
created, then the VM never evaluates and the preview never paints. The kernel compiles and
runs the project's code with \`new Function\` - the requirement is documented in
\`vendor/vivari/packages/runtime/module.js\` - and its workers inherit the page's policy.

**Decision.** The generated CSP keeps \`script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'\`.
No directive scopes eval to the VM alone, and the portable alternative - serving the kernel's
worker chunks with their own headers - needs per-path rules on hashed asset names, which the
hosts we document (nginx, Caddy, Cloudflare Pages) do not all express the same way; it stays
an optional tightening, not the default.

**Consequences.** L2 keeps its hard guarantees for *network* - \`connect-src\`, \`frame-src\`,
worker origins, no remote scripts - and no longer claims to prevent eval. That is honest: the
CSP was never a code-integrity control, since the project's code is supposed to run inside the
VM, and its supply is constrained by the registry mirror, \`packages.allow\`, admission and the
AI/provider policy (D-063, D-064, D-066). A deployment that cannot accept eval cannot run
projects in the browser at all, so the option is not offered as a configuration switch.
Verified 2026-11-01 in Chromium: CSP + \`unsafe-eval\` reproduces the unrestricted run exactly.

### D-072 — The default build ships a baseline CSP too
**Status:** accepted (2026-11-01)

The first CSP was scoped to managed builds, because only a deployment with a policy had
origins to name. That left the default build - the one facilis.dev serves and almost everyone
runs - with nothing beyond COOP/COEP, so its tab could load remote scripts and frames. Being
"unrestricted" as a *product* is not the same as being unhardened as a *document*.

**Decision.** \`renderHeaders\` emits a CSP for both profiles. Managed encodes the deployment
policy (§5); open carries this baseline:

\`\`\`
script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' 'sha256-…';
worker-src 'self' blob:; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:;
connect-src 'self' https: wss: ws: blob: data:;
frame-src 'self'; base-uri 'none'; object-src 'none';
\`\`\`

The network stays open because that profile is documented as unrestricted: arbitrary
repository imports, AI presets and custom base URLs, the opt-in loopback relay. Narrowing it
would be a new product policy, not a baseline.

Inline scripts are hashed by the build itself: \`vite.deployment.ts\` reads the built
\`index.html\` and turns every inline script into a \`sha256-\` source. That keeps the pre-paint
theme script working, and it fixed the managed build too, which was missing that hash.

**Consequences.** Open stays behaviourally identical - every directive is a permission, not a
requirement - while the cheapest remote-code and clickjacking vectors are gone. A deployment
that needs the hard boundary still picks managed; an operator who wants no CSP at all must
serve its own headers, which is a deliberate step rather than a default. The baseline is not
configurable, for the same reason a default is only useful when it is the same everywhere.

### D-073 — Git import reads the host's CORS-enabled API; no SSH, no token storage
**Status:** accepted (2026-11-01)

Import needs private repositories, and not just GitHub. A browser tab cannot speak git's
smart-HTTP or SSH (no raw socket), so the only path is the host's HTTPS API: it must send CORS
headers, and the page fetches it directly. Measured 2026-11-01: GitHub's API (and
\`raw.githubusercontent.com\`), GitLab's \`/api/v4\` (cloud and self-hosted) and Gitea/Forgejo's
\`/api/v1\` all answer \`Access-Control-Allow-Origin: *\`, and their preflights allow the auth
headers we send (GitHub \`Authorization\`, GitLab \`private-token\`, Gitea \`Authorization\`).
Self-hosted Gitea/Forgejo need \`[cors]\` enabled; GitLab's API sends it by default. SSH is
impossible in the tab, and a host without CORS cannot be imported — that is a server setting,
not a client workaround.

**Decision.** \`git-provider.ts\` owns the host table, the URL parsing and the per-host auth
header (\`Authorization: Bearer\` on GitHub, \`PRIVATE-TOKEN\` on GitLab, \`Authorization: token\`
on Gitea/Forgejo); \`git-import.ts\` reads the tree and the blobs per host (GitHub keeps
\`raw.githubusercontent.com\` for public repositories and uses the contents API when a token is
given; GitLab and Gitea/Forgejo are API-only, with paginated tree walks). The token is optional,
normalized (\`normalizeGitToken\`), never written to storage and never put in a URL: the dialog
holds it and drops it when it closes. GitHub Enterprise is out of scope for now: its API lives
at \`/api/v3\` and its raw host differs, so the GitHub adapter's fixed URLs would be wrong.

**Consequences.** GitHub, GitLab (cloud and self-managed) and Gitea/Forgejo can be imported
from the tab; a private repository works with a read token; nothing is persisted, so a second
import asks for the token again (PAT-per-host storage stays Phase 2, with the encrypted-OPFS
design in SPEC §10). A managed build compiles the whole git import out (D-063), so this
capability exists only in the open profile. Bitbucket Cloud is not wired yet (directory-walk
API, Basic auth); its API does send CORS, so it is a follow-up adapter, not a new decision.

### D-074 — A project is imported from a git host or a folder, never from an npm package
**Status:** accepted (2026-11-01)

The npm import treated a published package as a project source: the tab unpacked its tarball
and synthesized a Run manifest from whatever `package.json` it found. That is not a project.
It has no repository intent (no `.git`, no history, no source-layout contract), its dependency
tree is not resolved (a package's devDependencies are not the app's), and it carries no
`facilis.app.json`, so admission and the update comparison have nothing to check. The two
remaining import surfaces, a folder and a git host (D-073), carry the project's own sources and
its marker, and they cover "I have existing code" without a second remote protocol (npm
packument + tarball + tar/gzip decoding inside the tab).

**Decision.** Remove the npm package import. The dialog is a git-host import only;
`importNpmPackage`, `parseNpmSpec`, `fetchNpmPackage` and the local tar/gzip decoding are
gone, and `projects.imports.npm` leaves the deployment schema (an unknown key now fails
validation, which is where a stale config should fail).

**Consequences.** One fewer remote source and a smaller admission surface in the open
profile. A package's files can still be brought in by importing its repository, or by
importing a folder. `imports.git` remains the only remote import kind, and a managed build
still compiles it out (D-063).

### D-075 — The IDE's visible brand is the facilis.dev logo; the title is not a text string
**Status:** accepted (2026-11-01)

D-069 settled the product's name but kept "Facilis Studio" as the visible text in the title
bar and the document title. The logo ([`brand/`](../brand) — black and white, wordmark
`facilis.dev`) is the brand, and the name the product answers to is the site itself.

**Decision.** The title bar renders the logo lockup (`ide/public/facilis-lockup.svg`, a
single-ink mask painted with `currentColor` via `.brand-lockup` in `ide/src/index.css`) in
place of the text title; the button's accessible name stays in the catalogue (`app.name`, now
`facilis.dev`). The document title is `facilis.dev`, or `<project> — facilis.dev`; the static
`ide/index.html` title and meta description say `facilis.dev`. D-069's provenance rules are
unchanged: the Vivari name survives only in attribution, package ids and the `__vv*`
internals.

**Consequences.** The brand is one vector asset for both the tab (favicon) and the chrome, and
it follows the theme without a per-theme copy. `Facilis Studio` no longer appears in
`ide/src` or `ide/index.html`; it survives only in the architecture diagrams
(`README.md`, `docs/SPEC.md`) and this decision log, where it describes the app rather than
labelling it.

### D-076 — The IDE is installable as a PWA; no app-shell cache yet
**Status:** accepted (2026-11-01)

The Studio is a static SPA, so installability is a manifest, two icons and a link. Chrome no
longer requires a service worker with a fetch handler to install from the menu (mobile 108 /
desktop 112), and the preview SW is already registered at root scope with
`Service-Worker-Allowed: /`; the preview relay is untouched.

**Decision.** `ide/public/manifest.json` declares `id`, `start_url` and `scope` at
`/`, `display: standalone`, the ink theme/background colour and 192/512 PNG icons derived
from the app icon. `ide/index.html` links it and adds the mobile/iOS standalone metas;
`pwa-manifest.test.ts` pins the fields and checks each declared icon size against the PNG's
own IHDR. It is `.json` rather than `.webmanifest` so any static host serving JSON MIME
types gets it right without a per-host mapping (the spec allows any JSON MIME); the name is
`facilis.dev`, for the same origin the app already runs on.

**Consequences.** The IDE installs from the address bar in both profiles; a managed deployment
gets the same manifest on its dedicated origin. Installation does NOT add offline support: the
preview SW still passes every non-preview request to the network by design, so a managed build
cannot serve a stale shell past its approved baseline (D-065/D-070). An app-shell cache is a
separate decision and must be network-first for navigations before it is safe for managed.

### D-077 — The IDE ships on `ide.facilis.dev`, built by GitHub Actions and served by Cloudflare Pages
**Status:** accepted (2026-11-01)

D-020 reserved `facilis.dev` as the project home (site + docs); the IDE is not the landing
page, so it must not own the apex. It gets its own origin, `ide.facilis.dev`, which also keeps
the preview Service Worker's root-scope claims confined to the app, and leaves the apex free
for the presentation site.

**Decision.** Production is a Cloudflare **Pages** project (`facilis-ide`) with
`ide.facilis.dev` as its custom domain. `.github/workflows/deploy-ide.yml` runs on every push
to `main` that touches the IDE inputs: it checks out the submodule, installs, rebuilds the
four gitignored build artifacts (`pnpm ide:wasm`, `pnpm ide:assets`, `pnpm ide:facilis-deps`),
runs the production Vite build and uploads the finished `ide/dist` with
`wrangler pages deploy` (pinned wrangler version in the workflow). Cloudflare's Git
integration is deliberately not used: the kernel Wasm needs a Rust toolchain plus a ~100 s
cargo build that Pages' builder cannot cache, while GitHub Actions caches it by the pinned
submodule commit — so the pipeline stays fast and deploys exactly the tree the repo builds.
Nothing has to be run locally.

The host configuration is in the repo, not the dashboard: `ide/public/_headers` (shipped from
the build) sets COOP/COEP on every response — the kernel needs `SharedArrayBuffer` — keeps
`/sw.js` at root scope with `Service-Worker-Allowed: /`, marks the content-hashed `assets/`
immutable and revalidates the unhashed `vendor/` and DevTools trees. The workflow verifies the
deployed production URL returns those headers, so configuration drift fails the deploy.

**Consequences.** The apex stays free for the presentation site (D-020); the IDE's canonical
link points at its own origin (D-075's brand strings and canonical-domain rule are unchanged —
the product is still called facilis.dev). Deploying is a push to `main`; `workflow_dispatch`
covers a manual re-deploy. The only account-level state is the Pages project, its custom domain
and the repository secrets `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`, bootstrapped once
and documented in `docs/DEV.md` §9. Per-PR preview deployments are not enabled yet; a
`*.pages.dev` preview URL is a later change to the same workflow.

### D-078 — Publishing pushes one commit through the host's REST API; it never runs git
**Status:** accepted (2026-11-01)

D-073 made repository *reading* API-only because a browser tab cannot speak git's smart-HTTP
protocol: no raw socket, no CORS on the git endpoints, no git binary in the WebContainer. Writing
has the same constraint, and the naive reading is that write-back is impossible. It is not: every
host also exposes CORS-enabled REST endpoints that create commits (GitHub Git Data, GitLab
Commits, Gitea contents), so the IDE can *publish* a project without a clone, a relay or a
server. What it cannot do is be a git client.

**Decision.** Add "Publish to a git host" as the write half of D-073: `ide/src/vv/git-push.ts`
plus a per-host adapter (`github-push.ts`, `gitlab-push.ts`, `gitea-push.ts`), planned by
`project-publish.ts`, opened from the command palette and rendered by `PushRemoteDialog.tsx`
(open state in `publish-session.ts`).

- **Diff without git.** The remote branch's tree is listed through the same API (blob ids), the
  VFS files are hashed as git would (`sha1("blob <len>\\0" + bytes)`, `git-blobs.ts`), and the two
  lists are compared. Nothing is downloaded twice and no baseline is persisted: the remote branch
  is the baseline.
- **One commit.** GitHub creates blobs, then a tree with `base_tree` (a `null` sha deletes a
  path), then a commit whose parent is the listed head, then moves the ref with `force: false`.
  GitLab posts `/repository/commits` with an `actions[]` batch (base64 for binary). Gitea has no
  batch endpoint, so it writes file by file through the contents API and reports the real commit
  count — a host limitation, stated rather than hidden.
- **Branch policy.** A publish either commits onto an existing branch or creates a new one from it.
  The plan carries the head it was diffed against; a branch that moved since is a conflict error,
  never a silent overwrite. Force-push, merge, rebase, tags and LFS are out of scope.
- **Secrets.** A token with write scope is required and handed in per publish; it lives in the
  dialog's state and is dropped when the dialog closes (the same rule as D-073's import token).
  The author name/email come from the existing local git identity (`git-config.ts`).
- **Policy.** New deployment key `projects.exports.git`: `true` in the open profile, `false` in a
  managed build. A managed build may opt in — unlike an import this only sends the company's own
  code out — but then requires `network.connect`, because the CSP is what actually reaches the
  host. When the switch is false the build stubs the write layer out (`vite.deployment.ts`, next to
  D-073's import stub; the shared host table disappears only when neither direction is on), and
  `environment.json` records `gitPush`.
- **Excluded paths.** `node_modules`, `.git`, build output (`dist`, `build`, `.next`, `.turbo`,
  `.cache`, `coverage`, `.vite`), `.facilis` and logs never leave the tab — the same intent as the
  SCM walk's ignore list. A publish commits source, not the workspace.

**Rejected alternatives.** A CORS proxy, or the optional network relay (`?net=`), would let a real
git client run (`isomorphic-git` is already a dependency for the local SCM) but reintroduces a
server — L3, against the deployment constraint — and the relay is loopback-only and per-launch, so
neither fits a static deployment. A per-file GitHub contents loop would work but create N commits
where the API offers one. GitHub Enterprise stays unsupported for the same reason as D-073.

**Consequences.** A project created or edited in the IDE can be published to GitHub, GitLab or
Gitea/Forgejo from the tab, onto a new branch by default. It is not a git client: there is no pull
or merge, the local commits the SCM panel made are not replayed (what is published is the working
tree, hashed the way git hashes it), executable bits are not preserved, and a single file over
40 MB or a project over 200 MB is refused. `isomorphic-git` stays local-only.

### D-079 — Real git runs over HTTPS through a stateless, logging-free proxy
**Status:** accepted (2026-11-01)

D-078 made the IDE *publish* through the hosts' REST APIs, and that is not a git client: no
clone with history, no fetch, no pull, no branches, no merge. The requirement is full git over
HTTPS (SSH is not required). The blocker is CORS, not the protocol: measured on 2026-11-01,
`github.com` (401), `gitlab.com`, `gitea.com` and `codeberg.org` (200) answer git smart-HTTP
requests with no `access-control-*` header at all, and their preflights are rejected. A tab
therefore cannot reach a git endpoint directly, and no client-side trick changes that.

**Decision.** Speak real git in the tab, through one stateless proxy hop.

- **The proxy** (`ide/git-proxy/handler.mjs`) is a Worker- and Node-compatible `fetch` handler
  mounted at `/git-proxy/<host>/<path>`: it forwards to `https://<host>/<path>` and adds the
  CORS headers the missing upstream does not send. The hosted IDE gets it on its own origin as
  a Cloudflare Pages Function (`ide/functions/git-proxy/[[path]].ts`), so the browser needs no
  CORS at all and `connect-src 'self'` already covers it; `pnpm ide:dev` gets the same handler
  as Vite middleware (`ide/vite.git-proxy.ts`); a self-hosted deployment runs
  `scripts/dev/git-proxy.mjs` (the same handler in an `http.Server`) and points
  `projects.gitProxy` at it.
- **It saves nothing and logs nothing.** No storage, no cache, no cookies, no per-request output
  (no `console` at all), and request bodies are never read or buffered: bodies and responses are
  streamed through, the token in `Authorization` only transits memory and is never echoed or
  logged. Forwarded request headers are an allowlist (`authorization`, `content-type`, `accept`,
  `user-agent`, `git-protocol`); `origin`, `referer`, `cookie` and the proxy's own headers are
  dropped. Upstream is always HTTPS, and the upstream host must be on the deployment's allowlist —
  no wildcard, and loopback/private hosts are not in the defaults (an allowlisted loopback would
  turn the proxy into an SSRF ladder into its own network).
- **The client** is `isomorphic-git` (already a dependency for the local SCM): `ide/src/vv/git-http.ts`
  is the http plugin that rewrites `https://<host>/<path>` to `<proxyBase>/<host><path>`, and
  `git-remote.ts` adds clone (full history), fetch, pull (fast-forward only), push and
  ahead/behind, over the same VFS adapter the SCM panel writes with. `git-remote-session.ts` is
  the panel's store. Tokens are per operation, passed to `onAuth`, never stored (D-073's rule);
  the author identity stays the local one (`git-config.ts`).
- **Import and publish become real git.** A git clone keeps `.git`, so the Source Control and
  remote panels work on the project immediately; the D-073 REST importer and the D-078 REST
  publish remain available where no proxy exists (a bare static host) and are offered only as
  that fallback.
- **Deployment.** `projects.gitProxy` is `"same-origin"` in the open profile and `null` in a
  managed build; enabling real git in a managed build is an operator decision (`exports.git` for
  push-only, which is the managed default, since `imports.git` stays false there) and a
  cross-origin proxy must be listed in `network.connect` because the CSP is what reaches it.
  With no proxy the whole remote half is stubbed out of the bundle (`vite.deployment.ts`), and
  `environment.json` records `gitProxy`.

**What "full git" does and does not mean.** HTTPS only: SSH needs raw TCP, so it would need a local
relay/agent and is out of scope. Clone/fetch/pull/push, branches, lightweight tags, history and
commits are real; LFS and submodules are not implemented by isomorphic-git; a diverged pull is
reported as a conflict instead of a 3-way merge in this change (merge and rebase are follow-ups);
a single pack is bounded by the host's and the proxy platform's request limits.

**Rejected alternatives.** A local helper/agent would give SSH, real merge and LFS, but it is an
install step on every employee's machine — the option to revisit if SSH becomes a requirement. A
third-party public proxy (cors.isomorphic-git.org and friends) would put every token in someone
else's logs. Emulating git through the REST APIs (D-078) is not git, which is the objection that
started this change.

**Consequences.** `ide.facilis.dev` gets real git with no extra infrastructure; a self-hosted
static deployment must run the reference proxy (one `node` process, no state to back up) and
declare it. The proxy operator is inside the trust boundary for the duration of a request, so the
same-origin Pages Function is the recommended shape and a company proxy should live in the
company's own network.

### D-080 — An empty repository is populated with the Facilis project, not left empty
**Status:** accepted (2026-11-01)

D-079 made real git work, but the most common "start on GitHub" case still dead-ended: a
repository created empty — or holding only a README — clones to a folder with no
`package.json`, so there is nothing to run, no manifest, and the user had to create a project
somewhere else and re-point a remote at it.

**Decision.** Treat an empty clone as a place to start, not as a failure.

- **Detect, don't clone nothing.** `cloneRepo` asks the remote for its refs first. When it
  advertises none, there is nothing to fetch and no HEAD to check out, so the IDE initialises
  git locally on the remote's advertised HEAD (`main` when it does not say) and keeps
  `origin` — the folder is a valid, empty repository with the right remote (D-080).
- **Offer the one template.** After a clone whose tree has no `package.json` (empty or
  README-only), the IDE offers to write the Facilis project into that folder. The same action
  is a palette command (`Create a Facilis project in this folder`), so it is reachable without
  a clone. Scaffolding writes the template's files only where nothing exists: an existing
  README is kept, `.git` is untouched, and the run manifest is registered so Run works.
- **No automatic commit.** The scaffold is left as a change in Source Control: the user reviews
  it, commits and then pushes with `Remote git` (D-079). Auto-committing would both invent the
  first history entry and hide the files from review.

**Consequences.** An empty repository goes clone → create project → run → commit → push without
leaving the IDE, and a README-only repository keeps its README. The detection costs one
`getRemoteInfo` round trip per clone (it is also what distinguishes an empty repository from an
unreachable one, which must still fail loudly). In a managed build the clone is unavailable
(`imports.git` stays false), but the palette action still populates an empty folder with the
sanctioned project, which is exactly the admission contract.

### D-081 — Git authentication is HTTP Basic: a token, or an account password where the host still allows one
**Status:** accepted (2026-11-02)

The dialogs asked for a "token" only, which read as if username/password were impossible. In
fact the transport is HTTP Basic: isomorphic-git builds one Authorization header, and the proxy
forwards it untouched. What differs per host is only whether an account password is accepted as
the password half.

**Decision.** Keep the token as the recommended credential, and accept an account password on
the hosts that still allow it.

- **Same field, two meanings.** The secret field takes a token; when a username is also given it
  is treated as that account's password (`normalizeGitSecret` in `git-provider.ts`). It is still
  per operation, never stored, never in a URL or a log.
- **Username is the switch.** The `Remote git` dialog already had an optional username; the
  import dialog now has the same field in a deployment with the proxy. Without a username the
  host's token-as-password default username (D-079) is used, so a token needs no username.
- **GitHub is token-only.** GitHub removed account-password authentication for git in 2021, so
  its copy says so; GitLab, Gitea/Forgejo and self-hosted hosts accept a password when the
  account has no 2FA, and their copy says the username is required.
- **The REST fallback stays token-only.** Publishing and the CORS-based import use the host's
  API with a token (`PRIVATE-TOKEN`/bearer); a password is never sent there, and a real-git
  clone that fails while a username is set reports the clone error instead of retrying via REST.

**Rejected alternatives.** A separate "password" field would imply the two are different wire
formats; they are not. Asking GitHub for a password would be a dead end, so the UI never labels
the field as password-only. OAuth device flow would avoid long-lived secrets, but it is a
per-host authorization dance and a follow-up, not a replacement for a token.

**Consequences.** Users of hosts that still accept passwords can authenticate without minting a
token; everyone else uses a token, which remains the recommendation (scoped, revocable). The
proxy operator sees the credential transiently either way — the same trust boundary as D-079 —
and no password is stored by the IDE.

### D-082 — GitHub sign-in uses the OAuth device flow; the other hosts keep a pasted token
**Status:** accepted (2026-11-02)

D-081 made a token or password the only way in, which left a 2FA GitHub account with the
token dance and everyone with a secret to paste. The proposal was "send the user to the host,
run OAuth, come back with the token". That works for GitLab and Gitea/Forgejo (public client
plus PKCE) and not for GitHub: its authorization-code exchange requires the client secret,
which a static SPA cannot hold.

**Decision.** Sign in to GitHub with the device flow. Keep the pasted token as the path for
GitLab, Gitea/Forgejo and for users who prefer a PAT.

- **Why the device flow.** GitHub documents it for public clients: the tab asks for a code,
  the user enters it at `github.com/login/device` (where 2FA lives), and the tab polls for the
  token. No client secret, no extra server, no redirect URI, no CORS header.
- **Same proxy.** The two OAuth endpoints are on github.com and send no CORS headers, so the
  existing stateless proxy carries them exactly as it carries git. No new host, no new route
  family, nothing stored or logged.
- **Configuration belongs to the deployment.** `projects.gitOAuth.github.clientId` names the
  OAuth app (public client id only) and is off by default; it requires `gitProxy` and an
  enabled direction, and a managed build may enable it for push-only. Without it the dialogs
  keep asking for a token.
- **The token is per tab, in memory.** No localStorage, no OPFS, no cookie; closing the tab or
  signing out drops it. The token field stays editable, so a PAT still works, and the REST
  fallback keeps using the token it is given.
- **Scope.** `repo` is the only GitHub scope that covers a private clone/push; GitHub has no
  read-only private scope, so the consent screen says so and the token remains revocable.

**Rejected alternatives.** The redirect code flow for GitHub needs the client secret in the
SPA (or a new token-exchange endpoint holding it): a server secret and a stateful piece in a
design whose proxy is deliberately stateless. OAuth for GitLab and Gitea/Forgejo with PKCE is
possible, but their tokens are short-lived with refresh tokens and the same token field already
works; that is its own project (D-081). A GitHub App token is finer-grained but still needs a
server-side exchange or the device flow, for the same UX.

**Consequences.** A 2FA GitHub account signs in without minting a PAT; the device code is the
only thing shown, and the second factor never reaches Facilis. The OAuth app is registered
once per deployment with device flow enabled; its client id is public. The proxy operator sees
the token in transit as with a PAT (D-079). GitLab, Gitea/Forgejo and self-hosted hosts are
unchanged: username/password where the host allows it, token otherwise.

### D-083 — The Entity Explorer reads the live database through pg_catalog and diffs it against `db/schema.ts`
**Status:** accepted (2026-11-02)

SPEC §11.1 asks the Studio to show the schema `db/schema.ts` declares against the database
the running project actually has, and to make the drift visible. The manifest is not enough:
its `schema` section is a projection of the code, so it can never say what the database
thinks. Reaching PGlite straight from the SPA would violate SPEC §11.2 and invariant 5, and
the dev server has no endpoint that answers the live side.

**Decision.** Add one dev-only endpoint and one pure diff, and render them in a new sidebar.

- **Endpoint.** `GET /__facilis/dev/schema` is registered only when `nitro.options.dev` is
  true and guarded by `guardDevRequest` (404 in production, 403 on an origin mismatch), like
  the manifest (§6.8/§11.4). It answers `200 { code, live, drift, warnings }` and
  `503 { code: "db_unavailable" }` when the runtime has no usable database. The db comes from
  `getBootstrap()`; the route imports only `@facilis/db` and never a raw Drizzle client.
- **Introspection lives in `@facilis/db`.** `liveSchemaSnapshot` reads `pg_catalog`
  (`pg_class`/`pg_attribute`/`pg_attrdef`/`pg_index`/`pg_policies`), not `information_schema`:
  `format_type()` renders types comparably, `pg_get_expr()` the defaults, and RLS/policies
  have no `information_schema` equivalent. Tables are limited to `current_schema()`, and the
  migrator's bookkeeping table is excluded — otherwise it would be permanent drift.
- **The diff is a pure, typed function.** `diffSchemaSnapshots(code, live)` returns
  `SchemaDrift[]` with a discriminated `kind`: table/column missing or extra, column type or
  nullability, `rls_disabled` on a scoped table, and policy missing/extra/changed. The Release
  Preview (§11.3, code↔live lens) can reuse it. Column types are canonicalised (Drizzle's
  `varchar(120)`/`serial` vs the catalog's `character varying(120)`/`integer`) and policies are
  compared by a normalised signature (command, restrictive/permissive, normalised qual/check)
  because Postgres re-renders qualifiers.
- **Sidebar.** A new `data` activity view (`appShell`), fed through the preview-proxy base like
  the manifest client: tables with columns (type, PK, not-null), an RLS badge (policy defined /
  RLS on without policy / RLS off, red when the table is scoped), the drift list, and "used by"
  from `RouteMeta.dbTables`/`dbColumns`. Clicking a table opens `db/schema.ts`, a route its
  `sourceFile`. Manual refresh plus a refetch on the 60-byte revision poll. `policy_extra` is a
  warning of its own: a policy in the database but not in code is a security drift.

**Rejected alternatives.** Introspecting PGlite from the panel (violates §11.2 and invariant 5).
`information_schema` only (no RLS/policies and types need hand-maintained maps). Comparing raw
policy SQL (systematic false positives). Exposing the endpoint in production (§8.5). Showing the
migration tracking table as a normal table (permanent drift).

**Consequences.** Every request recomputes both snapshots and runs two catalog queries — there is
no cache; an open panel only pays the 60-byte revision poll. The response envelope is an additive
contract; the IDE client narrows it at the boundary like the manifest and ignores unknown drift
kinds. Custom/enum type names and unusual Postgres predicate rewrites can still produce a
`column_type`/`policy_changed` false positive; the tests pin the renderings `rls.ts` generates.
No new dependency; strings are in `en`/`it`.

### D-084 — The AI patch validator enforces the 16 rules, with rule 1 injected and the project context built by the caller
**Status:** accepted (2026-11-02)

D-046/D-047 left the validator at the structural checks (path + content present) and deferred the
16 rules of SPEC §9.3 to Phase 4; invariant 9 says a patch must pass the validator before it
touches disk. The rules need things the structural gate never had: a TypeScript parser, the
config (roles/permissions), the code schema plus the tables the patch adds, `locales/en.json`, the
block manifests, the existing routes and import resolution. `@facilis/ai` is imported by the
IDE's browser bundle, so the main entry cannot import a compiler.

**Decision.** Keep `@facilis/ai` browser-safe and synchronous, and push the two async inputs to
its edges.

- **Typed context.** `validatePatch(patches, { context, requiresConfirmation, allowedRootFiles })`
  stays synchronous and takes a `PatchContext` assembled by the caller with
  `buildProjectContext(files, sources, manifest)`: `facilis.config.ts` (source authoritative, the
  manifest as fallback), `db/schema.ts` (tables/columns/policies/RLS merged with the manifest's
  live schema), `locales/en.json` merged with the manifest catalogue, the block manifests and
  routes, and `package.json`/`tsconfig.json` paths for imports. The patch is overlaid on that
  context once (`overlay.ts`), so every rule reads the post-patch world, including the tables and
  permissions it removes.
- **Rule 1 is an injected seam.** `SyntaxChecker` is supplied by the caller: the IDE passes
  Monaco's TypeScript worker (`getSyntacticDiagnostics` on a disposable in-memory model — no
  project model is swapped, open buffers are never touched), and Node tooling imports the
  `@facilis/ai/node` subpath, which uses rolldown/oxc's `parseSync` (the same parser as
  `@facilis/nitro`'s AST pass; dev-only, never in the browser bundle). A missing or throwing
  checker fails the rule closed — a silent skip would defeat the gate.
- **Rule 11's allowlist** is the six project roots plus `facilis.config.ts` (rule 16 needs it).
  Root `AGENTS.md` is writable only by the IDE's own instructions writer through the explicit
  `rootFiles` list, never by an AI patch.
- **Three validation points.** Proposal time (`parseTurn`: no proposal exists if the rules
  error), Apply time (`applyAccepted` re-validates the accepted files with a fresh context), and
  `applyPatch()` itself re-validates before the first `vv-write`. Undo is deliberately not
  re-validated: restoring a before-image must not be blocked by the rules it rolls back.
  Rules 5, 13 and 14 stay warnings; the rest block.

**Rejected alternatives.** The TypeScript compiler API: the workspace pins TypeScript 7 (the
native port), which no longer exposes the JS compiler API; its only API wants an on-disk
snapshot and a native language service — too heavy and fragile for the rule-1 test. Semantic
type-checking in the browser by swapping Monaco's project models: risks open buffers/undo and
produces false `TS2307` for files a patch creates and imports itself; type errors stay the
editor's language service. A JS parser inside the main entry: breaks browser safety. Validating
only on Apply: the card would show proposals that cannot be applied. Allowing any root file:
lets a patch rewrite `package.json` or the README.

**Consequences.** The managed AI gate (AI-SKILLS §4) can rely on the blocking rules 1–4, 6–12,
15–16; secret scanning and a `package.json` policy remain future rules. The validator scans text
rather than a full AST, so pathological route files can evade metadata checks; i18n covers
static `t()` keys and the `en` catalogue only; migration detection is the presence of a created
`.sql`; destructive detection covers tables/columns; the cross-checks against existing routes
need a reachable manifest. Validator warnings are carried in the proposal state but not yet
rendered in the UI (follow-up). Rule 1 runs against the editor's TypeScript service, which the
editor tears down and re-creates when the project's dependency types finish loading: a request
that lands in that window never answers, so the checker bounds every attempt (2.5 s) and retries
across the restart, and a validation round bounds the manifest fetch (3 s) — a cold project can
delay a proposal for a few seconds but can never leave the turn streaming; a service that never
answers still fails closed. At publish time (O-006) the Node subpath will need rolldown as a
real dependency or an injected checker. The retry loop (§9.4) is not implemented; `parseTurn`
and `fix_hint`/`excerpt` are its seam. Cost: one context read plus one manifest fetch per
validation round, and three rounds per Apply.

**Verification.** 48 `@facilis/ai` tests (a suite per rule group, a realistic fixture project,
rule 1 rejects invalid TS and accepts valid TS through rolldown) and 523 IDE tests with no
regressions; `pnpm typecheck`, `pnpm lint` and the file-length/theme checks are green. The real
browser path is green end to end on a fresh profile: `pnpm ide:smoke` drives the mock provider
through rule 1 (the actual Monaco worker), the proposal card, Apply, the VFS write and Undo.

### D-085 — The API Flow reads the AST-augmented OpenAPI document and renders it with React Flow
**Status:** accepted (2026-11-02)

SPEC §10.2 and §12 Phase 3 ask for an API visualizer: the project's API as a graph, with
click-to-jump into the route source. The facade built in Phase 0/1 already publishes what the
graph needs — `/_openapi.json` merges the AST pass's `x-permission`, `x-db-tables`,
`x-db-columns` and `x-facilis-source` onto Nitro's native document (SPEC §6.9) — but nothing
rendered it. The Entity Explorer (D-083) established the read pattern: a dev-only endpoint
reached through the preview proxy, narrowed at the client boundary, shown in a new sidebar.

**Decision.** A new `api` activity view backed by React Flow, without a new backend surface.

- **Transport.** The panel fetches `GET <preview-proxy-base>/_openapi.json` with the same
  throw-free client shape as the manifest and schema clients, refreshes on the 60-byte revision
  poll and on demand, and renders "unreachable" instead of taking the editor down. The facade is
  dev-only (404 in production), which is the same availability the other panels have.
- **Model.** A pure module turns the operations into a deterministic layered graph: one node per
  operation grouped by resource (the first path segment), one node per table, an edge
  operation→table from `x-db-tables` (and from `x-db-columns` prefixes for routes that only name
  columns). Layout is computed, not random, so the graph is stable across refreshes and testable
  without a DOM.
- **Interaction.** Clicking an operation node opens `x-facilis-source`; clicking a table node
  opens `db/schema.ts`. Method and permission badges are read from the operation; a route whose
  metadata the AST pass could not resolve simply shows fewer badges (the facade omits the field,
  it never guesses).
- **React Flow is the dependency SPEC §10.2 names** (`@xyflow/react` 12.12.1, 19 packages in the
  lockfile). The node components are ours and use only semantic Tailwind role tokens, so theme
  blocks flip them (D-043/D-044).

**Rejected alternatives.** A hand-rolled SVG layout: more code, no pan/zoom/fit, and it would
replace a dependency the spec already committed to. Fetching the manifest instead of the OpenAPI
document: the manifest's route list has no operation summaries or permission metadata from Nitro,
and the visualizer is specifically the API contract. A new editor tab kind: the tab strip is
typed for file kinds (`text`/`image`/`directory`/`diff`/`notebook`), and every Facilis visualizer
now lives in the activity bar (D-083 precedent) where it can be resized.

**Consequences.** New dependency in the IDE bundle (React Flow is lazy-loaded by the view only when
opened, like the other panel chunks). Routes without `x-facilis-source` are listed but not
clickable; routes whose metadata the AST pass marked unresolved show no permission/table badges.
Strings are in `en`/`it`; the panel has unit tests for parse, model and transport, and the browser
smoke opens it and waits for nodes.

**Verification.** 19 IDE tests (parse 6, model 7, transport 6) cover the `/_openapi.json`
narrowing, the deterministic graph model and the throw-free fetch; the IDE's i18n parity suite
includes the new block. `pnpm lint`, `pnpm typecheck` and `pnpm build` are green, and
`pnpm ide:smoke` on a fresh profile opens the `api` activity view, waits for route and table
nodes, clicks a route node and reaches its source file.

**Amended by D-087:** the panel is an editor-area tab, not a sidebar activity view, and it also
shows the client pages that call each route.

### D-086 — Release Preview is a pure snapshot diff; the Studio reads the refs from the git tree instead of booting them
**Status:** accepted (2026-11-02)

SPEC §7.7 declared the `ReleasePreview` contract and SPEC §11.3 asked for four diff lenses, but
no engine existed (the types shipped with a "engine lands in Phase 3.5" note) and O-008 left the
boot strategy open (sequential boots vs `?at=<oid>`). `@facilis/db` cannot host the browser-side
engine: it imports PGlite/Drizzle, and the Studio must never reach the database directly (§11.2).
Booting the project at an old commit to introspect it would be slow, would mutate the VFS and
would tie the preview to the runtime being healthy.

**Decision.** A pure engine over snapshots, and snapshots read from the git tree.

- **Engine.** `buildReleasePreview({ from, to, before, after, inUseRoutes?, pendingMigrations? })`
  in `@facilis/core` (browser-safe, no I/O) returns the SPEC §7.7 `ReleasePreview`: schema
  statements with risk, schema summary, API diff, security diff, breaking changes and warnings.
  It is the one engine behind all lenses and is reusable by the Model B `get_release_preview`
  tool (§9.5).
- **Schema lens.** The schema statements are the migration files that ship between the two refs,
  split tolerantly (quotes, comments, dollar-quoted bodies) and classified statement by statement:
  `CREATE TABLE`/nullable `ADD COLUMN`/`CREATE INDEX`/`CREATE POLICY` safe; non-null without
  default, UNIQUE, renames, constraints, policy alterations careful; drops, type/nullability
  changes and RLS disable destructive. A drop becomes `breaking` when a route still references the
  table or column via `x-db-tables`/`x-db-columns` (the cross-check SPEC §11.3 asks for).
- **Other lenses.** API diff compares method+path across the refs and flags changed known fields
  (permission, dbTables, sourceFile). Security diff compares declared policies per table and
  reports RLS disabled on scoped tables; a policy whose SQL lost its `current_setting()` scope is
  a `policy_broadened` change. The working-copy lens finally feeds the code↔live drift from
  D-083's endpoint as the fourth view §11.3 lists.
- **No boots (resolves O-008).** The Studio reads `db/schema.ts`, `server/routes/**` and the
  migrations out of the VFS at `HEAD`/`origin/main`/tag with isomorphic-git (already a dependency,
  D-019) and parses the declarations with a tolerant text parser. Migrations are the source of
  schema statements, so the preview describes what will actually execute. The working-copy lens
  reads the live VFS through the controller and merges the manifest's routes for metadata.
- **Contract amendment.** `ApiDiff.changed` now matches §7.7 (`{ before, after, fields }`;
  the placeholder was an array). `ApiRouteRef.dbTables` is optional because a route derived from
  a filename at an old ref cannot know the handler's tables; an omitted field means "unknown at
  this ref", never "no tables". Both are documented on the type and in §7.7.

**Rejected alternatives.** Boot each ref (O-008's sequential-boots option): slow, mutates the
VFS, needs a healthy runtime, and fails exactly when the preview matters most (a broken ref).
Put the engine in `@facilis/db` (SPEC §5.2's original location): it cannot run in the browser
bundle. Parse the TypeScript AST to recover `defineAuthorizedHandler` metadata at each ref: the
AST pass is Node-only and the routes' known metadata already comes from the manifest for the
working copy; method+path is enough to diff the API surface. Synthesize `CREATE TABLE` SQL from
the declared schema: the preview must show the SQL that ships, not invented SQL.

**Consequences.** No schema boot, no database dependency in the panel; the engine is deterministic
and cheap, and the panels pay only the git/blob reads when opened. Limits are declared: column
types and renames surface only through migration SQL, so an un-migrated schema edit is caught by
the code↔live lens rather than the summary; a ref-derived route knows only method+path; policy
clause changes need both sides to carry policy SQL; `origin/main` exists only after a fetch, and
the remote lens says so instead of guessing. The working-copy card has no source for "has the
target database applied this migration?", so `pendingMigrations` stays an engine input the panel
does not fill yet; the code↔live drift is the card's signal.

The browser-safe subpath forced one contract detail. `SecurityDiff`/`PolicyChange` carry a
structural `ReleasePolicySnapshot` declared in `release.ts` instead of `@facilis/db`'s
`PolicySnapshot`: even an `import type` from the db pulled `@types/pg` (and through it
`@types/node`) into the Studio's browser program, where the Node and DOM `ReadableStream`
typings collide and the vendor kernel stops typechecking. The shapes are identical, so values from
`@facilis/db` stay assignable. For the same reason the IDE's `@types/node` was aligned to the
workspace catalog (22.20.5) instead of its own 24.x pin: two Node typings produced two Vite
instances and broke `@facilis/nitro`'s build. The engine file was split across
`release-preview`/`release-sql`/`release-classify`/`release-breaking`/`release-security`/
`release-api` to stay under 300 lines.

**Verification.** 92 `@facilis/core` tests (31 new: splitter 3, classifier 20, engine 8; the
contract test still pins §7.7) and 562 IDE tests (19 API Flow + 20 Release Preview + the i18n
parity suite). The engine rejects/classifies statements, lifts drops to breaking on route
references, diffs policies and RLS, and reports pending/destructive/policy warnings. `pnpm lint`,
`pnpm typecheck` and `pnpm build` are green; the browser smoke opens the Release Preview, renders
the working-copy lens and switches it. The git-reading adapter has its own unit test against a
real temporary repository (HEAD, tag, old commit, missing ref, non-repo), so only the VFS fs
adapter itself is smoke-only. `pnpm ide:smoke` on a fresh profile opens the Release Preview after
the chat/write steps (so the project has git history), renders the content and switches to the
working-copy lens; the full run is green.


### D-087 — The API Flow moves into the editor area and shows the client consumers of each route
**Status:** accepted (2026-11-02)

D-085 put the API Flow in the sidebar. At the Explorer's 16% width a 7-route graph already
rendered unreadably: the node cards grew past their fixed row height and overlapped, and the
canvas had no room for pan/fit. The panel also only showed the server side — the routes and the
tables — so the question the graph exists to answer, "which page calls this API?", was not on
screen. SPEC §10.2 had originally called for a new tab kind; the sidebar was the shortcut.

**Decision.** Make it a real editor-area tab with pages on the left, and scan the project for
the files that call each route.

- **Editor tab, not a sidebar view.** A synthetic `vv-api-flow` tab (no backing file, like the
  diff tab) rendered by `EditorGroup`; the ActivityBar button opens/focuses it and its title is
  the translated "API Flow". The sidebar branch and the `api` activity view are gone, so there
  is one surface per panel. The tab is closed/reopened like any other tab, and the synthetic
  helpers live in `vv/synthetic-tabs.ts` because the controller is pinned by the file-length
  ratchet. Release Preview stays in the sidebar: it is a list/diff view, not a graph.
- **Three columns, fixed sizes.** Pages (client files) on the left, routes in the middle,
  tables on the right. Routes are split over up to four vertical lanes (resources are packed
  greedily so the lanes stay even) instead of one very tall column that fitView turns into a
  thumbnail. Node rectangles never share a slot: the layout stacks rows from exported
  `FLOW_NODE_SIZE` values, a unit test asserts no two node rectangles overlap, and the graph is
  fitted on open/refresh (a ResizeObserver refits it when the window or the side panels change).
- **Consumers.** The panel reads the project's `src/**` files from the VFS (bounded: 300 files /
  300k chars) and `scanApiConsumers` matches literal `/api/…` references to the operations:
  direct references, template literals matched by their static prefix, a one-hop import graph
  (alias `@/` and relative) so pages that call `src/lib/api.ts` are attributed to the routes,
  and dynamic segments matched against `:id`/`[id]`/`{id}`/`*`. Page nodes are connected to
  their routes (dashed when the link is indirect); a route no file references is flagged
  "unused".
- **Inspector + list.** Clicking a node opens a right-hand inspector overlay with permission,
  tables, source file and the consumers list; "Open file" jumps to the route/page/table source.
  A list toggle shows the same data as a compact table for projects with many routes, a filter
  narrows by path or method, and one focus control hides the sidebar, the preview and the
  bottom panel so the graph gets the window back (the panel does not force that state).

**Rejected alternatives.** Keeping the sidebar and only fixing the layout: 300 px is not enough
for a three-column graph, and the user asked for the center. A dock toggle center↔sidebar: it
needs two mounted surfaces and a persisted placement for a mode nobody has asked to keep; the
tab is closable, which covers "I don't want it open". A full AST pass for consumers: the IDE
would need the Node-only TypeScript parser; the one-hop text scan covers the template and is
cheap, and its limits are declared. Synthesizing consumer edges from stack traces or the dev
server request log: not available in a static build and not durable.

**Consequences.** The graph is readable at the center width and page→route→table flows read
left to right. The scan is textual, so an URL built dynamically, an import chain longer than one
hop, or a consumer outside `src/` is missed; "unused" is a hint, not a proof, and the UI says
so. The scan re-runs only when the project's revision changes (or on refresh), and the file read
budget bounds its cost on large projects. Synthetic tabs are not restored across a page reload
(no open tabs are), and the tab is not draggable to the sidebar. The i18n block grew by the
inspector/list strings, still spread from en/it-api-flow.ts. Uncovering focus mode exposed a
latent AppShell race: restoring a collapsed sidebar ran the auto-widen effect before the
resizable-panels layout had registered, and `panel.getSize()` threw "Layout not found" and took
the shell down. The effect now defers to the next frame and retries a few times.

**Verification.** 10 consumer-scanner tests (direct, template, dynamic segment, alias/relative
import, prefix-only-if-dynamic, ignored dirs, dedupe, unused) and 10 model tests (ordering, three
columns, pairwise non-overlap, page nodes/edges, consumer data, table usage, determinism,
warnings); the IDE suite is 575 tests. The full gate set is green, and the browser smoke asserts
the panel lives inside the editor group (center, not sidebar), that route/table/page nodes render,
that focus mode hides the side panels and widens the graph past 500 px, that selecting a route
opens the inspector and its "Open file" reaches the route source, and that the list toggle
switches the view.

### D-088 — The Source Control panel opens a commit graph as an editor-area tab
**Status:** accepted (2026-11-02)

The SCM panel (inherited from Vivari) shows a flat, 20-commit History list. A repository
now really has branches, merges and — since D-079/D-080 — remotes, so the one question the
list cannot answer at a glance is "how do these branches relate?". The IDE already carries
React Flow (`@xyflow/react`, D-085) and the synthetic-tab mechanism D-087 built for the API
Flow, so a graph needs no new dependency and no new surface type.

**Decision.** Add a `commit-graph` editor tab, one per repository, opened from a git-fork
button in the SCM panel's repo header, and draw the local object graph with React Flow.

- **Local-only read.** A new `CommitGraphSession` reads the repository through the same
  `GitFs` + isomorphic-git path as `ScmSession`: `listBranches` + `resolveRef` for the
  branch tips, `currentBranch` for HEAD, and `log` per ref (default 60 commits per ref,
  200 total, deduplicated by oid, newest first). There is no network, so the tab works
  offline and in a managed build exactly like the SCM panel; no deployment profile gates it.
  The shared lazy isomorphic-git + Buffer loader moved from `scm-session.ts` to
  `vv/git-api.ts` so both readers use one import.
- **Pure layout.** `facilis/commit-graph-model.ts` is React-free and git-free: it assigns
  lanes gitk-style (a commit continues the lane waiting for its oid, a merge opens a lane per
  extra parent, freed lanes are reused) and exports the node/edge/position types plus
  `GRAPH_LAYOUT`, so the canvas only renders. A commit whose parent fell outside the read
  limit simply loses that edge.
- **The tab.** A synthetic `vv-commit-graph:<root>` tab (helpers in `synthetic-tabs.ts`,
  because the controller is pinned by the file-length ratchet) rendered by `EditorGroup`;
  the tab label is the repository's name and the tooltip is its path. Cards show the subject,
  short oid, author, date, the branches pointing at the commit and a HEAD badge on the current
  branch; lane colours cycle five theme roles, never raw palette values (D-043/D-044). A
  details inspector shows the full hash and lets a branch badge check that branch out through
  `ScmSession.checkoutBranch` (shared busy/error channel with the panel).
- **Refresh on HEAD, not on status.** The graph loads on open and on refresh, and reloads when
  the SCM snapshot's HEAD signature (`branch:tip oid`) changes — a commit or a branch switch
  shows up without pressing anything, while ordinary status walks do not trigger a git log.
- **Focus.** The same one-click focus control as the API Flow (hide sidebar, preview and bottom
  panel) because a lane graph needs width.

**Rejected alternatives.** A sidebar graph: D-087 already established that a graph at 16% width
is unreadable. A bespoke SVG implementation: React Flow is a dependency, its theme bridge
already exists, and a second canvas would duplicate pan/zoom/fit. Reading the log during every
status refresh: it contends with the terminal on the kernel worker thread for a panel opened
rarely. Persisting the tab across reloads: no synthetic tab is restored today, and restoring one
would need a project/root lookup at boot. A server-side graph: there is no server; the git proxy
is a stateless pass-through and never inspects a repository (D-079).

**Consequences.** Branches and merges are visible at a glance and readable at center width. A
deep history is silently truncated at the read cap (no "load more" yet), and the tab is read-only:
every write (commit, checkout, discard) stays in the SCM panel. `scm-session.ts` and
`controller.ts` did not grow: the shared git loader moved out and the diff editor moved to
`vv/diff-session.ts` (D-089) to pay for `openCommitGraph()`.

**Verification.** 10 model tests (linear, merge, branch/HEAD marking, truncation, determinism,
non-overlap, lane reuse, empty input) and 7 session tests (branch-log merge, detached HEAD,
depth/limit, missing repository, error wrapping); the IDE suite is 595 tests in 78 files. A
browser run on a project with four commits over two branches renders 4 nodes, 3 edges and 2
lanes: the repo-header button opens the tab, HEAD and branch badges and the details inspector
are present, focus widens the canvas from ~700 px to 1136 px, and commits and branch switches
appear without a manual refresh. No page errors, no failed requests; full gate set green.

### D-089 — Clicking a Source Control change always shows a diff, with the first hunk revealed
**Status:** accepted (2026-11-02)

Clicking a change in the SCM panel sometimes looked like it did nothing. Two independent causes:
untracked files (which is every file of a fresh repository before the first commit) were routed
to the plain editor, so there was no diff to show; and Monaco's diff editor opens at line 1 and,
below roughly 900 px of editor width, silently falls back to inline mode and hides the original
pane. On a long file the change could be several screens below the fold, so the tab read as a
copy of the file.

**Decision.** Every change opens the HEAD ↔ working-tree diff, and the diff makes the change
visible.

- **Every row is a diff.** Both sections (staged and unstaged) and every letter now call
  `openDiff`; an untracked file diffs from empty and a deleted one against empty. A hover
  "open file" action on each row keeps one-click editing (`openEntry`), and the row keeps the
  path as its tooltip.
- **Always two panes.** `useInlineViewWhenSpaceIsLimited: false` in the diff editor: the inline
  fallback hides the original version, and comparing the two is the point of the tab.
- **Reveal the first hunk.** After `setModel`, `revealFirstDiff()` scrolls the first change
  into view, so opening the diff is independent of where in the file the change is.
- **Split for the ratchet.** The diff editor moved from `controller.ts` to `vv/diff-session.ts`
  (one instance, owns its throwaway original/modified models, disposal on remount), and the SCM
  panel was split into `SourceControlPanel.tsx` + `SourceControlRepoSection.tsx` +
  `SourceControlParts.tsx` so the baseline entry could be dropped. New strings live in
  `en/it-source-control.ts`; the diff tab label is translated too.

**Rejected alternatives.** Keeping untracked files on the plain editor and adding a "view diff"
command: the reported action is the row click, and every other git GUI treats it as "show me
what changed". Inline-only diffs: they hide the original. Revealing the hunk only for tracked
files: uniform behaviour is simpler, and a new file's hunk is line 1 anyway. Making the diff tab
editable: it is a read-only view by design (D-078/D-079 trust boundary), and the open-file
action is the edit path.

**Consequences.** The diff tab stays read-only; editing still goes through the editor or the
Explorer. At a narrow editor width the two panes wrap more (word wrap follows the editor setting),
which is the trade for always seeing both versions. Untracked rows now cost a diff tab instead of
a plain tab — the same click count, since the open-file action is on the row.

**Verification.** Browser run on a change at the end of a 62-line file: both panes mount (346 px /
347 px at 1440 px), the first change is line 62 and the revealed view covers lines 22–64, an
untracked file diffs from an empty original, and the row's open-file action opens the editable
text tab. No page errors, no failed requests; the IDE suite is 595 tests and the full gate set is
green.

---
## Open (do not block Phase 0/1; resolve before the noted phase)

| ID | Question | Proposed default | Needed by |
|---|---|---|---|
| O-001 | i18n key format: flat (`todos.title`) vs nested (`todos.form.title`) | **resolved in Phase 1: flat keys** (`t()` in `@facilis/core`, `locales/en.json`) | done |
| O-002 | Canonical API error-code registry | **resolved in Phase 1:** `FacilisErrorCode` union in `@facilis/core` (`unauthorized`, `forbidden`, `invalid_input`, `conflict`, `db_unavailable`, `not_found`, `internal_error`), serialized as `{ code, details? }` — no prose | done |
| O-003 | Tenancy: `users.tenantId` exists but no `tenants` table (spec §5.3 vs §8.4.2) | **resolved in Phase 1:** single-tenant deployment; tenant comes from `FACILIS_TENANT_ID` (`defaultTenantId` in the event context). A `tenants` table arrives only with multi-tenant | done |
| O-004 | Block discovery: `node_modules` scan vs explicit registration | scan `node_modules/*/manifest.*` (already assumed by revision hash) | Phase 5 |
| O-005 | Starter repo count (one todo template vs several) | one `starter/` todo template for MVP | Phase 6 |
| O-006 | Publish target for `@facilis/*` (public npm vs private registry) | start workspace-only; decide before first publish | Phase 6 |
| O-007 | Recommended default AI model | **resolved with D-045:** no enforced default; each provider preset carries an editable model default | done |
| O-008 | Release-preview boot strategy (sequential boots vs `?at=<oid>`) | **resolved with D-086:** no boot — the Studio reads the refs from the git tree with isomorphic-git and diffs parsed snapshots | done |
| O-009 | Validator rule 11 path allowlist vs rule 16 | **resolved with D-084:** the allowlist is the six project roots plus `facilis.config.ts`; root `AGENTS.md` only through the IDE writer's explicit `rootFiles`; rule 16 handles role/config sync via a migration in the same patch | done |
| O-010 | Auth schema drift: Drizzle (`tenantId` notNull) vs SQL seed PK/NOT NULL | reconcile in `@facilis/auth/db`; one source (Drizzle schema) generates the SQL | Phase 1 (auth) |

When an item is decided, move it to **Accepted** with a `D-0NN` entry and update
`docs/SPEC.md` if a contract changes.
