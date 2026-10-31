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
framework code depends on them (spec §12 Phase 0, §14.1).

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
Prototype + evidence: `spikes/phase0/` (REPORT §3).

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
`fix/runtime-esm-only-targets`); the `git am`-able patch, PR body and ticket draft live in
[`docs/upstream/`](./upstream/) (`vivari-esm-only-packages.patch`, `…-pr.md`,
`vivari-esm-only-packages.md`) and the PR is still to be filed. The template's 14-package pin
list is therefore redundant: dropping it and re-running `TEMPLATE=Facilis pnpm ide:smoke` is a
follow-up. Vite's `--configLoader`
does not help: all three modes externalise package imports (the default `bundle` loader
resolves every dependency to a file URL and marks it `external`), so no loader inlines
Nitro's dist, and `bundle` cannot run in the WebContainer anyway.

**Consequences:** the Facilis smoke is green end to end in the WebContainer — preview painted
(~36-40 s cold), `/__facilis/health` ok, `/__facilis/manifest` ok with **zero warnings**
(PGlite opened, migrations + seed + app role applied), `/_openapi.json` carries
`x-db-tables` for `/api/todos`, and an unauthenticated `/api/todos` returns 401. Upstream
work worth filing: the Vivari resolver fix drafted in
[`docs/upstream/vivari-esm-only-packages.md`](./upstream/vivari-esm-only-packages.md), the
Nitro RC that bundles the runtime (nitrojs/nitro #4701), and Vivari's
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

The generated tree already lives in `ide/src/facilis/` (`project-files`, `db-files`,
`server-files`, `client-files`) and the IDE template is the only consumer. `starter/`
gets created when O-006 (publish target) is decided and the packages are installable by
name; until then the template payload is the single source of truth.

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
reload. The fix is pinned through the fork (D-030, branch `fix/opfs-mirror-priority`); its
`git am`-able patch and PR body are in
[`docs/upstream/vivari-opfs-mirror-priority.patch`](./upstream/vivari-opfs-mirror-priority.patch)
and [`…-pr.md`](./upstream/vivari-opfs-mirror-priority-pr.md), and the upstream PR is still to be
filed. The Studio's writes, editor state, HMR and git are correct in-tab either way.

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
also helps the burst. Details and measurements:
[`docs/upstream/vivari-findings-2026-10-28.md`](./upstream/vivari-findings-2026-10-28.md) §4.

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
[`docs/upstream/README.md`](./upstream/README.md)). The fork's `master` mirrors upstream and carries
no commits of ours; each fix is also its own branch (`fix/…`) based on upstream `master` and is
proposed upstream as a PR from the fork. `.gitmodules` records the fork URL and
`branch = facilis/main`; the pin is a **commit**, so a checkout is reproducible. The submodule
worktree is never edited, so `git -C vendor/vivari status` is clean by construction.

Workflow (branch map in [`docs/upstream/README.md`](./upstream/README.md), dev recipe in
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
  `node:sqlite`, which the runtime does not serve (pnpm 10.34.9 does not even load — measured,
  [findings](./upstream/vivari-findings-2026-10-28.md) §6). A developer-facing IDE shipping a
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

**Verification.** `project-name.test.ts` pins the typed match; the controller path is one
awaited `vv-rm` after the same hydrate step `openProject` performs.

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
| O-008 | Release-preview boot strategy (sequential boots vs `?at=<oid>`) | schema-only `?at=<oid>` first, sequential behind a flag | Phase 3.5 |
| O-009 | Validator rule 11 path allowlist vs rule 16 | extend allowlist with root config files (`facilis.config.ts` — the one project config, `vite.config.ts`, a legacy `nitro.config.ts` if a project still has one, `package.json`, `locales/`, `lib/`, `components/`) and let rule 16 handle role-sync | Phase 4 (validator) |
| O-010 | Auth schema drift: Drizzle (`tenantId` notNull) vs SQL seed PK/NOT NULL | reconcile in `@facilis/auth/db`; one source (Drizzle schema) generates the SQL | Phase 1 (auth) |

When an item is decided, move it to **Accepted** with a `D-0NN` entry and update
`docs/SPEC.md` if a contract changes.
