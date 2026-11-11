# Decision log

ADR-style log for Facilis. The contract lives in [`docs/SPEC.md`](./SPEC.md); this file
records decisions taken **around** the spec (toolchain, conventions, ambiguities resolved)
so they are not re-litigated or lost.

Format: `D-0NN — title` · **status** (accepted / open) · context · decision · consequences.

**Reading guide.** Start with the newest entries (D-142…D-167); the rest is history that still
explains the current code. A handful of decisions are superseded by a later one — D-017
(→ D-018/D-019), D-018 (→ D-030), D-022 (→ D-032), D-055 (→ D-090, then D-096), D-085/D-087
(→ D-095), D-151 (→ D-156) — and D-086/D-143 were amended by D-158/D-159 and D-149,
D-032 was completed by D-164/D-166, while D-157 was extended to jobs by D-162. The "Open items" table at the end lists what is still
undecided.

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
`@facilis.dev/blocks`/generated pages. The spec/README wording "Radix UI" was replaced
accordingly (§2.1, §5.4, README).

**Consequences:** styling is Tailwind utility-first; `@facilis.dev/blocks` assume Tailwind is
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
by spec §13 risk 3 is therefore **adopted as the design**: `@facilis.dev/nitro` ships a
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
the GUC is `''`, and `''::jsonb` throws). Spec §8.4.5 updated; `@facilis.dev/db`'s RLS
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

**Consequences:** `@facilis.dev/nitro` implements the plain-object module; the spec snippets are
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

Phase 1 is split into four disjoint write scopes (one shared task each): `@facilis.dev/core`,
`@facilis.dev/db` + `@facilis.dev/auth`, `@facilis.dev/nitro`, and the `studio/` fork. Module boundaries
and exact public APIs are fixed in `docs/archive/PHASE1-CONTRACTS.md` so the packages can be built in
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
and `@facilis.dev/nitro`/`@facilis.dev/db` always consume the resolved shape.

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
(`@facilis.dev/nitro/vite` -> core/db/auth) must be loadable that way. Adopted: relative imports
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
docs stay on the apex path until they outgrow it; GitHub org, npm scope `@facilis.dev` (O-006),
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

A generated Facilis project installs `@facilis.dev/*` from `pnpm pack` tarballs served by the
IDE origin, and it does so with **pnpm only**. Both halves are forced by the WebContainer,
not preferences:

- **Tarball delivery.** The packages were workspace-only when this decision was taken (O-006,
  resolved by D-164), so the template declares
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
a cold install (prebuilt `vendor/depcache` is the later optimisation). Switching `@facilis.dev/*`
to published packages changes the dependency specs only; pnpm stays the installer.

### D-023 — Packed Facilis tarballs expose compiled dist
**Status:** accepted (2026-10-27, Phase 0 browser spike)

The generated project's Vite config is loaded with `--configLoader native` (Vite's own config
bundler cannot run in the WebContainer), and a native ESM loader refuses to strip types from
files under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). The config imports
`@facilis.dev/nitro/vite`, so that entry must be JavaScript. `pnpm ide:facilis-deps` therefore
builds each package, packs it, and rewrites the packed manifest's `exports` from `./src/*.ts`
to `./dist/*.js`; the workspace source keeps its `src` entry points. `@facilis.dev/nitro` also
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
`@facilis.dev/ai`'s `validatePatch` before any write (security invariant 9), writes
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
`@facilis.dev/*` from tarballs the IDE serves on its own origin (D-022), and those URLs are only
reachable from inside the WebContainer. A committed `starter/` tree would declare dependencies
nobody outside the IDE can install — a copy that rots instead of a starter.

The generated tree is the reference app (`examples/todo-app`, D-062) plus the IDE wrappers in
`ide/src/facilis/`, and the IDE template is the only consumer. `starter/` gets created when
O-006 (publish target) is decided and the packages are installable by name; until then the
template payload is the single source of truth.

**Consequences:** the Phase 2 "starter" item is a publish-time task, not a UI one — the same
decision as O-006, not a new one.

**Amended by D-164:** the publish target is public npm and the packages are installable by name,
so the starter is unblocked.

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
[`vendor/README.md`](../vendor/README.md)):

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
  `@facilis.dev/core` validates only as an object (`FacilisNitroOptions =
  Readonly<Record<string, unknown>>`) because they are Nitro's options, not the framework's. A
  project declares only what it overrides.
- Facilis applies the framework defaults underneath — `serverDir: "./server"` and
  `experimental.openAPI: true` — in `@facilis.dev/nitro`'s `mergeNitroOptions`, deep-merged for
  plain objects (so `experimental: { openAPI: false }` flips that switch and keeps the rest of
  the block).
- `facilis()` from `@facilis.dev/nitro/vite` **mounts Nitro itself**: it returns
  `FacilisPlugins = [FacilisVitePlugin, ...Plugin[]]` — the Facilis plugin first
  (`name: "facilis"`, `enforce: "pre"`, carrying the Nitro module on its `nitro` key),
  followed by `nitro()`'s plugins.
- The Facilis plugin's Vite `config` hook loads `<root>/facilis.config.ts` with a native
  dynamic import and returns `{ nitro: mergeNitroOptions(config.nitro) }`. `enforce: "pre"`
  makes its config hook run before Nitro's, so Nitro boots with those options and the order
  inside the user's `plugins` array cannot matter.
- `@facilis.dev/nitro` value-imports `nitro/vite`, so `nitro` is a **required** peer dependency
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
`clearSessionCookie` helpers (`@facilis.dev/nitro/session`), which call h3's `setCookie` /
`deleteCookie`. h3 serialises the attributes and writes them to the event's response headers —
the same surface the first fix's manual `set("set-cookie", …)` used, but with append semantics
(a cookie another handler staged on that response is not clobbered) and one attribute set
(`HttpOnly`, `Path=/`, `SameSite=Lax`, `Secure` in production) for every app. A route returns a
plain body. The reference app's login and logout use those helpers, and the probe proves the
whole chain: the session survives to the next request, the insert runs as the logged-in user,
and the list reads the row back.

Hand-rolling the `Set-Cookie` string was the wrong level: h3 already owns cookie serialisation
and the append rule, and the framework helper is where the h3 import belongs. It is a separate
entry point (`@facilis.dev/nitro/session`) because core's route contract is h3-free (contracts §4.1):
the single `FacilisRequestEvent` → `H3Event` narrowing lives in the helper, so handlers and
generated apps never import h3.

**Consequences:** any Facilis app sets cookies through `@facilis.dev/nitro/session`, never through a
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

**Decision:** `@facilis.dev/db` loads `@electric-sql/pglite` through `createRequire` — the CJS build
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
2. **Storage.** `@facilis.dev/db` exports `tenantColumn()` — a `uuid` `NOT NULL` column whose
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

**Interim decision (2026-10-31, removed):** `@facilis.dev/db` read the three artifacts beside the
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
`/server/share` instead of throwing. With that pin, `@facilis.dev/db` is back to the plain
constructor (`new PGlite({ dataDir })`): the artifact hand-off and the one-boot recovery shim
are deleted, and the database locates its own `.data`/`.wasm` again.

**Consequences:** DB boot is independent of the browser's URL parser *and* of any downstream
shim, and the fix covers every hostful `file:` URL in the VM (PGlite, any other Emscripten
module, `Bun.file`), where the shim covered one boot of one library. Acceptance: `pnpm test`
(db), the gates, and `TEMPLATE=Facilis pnpm ide:smoke` with
`facilisDbInsert`/`facilisDbQuery` = ok; a project created before the bump keeps working,
because the runtime — not the `@facilis.dev/db` tarball — carries the fix.

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
framework's own i18n (`@facilis.dev/core/i18n`: flat keys per O-001, `{placeholder}` interpolation, a
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
`applyPatch()`, which re-validates them (`@facilis.dev/ai`) and writes through the kernel bridge —
never OPFS — then refreshes the framework revision. Failures are reported per file; a partially
applied patch is shown as such and is not retried blindly. `requires_confirmation` is surfaced as
a banner on destructive turns; it is not yet a blocking modal.

**Scope now vs Phase 4.** Only the structural validator rules (`file-path-allowed`,
`content-present`) are enforced today. The other 14 SPEC §9.3 rules need a TypeScript program,
the manifest and the O-009 path allowlist; they land in `@facilis.dev/ai` and are called from the
same `parseAiResponse`/`applyPatch` seam. At the time the SPEC §9.4 retry loop was not
implemented: a failure was reported in the chat and the user re-asked (implemented later,
D-100). Neither gap weakens invariant 9 — the model still writes nothing on its own.

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
without git. The full 16-rule validator and the SPEC §9.4 retry loop were still Phase 4 at
the time (later implemented: D-084 and D-100; D-046).

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

**Verification:** `pnpm --filter @facilis.dev/ide typecheck|test` (the asset tests build the Facilis
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
passes it to `createDb({ loadSnapshot })`; `@facilis.dev/db` exposes `snapshot()` and a
monotonic `activity()` count, and `@facilis.dev/nitro` installs a snapshotter that dumps only
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

**Package.** `@facilis.dev/storage` exports `contentHash`, `createLocalStorage`,
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
tenant_id, created_at) ships from `@facilis.dev/db` with a restrictive tenant policy; access
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

**Landed.** The runtime wiring — the `storage` section in `facilis.config.ts`,
`event.context.storage`/`ctx.storage`, the multipart `form` contract and the
`storeUpload`/`sendStoredFile` helpers — is **D-116**. The package APIs above are the
contract it builds on; the `FileUpload` block still uses them directly rather than a
framework wrapper.

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
`pnpm --filter @facilis.dev/ide typecheck|test|build`; `pnpm ide:smoke`.

### D-055 — The base UI kit is plain CSS + daisyUI-style role variables
**Status:** accepted (2026-10-31); superseded for new projects by **D-090** — template v2 ships
Tailwind CSS v4 + Base UI with shadcn-style source the project owns. The kit stays as the v1 kit
for projects created before D-090, the UI gallery and the design lab.

Generated projects need a small set of base components (table, toaster, inputs, fields,
badge, alert) that a project can use, restyle or copy. The kit must work in the project the
IDE generates today — a plain Vite + React app with no CSS framework installed — and as a
tarball with no build configuration (D-023/D-032). It therefore ships as `@facilis.dev/ui`:
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
chooses; `@facilis.dev/blocks` may still be Tailwind/shadcn (D-003) because it builds app screens
on top of the base kit. Deep customisation is "copy the component and its `.fc-*` rules into
the project", not a configuration system.

### D-056 — Date/time logic is `Intl`, explicit zones and calendar-day strings
**Status:** accepted (2026-10-31)

The framework must not add a date library (bundle + in-VM install cost) and cannot rely on
Temporal: it is not in Node 22/24 and is not guaranteed in the WebContainer browser. The base
logic therefore lives in a zero-dependency `@facilis.dev/time` package built only on `Intl`:

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
product/blog row. It is not a switch for the UI catalogue. `@facilis.dev/i18n-db` is an opt-in
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
the tenant-scoped `i18n_messages` table; the JSON catalogues of `@facilis.dev/core/i18n` stay the
base and a per-key fallback. The table needs the restrictive tenant policy **and** the
permissive tenant gate `i18n_messages_tenant_access` — a restrictive-only policy admits no
rows (D-008), the same reason `@facilis.dev/auth` has `users_tenant_access`. It ships a public
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
`src/components/*` = app-specific pieces (promoted to `@facilis.dev/ui` only when generic and
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
`hydrateCatalogs` overlay (D-057). Dates = `@facilis.dev/time` with the user's zone, never
`Date#toLocaleString`.

**UI templates in the kit.** Neutral shells live in `@facilis.dev/ui`: `Page` (header +
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
pattern CSS are promoted into `@facilis.dev/ui/theme.css`, the existing primitives are polished
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
multi-language value of a text. Both ship in `@facilis.dev/ui` as content components:
`MarkdownEditor` + `Markdown` (renderer) and `TranslationsInput`.

**Decision.** The editor is Markdown source, not WYSIWYG: a toolbar transforms the real
textarea selection, Write/Preview tabs render the value, and `Markdown` is exported so pages
render saved content with the same code. Markdown is a **fixed, safe subset**: headings,
paragraphs, bold/italic/inline code, bullet/ordered lists, blockquote, fenced code, hr, line
breaks and links; the renderer builds React elements (never `dangerouslySetInnerHTML`), raw
HTML stays text, and link targets are limited to `http(s)`, `mailto:`, `#` and relative
URLs, so previewing untrusted content cannot inject markup. No new dependency.

`TranslationsInput` edits `Translations = Readonly<Record<string, string>>`, the same shape
`@facilis.dev/i18n-db` stores (D-057) but declared in the kit instead of importing the server
package. Locales come from the project config (`locales`, tab order); `availableLocales`
feeds the add-language action; the default locale is marked and cannot be removed; tabs
carry a filled/empty dot so missing translations are visible. It is a client input only —
no catalogue, no persistence.

**Consequences:** a generated project with a Markdown field or a translated field stays
copyable and dependency-free; the renderer's subset is the contract (extending it means
extending the parser + tests, not adding an HTML sanitiser); the translations value plugs
into `translatedText`/`resolveTranslation` unchanged.

### D-062 — The IDE template is generated from examples/todo-app
**Status:** accepted (2026-11-01). The template's UI is v2 since **D-090**; the single-source rule
below is unchanged.

The base kit restyled and reorganised `examples/todo-app` (pages/layouts/lib, `@facilis.dev/ui`,
`@facilis.dev/time`, router), but the IDE still scaffolded its own probe app: different client
files, plain CSS, no kit, no router. The starter users get and the reference app they should
copy had drifted apart, and the base-kit contract left the wiring explicitly out of scope
("wiring the packages into the IDE template" was reported, not done).

**Decision.** The generated project IS `examples/todo-app`, not a copy of it. At IDE build time
`ide/src/facilis/example-template.ts` inlines the example's `src/`, `server/`, `db/`,
`locales/`, `index.html`, `vite.config.ts` and `facilis.config.ts` through
`import.meta.glob(..., { query: "?raw" })`; `facilis-template.ts` then assembles example files
+ IDE wrappers + a small override map (`template-overrides.ts`). The wrappers are the only
files written by hand: `package.json` (built from the example's versions, with `@facilis.dev/*`
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
edits. `@facilis.dev/time` and `@facilis.dev/ui` join the vendored tarball set
(`TEMPLATE_PACKAGES`, `scripts/dev/vendor-facilis-deps.sh`), and `ide/vitest.config.ts`
enables `test.css` so `?raw` CSS is real in tests instead of Vitest's empty stub.

Two supporting fixes came out of making the starter real. The IDE language service now uses
TypeScript's `Bundler` module resolution instead of classic NodeJs: the generated app imports
its own packages through `exports` maps (`@facilis.dev/ui`, `@facilis.dev/core/i18n`), which node10
ignores — every such import would be a red TS2307 in the editor, and the IntelliSense smoke
now proves it does not. The vendor packer, in turn, mirrors each package's root export as
`main`/`types` and rewrites `.d.ts` relative specifiers to the emitted `.js` (and drops CSS
imports), because declaration emit preserves the source `.tsx` specifier, which cannot be
resolved out of `dist/`.

**Consequences:** editing `examples/todo-app` changes what "New project" scaffolds, and the
generated app opens on the todo login page rather than a probe page; the smoke's HMR edit now
targets `src/app.tsx`. The generated `vite.config.ts` keeps the example's dev-vhost
`allowedHosts` (dev-only, harmless) and its `release.ref` becomes `main` instead of
`origin/main`. `starter/` stays empty until `@facilis.dev/*` has a publish target (D-027).

**Verification:** `example-template.test.ts` (drift guard, overrides, tarball deps);
`starter-contract.test.ts`, `project-files.test.ts` and `package-manager.test.ts` updated to
the assembled template; `pnpm --filter @facilis.dev/ide typecheck|test|build`;
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
  therefore an **optional capability**: `@facilis.dev/db` does not depend on it and the
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
covers a manual re-deploy. The operator supplies the repository secrets
`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` (token scoped to `Cloudflare Pages: Edit`,
no zone-wide rights): the workflow creates the Pages project itself, idempotently, on the first
run (documented in `docs/DEV.md` §9). The `ide.facilis.dev` custom domain is a one-time
`Custom domains` click in the project; the workflow would attach it too, but only for a token
that carries the zone permissions. Per-PR preview deployments are not enabled yet; a
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
  `getBootstrap()`; the route imports only `@facilis.dev/db` and never a raw Drizzle client.
- **Introspection lives in `@facilis.dev/db`.** `liveSchemaSnapshot` reads `pg_catalog`
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
block manifests, the existing routes and import resolution. `@facilis.dev/ai` is imported by the
IDE's browser bundle, so the main entry cannot import a compiler.

**Decision.** Keep `@facilis.dev/ai` browser-safe and synchronous, and push the two async inputs to
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
  `@facilis.dev/ai/node` subpath, which uses rolldown/oxc's `parseSync` (the same parser as
  `@facilis.dev/nitro`'s AST pass; dev-only, never in the browser bundle). A missing or throwing
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
real dependency or an injected checker. The retry loop (§9.4) was not implemented at the time
— `parseTurn` and `fix_hint`/`excerpt` were its seam; it is implemented now (D-100). Cost: one
context read plus one manifest fetch per validation round, and three rounds per Apply.

**Verification.** 48 `@facilis.dev/ai` tests (a suite per rule group, a realistic fixture project,
rule 1 rejects invalid TS and accepts valid TS through rolldown) and 523 IDE tests with no
regressions; `pnpm typecheck`, `pnpm lint` and the file-length/theme checks are green. The real
browser path is green end to end on a fresh profile: `pnpm ide:smoke` drives the mock provider
through rule 1 (the actual Monaco worker), the proposal card, Apply, the VFS write and Undo.

### D-085 — The API Flow reads the AST-augmented OpenAPI document and renders it with React Flow
**Status:** superseded by D-095 (2026-11-06); kept as history
**Originally:** accepted (2026-11-02)

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
boot strategy open (sequential boots vs `?at=<oid>`). `@facilis.dev/db` cannot host the browser-side
engine: it imports PGlite/Drizzle, and the Studio must never reach the database directly (§11.2).
Booting the project at an old commit to introspect it would be slow, would mutate the VFS and
would tie the preview to the runtime being healthy.

**Decision.** A pure engine over snapshots, and snapshots read from the git tree.

- **Engine.** `buildReleasePreview({ from, to, before, after, inUseRoutes?, pendingMigrations? })`
  in `@facilis.dev/core` (browser-safe, no I/O) returns the SPEC §7.7 `ReleasePreview`: schema
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
Put the engine in `@facilis.dev/db` (SPEC §5.2's original location): it cannot run in the browser
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
structural `ReleasePolicySnapshot` declared in `release.ts` instead of `@facilis.dev/db`'s
`PolicySnapshot`: even an `import type` from the db pulled `@types/pg` (and through it
`@types/node`) into the Studio's browser program, where the Node and DOM `ReadableStream`
typings collide and the vendor kernel stops typechecking. The shapes are identical, so values from
`@facilis.dev/db` stay assignable. For the same reason the IDE's `@types/node` was aligned to the
workspace catalog (22.20.5) instead of its own 24.x pin: two Node typings produced two Vite
instances and broke `@facilis.dev/nitro`'s build. The engine file was split across
`release-preview`/`release-sql`/`release-classify`/`release-breaking`/`release-security`/
`release-api` to stay under 300 lines.

**Verification.** 92 `@facilis.dev/core` tests (31 new: splitter 3, classifier 20, engine 8; the
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
**Status:** superseded by D-095 (2026-11-06); kept as history
**Originally:** accepted (2026-11-02)

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
  300k chars) and `scanManifestConsumers` (named `scanApiConsumers` then) matches literal `/api/…` references to the operations:
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

### D-090 — Template v2: the generated app owns its UI (Tailwind v4 + Base UI + shadcn source)
**Status:** accepted (2026-11-03)

D-055 made the generated app's UI a plain-CSS kit (`@facilis.dev/ui`) because the project had no CSS
framework and the kit had to survive as a tarball. That solved shipping, but left generated apps
outside the standard React UI ecosystem: the kit could only grow by adding components and props,
the visual line went stale, and the catalog of reusable sections the product needs would have had
to be built on a private kit instead of component source a project can read and edit.

A WebContainer spike answered the two open questions. The shadcn substrate installs and runs in the
VM: `tailwindcss`/`@tailwindcss/vite`/`@tailwindcss/oxide-wasm32-wasi` 4.3.3 and `@base-ui/react`
1.9.0 install with plain npm (`process.arch` is `wasm32`, so the WASI oxide is a normal match), Vite
8 serves, utilities are generated and Base UI renders; the cold-create cost is about +5–8 s and
+42 MB in `node_modules`. The one defect is upstream: Tailwind's WASI incremental scanner does not
pick up a **new** utility class after a source edit until the CSS entry is touched
(tailwindlabs/tailwindcss#20605, open). It is a dev-server-only problem, and making the
stylesheet's mtime move is the reliable workaround: it forces @tailwindcss/vite to recreate its
compiler and scanner, which then sees the new candidates.

**Decision.** The scaffold the IDE generates is **template v2**: React 19 + Tailwind CSS v4 + Base UI,
with shadcn-style components copied into the project as source.

- **The app owns its UI.** `src/components/ui/*` (button, input, field, select, dialog, card, table,
  badge, avatar, spinner, skeleton, alert, page/auth shells, sonner toaster) plus `src/lib/utils.ts`
  (`cn`) are project files, generated once and then edited like any other page component. There is
  no UI-kit tarball in a v2 project and no shadcn CLI at runtime or in the template: shadcn is
  component source, not a re-exportable library.
- **Theme is shadcn's role vocabulary with the Facilis direction-A values.** `src/styles.css` imports
  Tailwind, maps `--color-background|card|primary|muted|border|ring|…` in `@theme inline`, and keeps
  complete `:root`/`[data-theme="light"]`/`[data-theme="dark"]` sets. `data-theme` stays the switch
  (the app persists it), so a theme is still one variable block and no component names a colour.
- **Dependencies are pinned, and the VM binding is generated-only.** The project declares
  `@base-ui/react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `sonner`, the
  Geist font and `tailwindcss`/`@tailwindcss/vite`; the IDE adds `@tailwindcss/oxide-wasm32-wasi` at
  the **same exact version** to the generated `devDependencies` only. Putting it in the example
  breaks the host install (`EBADPLATFORM`, `cpu: wasm32`), and a version skew between the compiler
  and the binding is the failure mode to avoid.
- **HMR was worked around, not forked — removed in Tailwind 4.3.5.** `vite-plugins/tailwind-rescan.ts`
  was a dev-only Vite plugin that ran only in the VM (`process.arch === "wasm32"`); after a
  debounced source change it rewrote `src/styles.css` with its own bytes, and the mtime change made
  `@tailwindcss/vite` recreate its compiler and scanner. Tailwind 4.3.5 fixed the WASI scanner
  (tailwindlabs/tailwindcss#20605), so the plugin, its `vite-plugins/` folder, the generated
  project's `@types/node` devDependency and the `node` tsconfig types were deleted. The
  verification below is the 4.3.5 run that closed it.
- **`@facilis.dev/ui` stays as the v1 kit.** Projects created before D-090 keep their import and their
  vendored tarball; the package remains for them, the UI gallery and the design lab. New projects
  do not receive its tarball. **Superseded by D-096:** the kit, both example apps and its
  documentation were removed; there is no v1 project to support.
- **The template is still examples/todo-app (D-062).** The single-source rule, the byte-identical
  drift test and the IDE override map are unchanged; only the example's UI layer moved.

**Rejected alternatives.** *Fork Tailwind*: a fork means maintaining WASI builds and re-applying a
patch on every upgrade for one dev-only scanner bug; the workaround is a few dozen lines and can be
deleted when upstream fixes it. Fork only if upstream stalls and the workaround regresses. *Proxy
shadcn inside `@facilis.dev/ui`*: shadcn is copy-in source, and Tailwind classes in `node_modules` need
precompiled CSS; a versioned tarball would have produced N divergent component forks. *Keep the v1
kit and add Tailwind alongside it*: two styling systems in one starter, and the catalog would still
depend on the private kit. *Ship the shadcn CLI*: the spike's CLI install was pathological in the VM
(~1 GB and >7 min without finishing) and a code generator is not a runtime dependency.

**Consequences.** Generated apps are editable, standard React/Tailwind code, which is the premise of
the copy-in catalog (a separate decision). The AI prompt, the generated README and the frontend docs
now teach the v2 paths; `@facilis.dev/ui` documentation is marked v1. A v1 project keeps working but does
not receive v2 components automatically; a migration is an upgrade recipe, not a forced rewrite.
The conformance cost is real: the tailwind trio must move together, and the `@facilis.dev/ui` kit will
eventually be retired instead of grown.

**Verification.** Browser run of the real Studio (CDP) on a project created from the IDE:
in-VM `npm install` (69 requests, 85.3 MB), Vite 8.3.5 dev, preview painted 120.7 s after create
(kernel online 1.4 s). The generated `package.json` has no `@facilis.dev/ui`; the Tailwind trio is
4.3.3 exactly and the oxide binding is generated-only; the preview paints the direction-A canvas
`rgb(247, 248, 249)` with Geist and no `.fc-*` class. Writing a new `bg-[#123456]` utility into
`src/app.tsx` through the VFS moved the computed background to `rgb(18, 52, 86)` without touching
`src/styles.css` (a reload-only workaround had failed first — the stylesheet mtime is what makes
the Vite plugin recreate its scanner). Host gates: example typecheck/test (33 tests)/lint/build,
IDE typecheck/tests (597), file-length OK. Evidence: `spikes/template-v2/` (report, screenshots).

**Amendment (2026-11-07, Tailwind 4.3.5).** The workaround is deleted. Re-running the Studio
harness against the final template — `vite.config.ts` with no `tailwindRescanInVm`, no
`vite-plugins/` folder, no generated `@types/node` — a new `bg-[#7c3aed]` utility written into
`src/app.tsx` through the VFS moved the preview's computed background to `rgb(124, 58, 237)` with no
stylesheet touch. Run: kernel online 1.5 s, preview painted 116.7 s after create, all 30 harness
checks green, the generated project asserted to ship no rescan plugin and no config reference, the
Tailwind trio all 4.3.5. Host gates after the removal: `pnpm lint` (0 errors), `typecheck`
19/19, `test` 19/19, `build` 12/12. The facilis.dev site carried the same copy and dropped it too
(separate repo, commit `e366de5`). Evidence: `spikes/tailwind-435/run.mjs` and its report
(artifact dir `/tmp/facilis-dev/spike-template-v2/1794038170654`, untracked).

### D-091 — facilis.dev is a static site created inside the Studio, and the catalog is its own data
**Status:** accepted (2026-11-03)

The website brief (`docs/WEBSITE.md`) proposed Astro + Starlight and explicitly deferred
dogfooding. Two things changed that. D-090 made a generated app standard React/Tailwind source,
which is what a copy-in section catalog needs; and the product's best proof is its own workflow —
creating the site in the Studio is a real test of creation, editing, AI, preview and export, and it
leaves a journal of every step that a launch page can publish. The cost is explicit: a
client-rendered marketing page is slower and less crawlable than static HTML, so the site cannot
argue "day one is a link" from a slow page.

**Decision.** `facilis.dev` is a **statically exported** app created and edited inside the Studio.

- **Location.** The project is created by Studio "New project" (template v2, D-090), project
  name `facilis-dev`, and exported with "Export Project as Zip"; it lives in its own repository,
  `facilis-dev/facilis-site` (see the amendment below), and every edit made to the export is
  itemised in that repo's `BUILD-JOURNAL.md`.
- **No server in production.** Every route is prerendered to HTML at build time from the same React
  tree and hydrated in the browser. Nitro remains part of the project for the in-VM dev server and
  is not deployed: the site has no API, so it needs no database, no auth and no runtime.
- **The catalog is the site's own data.** Section sources live under `catalog/sections/<slug>/` in
  the site repository
  (files + `section.json` reusing `BlockManifest` from `@facilis.dev/blocks`, plus the copy-in
  facts: dependency list, insertion point, migration, screenshot); a build step emits versioned,
  content-hashed, CORS-open JSON under `/catalog/`. The site renders those files and any client —
  including the Studio later — reads the same ones. No CMS, no database, no API.
- **Origin.** The IDE stays at `ide.facilis.dev`. Moving it would strand every origin-scoped OPFS
  project and service worker; `/try` on facilis.dev is therefore a **redirect**, not an iframe,
  because `COOP`/`COEP` are not inherited by frames and facilis.dev has no WebContainer to justify
  them.
- **Copy and launch surface.** `docs/WEBSITE.md` v3 stays the copy source. The product is called
  **IDE**, the site `facilis.dev` (closes W-12); launch is EN only, with no waitlist ("in attesa")
  and no analytics.
- **Deploy stays with the maintainer.** The repo produces the artifact and the command; no deploy
  workflow is added for the site until it is real.
- **The journal is a deliverable.** The site repo's `BUILD-JOURNAL.md` records steps, timings,
  AI prompts and every gap dogfooding exposes; it is the source of the site's "how this was built"
  page.

**Amendment (2026-11-03) — the site lives in its own repository.** It first landed as
`sites/facilis-dev`, a pnpm-workspace member of this repo. Keeping it there coupled three things
that should move independently: the site's release cadence, the framework's gates (a doc edit in
the IDE repo would rebuild the site), and the generated-project boundary the site is supposed to
prove (a workspace member silently resolves `@facilis.dev/*` from source instead of from the tarballs
a user gets). The site now lives in **`facilis-dev/facilis-site`**: the unmodified Studio export,
its journal, and a `tools/create-in-studio.mjs` provenance harness; it commits the `vendor/`
tarballs so it stays a self-contained generated project and needs no workspace. The boundary is
**re-export, not shared workspace**: a framework change the site needs arrives as a new export,
and the diff is applied in the site repo. Two deviations from the export are documented there: the
tarball specifiers are relative, and the two WASM-only devDependencies are removed because npm
refuses them outside the VM (`EBADPLATFORM`; journal G4 — candidate fix: declare them
`optionalDependencies`). Nothing in the IDE repo depends on the site repo.

**Rejected alternatives.** *Astro + Starlight now*: it would not exercise the product, and the
catalog would exist twice (an Astro rendering of sections and the copy-in source). *One
repository for IDE and site* (the first version of this decision, reversed the same day — see the
amendment): brand and CI would not drift, but the site's release would be tied to the framework's
and the generated-project boundary would be invisible. *A catalog API or a CMS*: the site has no other runtime, and the static JSON is the
same artifact the Studio will consume. *Moving the IDE to a new subdomain*: origin-scoped project
storage makes it a migration, not a rename. *An iframe for `/try`*: COOP/COEP.

**Consequences.** The site's page weight and SEO become framework deliverables (prerendering is now
a build step the template needs), and "this site is a Facilis app" becomes a checkable claim. The
catalog format becomes a public contract, so it is versioned from its first commit. The marketing
site no longer has an independent stack to fall back on; if it cannot reach acceptable LCP, the
fallback is a static shell plus the app for the interactive parts, not a rewrite in another
framework.

**Verification.** Step 1 (evidence in `spikes/facilis-site/` and in the site repo's
`docs/evidence/`): the real Studio created the project and exported it (242 276-byte zip, 75
files, create → preview 129.5 s, kernel online 1.6 s); in the site repo, `npm install` and
`npm run build` pass on the host (`vite build` emits the Nitro server output that production will
not deploy). Dogfooding exposed four gaps recorded in the journal: exported dependencies are
absolute VM `file:` paths (G1), the project is npm-only by a preinstall guard (G2), the only way
back to a repository is the zip export (G3), and the generated devDependencies are not portable —
the two WASM-only bindings make a host `npm install` fail with `EBADPLATFORM` (G4).
### D-092 — Project introspection is a zero-build AST interpreter of the framework DSL, rendered as one graph

**Status:** accepted (2026-11-04)

The Studio and the AI layer learn the project's schema and API surface from dev-only runtime
endpoints (`/__facilis/manifest`, `/_openapi.json`, `/__facilis/dev/schema`). That couples
introspection to a booted Vite/Nitro/PGlite runtime, and the same facts are re-read by four
different text scanners (`packages/nitro/src/ast`, `packages/ai/src/{scan,config-facts,schema-facts}`,
`ide/src/facilis/release-schema.ts`, `ide/src/facilis/api-flow-consumers.ts`). The scanners
disagree (property vs SQL column names, spoofable AI rules, route forms the manifest misses),
and the panels degrade exactly when the project is broken. The spec's "everything is code" rule
makes the declarations the source of truth; it does not require executing them to read them.

**Decision.** Add `@facilis.dev/analyze`, a browser-safe package that interprets the framework's
declarative DSL with an injected parser and **zero build-time execution** of project code. It
produces one fact model (routes, config, tables/columns/policies, FK and `relations()` edges,
i18n, client consumers, diagnostics) and one project graph.

- **Parser.** `oxc-parser` behind the injected `Parser` contract: the Node/CI adapter uses the
  native/wasm build, the Studio worker uses the browser wasm entry. The generated project keeps
  its existing rolldown/oxc pass until the WebContainer wasm path is proven; the AST shape is
  normalized to the repo's structural node helpers. The parser is pinned with the bundler's oxc
  generation where practical.
- **DSL contract.** Routes must default-export the `@facilis.dev/core` `defineAuthorizedHandler`
  call; config is `defineConfig`; schema is `pgTable` plus the whitelisted column builders,
  methods and policy helpers; client calls go through the single `api()` transport; i18n uses
  literal `t()`. Values are read through a bounded static subset (literals, same-file consts
  and one-hop project imports, static templates/arithmetic). Anything else is an explicit
  unknown, never an empty value: `dbTables === null` is unknown, while `[]` is "no DB".
- **Relations.** `.references(...)` (physical FK) and Drizzle `relations(...)` (logical
  one/many) are distinct edge kinds. `dbColumns` and `ScopeFact.column` use Drizzle property
  names; the SQL name stays on the column fact. Framework tables reached by re-export are read
  from the installed `@facilis.dev/*` source.
- **Graph.** One editor-area graph (pages → routes → tables, plus table→table FK/relation
  edges), not two panels: fullscreen, per-edge-kind filters, draggable nodes, auto-layout with
  manual override, source jumps, integrity badges. The layout is local editor state in
  `<project>/.facilis/graph.json` (gitignored), written through `kernel.writeFiles`; it is
  never an input to validation and never AI-writable.
- **Diagnostics.** The analyzer reports codes with severity (`route-wrapper`,
  `route-config-static`, `permission-declared`, `db-tables-present`, `db-tables-known`,
  `body-validated`, `no-raw-db`, `schema-static`, `rls-on-scoped-table`,
  `fk-target-known`, `client-transport`, `page-path-static`, `i18n-key`,
  `config-*`, `parse-error`, `unknown`). The CI/lint gate fails on errors; the IDE shows
  them live. Runtime `defineAuthorizedHandler` stays the security boundary.

**Rejected alternatives.** *Annotations/JSDoc as a second source of truth*: text, forgeable,
omitted by models, and it duplicates the executed wrapper. *Build-time evaluation of config/
schema*: faithful but re-introduces a build step and cannot work for old git refs in the
browser; the bounded DSL interpreter keeps the zero-build property. *Keeping endpoints as the
only source*: boot-coupled and the four scanners already disagree. *One parser for the
WebContainer too, now*: the oxc-parser VM path relies on a runtime package download and
`node:wasi`, unverified; the normalized AST contract keeps that migration open. *Free-form
Drizzle re-implementation beyond the whitelist*: unknown is safer than a guessed type.

**Consequences.** One fact model replaces the text scanners (they are deleted once parity tests
pass); the IDE and AI can work with the dev server down; endpoints remain for live state
(catalog/drift/boot) and as the runtime oracle for divergence tests. The analyzer owns a small
DSL interpreter whose maintenance is the schema whitelist and the static subset; a parser
version bump is a deliberate change with fixture tests. The Studio pays a lazy-loaded wasm
worker (oxc wasm + one emnapi pin) and a startup analysis of the project's source files. The
DSL restrictions are enforced by the gate, so a project that steps outside the contract gets a
diagnostic instead of silently missing facts.

**Verification.** `@facilis.dev/analyze`: 60 tests green (config/routes/i18n/schema/relations/
clients/graph + module graph/static eval), `typecheck`, `lint`, build and the 300-line check
green. Spike on `examples/todo-app`: 443 files, 8 routes, 6 tables (including re-exported auth
tables), 4 pages with calls, 18 graph nodes / 31 edges, 0 diagnostics; the fixture project
covers invalid routes, const/imported config, FK + both relation kinds, path builders and the
transport violation. The IDE side is implemented on the same facts: a lazy wasm worker
(`analyze-worker` + 1.5 MB `parser.wasm32-wasip1` asset, one pinned emnapi pair) and the
`project-graph` editor tab (fullscreen, edge filters, drag, `.facilis/graph.json`). IDE
typecheck, 83 test files / 642 tests, lint, theme and build are green. The browser smoke run
passes the new graph checks end to end in the real Studio (activity → panel → worker →
tables/routes/pages rendered); its four failures are the unrelated chat provider/settings
checks, outside this change.

### D-093 — Nitro and the AI validator consume the analyzer; the WebContainer path keeps rolldown as its parser

**Status:** accepted (2026-11-04)

D-092 introduced `@facilis.dev/analyze` and committed to deleting the duplicated text scanners
once parity tests passed. The cutover has one hard environment constraint: the Nitro Vite
plugin runs inside the generated project's `vite.config.ts` under the Studio's WebContainer,
where the config is loaded with `--configLoader native` and only the bundler's own oxc
(`rolldown/utils`, already a template dependency) is proven to load. `@facilis.dev/analyze/node`
imports `oxc-parser`, whose VM path (runtime package download + `node:wasi`) is unverified;
shipping it in the generated project would put the dev server behind an unproven dependency.

**Decision.** The analyzer's main entry is parser-injected and dependency-free; adapters stay
on explicit subpaths. The Nitro plugin injects `parseSync` from `rolldown/utils` through a
small `Parser` adapter and loads the project map from the new `@facilis.dev/analyze/fs` subpath
(node:fs only, no parser). The IDE keeps its browser wasm parser in the worker. The AI
validator's pure `validatePatch` now consumes the analyzer's **effective (post-patch)
`Analysis`** plus the pre-patch one for inverse edits; the IDE builds both from one cached VFS
snapshot and the patch overlay on the single warm worker, and fails the round closed with a
`project-analysis` error if the analyzer is unavailable (it never falls back to text scanning).
`@facilis.dev/ai` imports the analyzer types only, so its main entry stays browser-safe; the Node
helper lives in `@facilis.dev/ai/node`. `@facilis.dev/analyze` becomes part of the generated project's
vendored tarball set (its `oxc-parser` dependency is an optional peer, so the VM never installs
it) and `@facilis.dev/analyze/fs` ships compiled.

**Deleted (replaced by the analyzer):** `packages/nitro/src/ast/**` (scanner, extractor,
static eval, route-path + tests), `packages/ai/src/{scan,config-facts,schema-facts}.ts`, and the
Nitro `rolldown` AST scanner tests. The two remaining scanners are intentionally not deleted
yet: `ide/src/facilis/release-schema.ts` reads a **historical single file** at an arbitrary git
ref (the analyzer needs a full module graph, which the git-tree workbook does not provide) and
`ide/src/facilis/api-flow-consumers.ts` is a live-manifest consumer view, not a source-of-truth
reader. Both are tracked as follow-ups; D-092's "one fact model" rule applies to project
introspection, which they no longer duplicate (release preview diffs refs; API Flow renders the
running manifest).

**Consequences.** Nitro's manifest/OpenAPI facts now change when any project source changes
(config and imported consts are analyzer input), not only when a route file changes. The
manifest lists wrapper-less routes with `security: "unknown"` instead of omitting them, and the
`defineRouteMeta` fallback is gone. Permission metadata is normalized to an array. Methods
outside core's five are omitted with a warning (the manifest `HttpMethod` contract is
unchanged). The AI rules are no longer spoofable by comments/strings: wrapper, body-read,
`dbTables` and permissions are AST facts; `dbColumns` use Drizzle property names end-to-end;
rules 10/14/15 ignore framework re-exported tables.

**Verification.** `@facilis.dev/analyze` 66 tests; `@facilis.dev/ai` 61 tests (same rule scenarios plus
new fact seams); `@facilis.dev/nitro` 120 tests including the injected-parser `as const` proof and
the "any source edit invalidates" test; IDE 84 files / 649 tests. Root `lint` (0 errors),
`typecheck` (23 tasks), `test` (21 tasks), `build` (15 tasks), file-length and theme checks green.
Browser smoke (real Studio + WebContainer): project-graph checks pass; the four unrelated chat
provider/settings checks remain. `@facilis.dev/nitro` grep confirms no `@facilis.dev/analyze/node`
import in source or dist.

**Follow-up (2026-11-05, D-094).** The two scanners named above are gone: the Release Preview
reads its schema through the analyzer and the consumer scan is `manifest-consumers.ts`.

### D-094 — Release Preview reads its schema from the analyzer; the API Flow consumer scan is named for its manifest scope

**Status:** accepted (2026-11-05)

D-093 left two text scanners in the Studio and recorded why. Re-checked against their actual
inputs, one limit did not hold: the Release Preview compares refs **without booting them**,
which is exactly the analyzer's model (a plain file map plus an injected parser) — the
"historical single file" constraint was a property of the old reader, not of the problem.

**Decision.** `readSnapshotAt`/`readWorkingSnapshot` collect the ref's `db/**` DSL sources and
`facilis.config.ts` (the config can move `tenantColumns`/`ownerColumns`, which decide the
table's `scope`) and hand them to the same warm analyzer worker the project graph and the AI
validator use. The analyzer is a parameter of the release reader, so the Node test injects the
native parser and the Studio passes `analyzeProjectFiles`; `release-schema.ts` is now a pure
mapping plus source selection. The release contract is unchanged: `columns` stay Drizzle
property names and policies stay names. `scoped` becomes the analyzer's config-driven
`TableFact.scope` instead of the old `tenant|owner|user_id` name heuristic (a `userId` column
is session identity, not a scope column). A failed analysis returns a `null` snapshot, so the
panel reports the ref as unreadable rather than diffing a schema whose tables silently
vanished — the same fail-closed rule as the AI validator. Migration SQL and
`release-routes.ts` are untouched: column types/renames still surface only through SQL, and a
route derived at an old ref still knows method+path only.

`api-flow-consumers.ts` is kept on purpose: it matches `/api` URL literals in client sources
against the **live manifest's** operations, answering "what does the running app call?" — it is
not a second reader of the project DSL (URL literals are not DSL facts). It is renamed
`manifest-consumers.ts` (`scanManifestConsumers`, `ManifestConsumers`,
`ManifestConsumerRef`) so the module name states which truth it consumes.

**Follow-up (D-095).** The API Flow was removed and this scan with it: the project graph answers
the page → route question from AST facts without a runtime endpoint.

**Consequences.** The Release Preview now depends on the analyzer worker being available,
exactly like the project graph and the validator. A ref snapshot performs one extra read per
`db/**` source plus `facilis.config.ts`, and its schema facts are no longer spoofable by
comments or strings. No text scanner over project sources remains for DSL facts; the only
source-text scan left is the manifest consumer URL match, which does not interpret the DSL.

**Verification.** IDE 84 files / 651 tests, typecheck, lint (0 errors), `build:app`, file-length
(781 files) and theme checks green; root `lint` (0 errors), `typecheck` (23 tasks), `test`
(21 tasks) and `build` (15 tasks) green. The release reader tests inject the Node parser (no
worker) and the release schema tests assert the analyzer's facts for the template and for
helper/policy expansion. Browser smoke (real Studio + WebContainer): 119 checks pass, including
the Release Preview and API Flow panels (the latter existed at the time); the same four
unrelated chat provider/settings checks remain.

### D-095 — The API Flow panel is removed; the project graph is the single API/schema visualizer

**Status:** accepted (2026-11-06)

D-085/D-087 shipped an API Flow that rendered `/_openapi.json` through the preview proxy and
scanned `src/**` for consumers. D-092 then added the project graph: the same pages → routes →
tables structure (plus FK/`relations()` edges) from `@facilis.dev/analyze`, with no runtime
endpoint, no preview and no polling. Keeping both duplicated the visualizer and the
route/page/table model, while the OpenAPI-driven one only works while the project is reachable
through the Studio's preview frame — when the app is opened in its own tab (and in the isolated
preview modes) the Studio's fetch to the preview origin is cross-origin and the panel degrades
to "unreachable". The AST graph does not have that failure mode.

**Decision.** Remove the whole API Flow surface: `ApiFlowPanel` and its four subcomponents,
`api-flow-{client,model,parse,tables}.ts` (+ tests), the `manifest-consumers` scan it used,
the `api-flow` synthetic tab (controller method, tab kind, editor rendering, breadcrumb/title),
its `activity.apiFlow` button, the `en/it-api-flow.ts` catalogues, the browser-smoke block and
the `05-api-flow.png` artifact. `/_openapi.json` stays a framework endpoint (SPEC §6.9): it is
still the published API contract for the generated app and external tooling; only the Studio
panel goes. The project graph is the single visualizer: it answers the page → route → table
question from AST facts and works with no booted app.

**Data Explorer is not removed.** It keeps the live code ↔ DB drift, but its transport is the
remaining reachability question: it builds `/__facilis/dev/schema` from the preview iframe URL,
so it needs a live preview tab and a same-origin preview (mode A). It does not work when the app
is opened in its own isolated tab, and its declared half duplicates the analyzer. Recorded as
O-011 with the proposed direction: declared tables from AST immediately, live drift through a
kernel-mediated dev proxy (the Studio already hosts the kernel) instead of the preview frame,
so no preview is needed to connect; the PGlite-snapshot alternative is rejected (stale data,
a second Wasm instance, unsafe concurrent writers). Not implemented in this change.

**Consequences.** One visualizer, one graph model (D-092). The IDE loses OpenAPI-driven consumer
attribution; the project graph's page/route/table structure already covers the structural view.
The tab kinds become text/image/directory/diff/notebook/commit-graph/project-graph. The manifest
consumer scan is deleted, closing the D-094 rename follow-up by removal. The i18n catalogues
shrink by the API Flow block, and no IDE code reads `/_openapi.json` anymore. O-011 is the next
step for the Data Explorer.

**Verification.** IDE 80 files / 619 tests, typecheck, lint (0 errors), `build:app`,
file-length (764 files) and theme checks green; root `lint`/`typecheck`/`test`/`build` green.
Browser smoke re-run with the API Flow block removed: 95 checks pass, including the project
graph and the Release Preview; the 11 failures are all in the pre-existing chat flow (provider/
settings selection plus its downstream proposal/apply/undo checks and the two global console/
request checks they trip). Chat is currently known-broken and out of scope for this change;
every non-chat check passes.

### D-096 — `@facilis.dev/ui` is removed: there is no v1 kit to support
**Status:** accepted (2026-11-06)

D-055 made the v1 kit the generated app's UI when a generated project had no CSS framework and a
tarball was the only way to ship components. D-090 replaced that for new projects: template v2 is
Tailwind CSS v4 + Base UI with shadcn-style source copied into the project, which the project owns
and edits. Keeping the old kit alive bought nothing except a package, two example apps, a vendoring
step and documentation that still presented it as the fallback — and there is no v1 project to
support.

**Decision.** Delete `@facilis.dev/ui` and everything that existed to exercise or ship it.

- `packages/ui/` is gone, with its `theme.css` contract and its `.fc-*` rules.
- Its two example apps are gone: `examples/ui-gallery` (the kit gallery) and
  `examples/design-lab` (the theme/direction exploration). `examples/todo-app` is the only
  example, and it uses the copy-in components.
- `scripts/dev/vendor-facilis-deps.sh` no longer packs it (the IDE's template tarball set,
  `TEMPLATE_PACKAGES`, already excluded it), and the AI probe prompt no longer tells the model to
  import it.
- `docs/BASE-KIT-CONTRACTS.md` is deleted. `docs/SPEC.md` §5.7 marks the kit removed and keeps the
  v1 description only as history; `README`, `AGENTS`, `FRONTEND` and the todo app's comments stop
  presenting it as a fallback.
- The generated-project tests keep the guard (no UI-kit tarball in a project's `package.json`),
  now stated without a package name.

**Rejected alternatives.** *Keep the package but stop documenting it*: a package nothing generates
still has to build, be maintained and be tested, and it stays a fallback in the decision log.
*Keep the gallery as a design tool*: the design lab existed to pick the direction; the direction is
now in `styles.css` and the site.

**Consequences.** The workspace shrinks by a package and two examples, and the vendored tarball set
loses an entry; no project can import the kit any more. Projects created before D-090 are not
migrated. The UI story is one stack: template v2's copy-in source.

**Verification.** `pnpm install` prunes the workspace, no workspace package depends on
`@facilis.dev/ui`, and `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` run without it.
`grep -r "@facilis.dev/ui"` over the tree returns only historical ADR/SPEC prose.

### D-097 — The Data Explorer gets a query console and declarative SQL views
**Status:** accepted (2026-11-06)

The Data Explorer could only read the live schema, and it reached that schema through the
preview iframe URL: a popped-out preview or an isolated preview origin left the panel
unreachable. The user asked to keep the table list on the left, and to add a central pane that
runs SQL, shows rows live, and turns a finished query into a reusable view in the code — with
views following the permissions of the underlying tables. D-095 left the connection in O-011.

**Decision.** Three parts, one contract.

- **Kernel-mediated transport.** Panels build requests from a same-origin
  `/preview/<port>/…` URL carrying the kernel token, which the Studio's Service Worker routes
  to the in-VM dev server, instead of the preview iframe's `src`. The token is preserved when a
  path is appended (it stays in the query string), so the same base serves the schema endpoint,
  the query endpoint and the manifest. Popped-out previews work; the embedded iframe is no
  longer required.
- **Query console.** `POST /__facilis/dev/query` runs one statement in a `READ ONLY` transaction
  with a 5 s `statement_timeout`; a prefix check (SELECT/WITH/VALUES/TABLE, one statement)
  gives the friendly error, the transaction is the boundary (a SELECT calling a writing function
  is rejected there), and the statement is wrapped in an outer LIMIT with a `truncated` flag.
  Rows are JSON-safe values (bigint/Date/bytea/jsonb normalised) and columns carry their
  Postgres type name from `pg_type`, which the Studio's code generator consumes.
- **Declarative views.** A view is code: `db/views/<name>.ts` declares it with
  `defineView({ name, columns, query })` from `@facilis.dev/db`, one file per view (no import
  merge). `#facilis/db-views` collects the modules, and the dev boot applies
  `CREATE OR REPLACE VIEW "name" WITH (security_invoker = true) AS <literal query>` after
  migrations and the app-role bootstrap, then grants SELECT to `facilis_app`. The Create-view
  button validates the SQL, creates the view live through `POST /__facilis/dev/view` (so it is
  usable immediately), and writes the file through the kernel's `vv-write` — the Studio never
  touches OPFS. `defineView` returns a Drizzle view, so a route selects from it like a table.
- **Permissions follow the base tables.** `security_invoker` makes the view execute as the
  invoking role, which is the policy-scoped `facilis_app` every route already runs as; the base
  tables' RLS and grants therefore are the view's permissions. The framework always emits the
  option and there is no flag to turn it off. `packages/db/src/views.test.ts` proves both
  directions: a plain superuser-owned view returns every row through the app role, the declared
  view returns only the caller's.
- **Console RLS.** The console itself runs as the connecting superuser (SPEC §11.2's "superuser
  (with warning)" mode), so a developer previews all rows; the UI says so. A per-user/role mode
  stays open as O-012.
- **Production.** Views are DDL: on a Postgres target the boot skips them with a
  `view_ddl_skipped` warning, exactly like migrations, and the deploy step provisions them from
  the same code.

**Rejected alternatives.** *PGlite snapshot in a Studio worker*: stale data, a second Wasm
instance and concurrent writers (already rejected in O-011). *Creating the view only in code
without applying it live*: the next query would not see it, so the button would lie. *Drizzle
`pgView(...).as(sql)` plus drizzle-kit output*: arbitrary result sets need declared column types
and a migration channel, and a view generated from a console query is not really a migration;
framework-time CREATE OR REPLACE keeps views derived from code with zero build. *A code-level
saved query instead of a database view*: permissions would be inherited trivially, but the user
asked for views in the code, and the security_invoker guarantee is the contract worth testing.
*Materialised views*: a refresh lifecycle is a separate design.

**Consequences.** `@facilis.dev/db` grows `views.ts`, `query-console.ts` and `read-only-sql.ts`;
`@facilis.dev/nitro` gains the `#facilis/db-views` virtual module and the two dev routes (three
dev endpoints total). A generated project may have a `db/views/` directory. The IDE gains a
`data-query` editor tab and the kernel-mediated base. Preview mode C has no same-origin SW, so
the transport is still undefined there, and the declared-from-AST table list is still planned
(O-011). The analyzer/manifest do not know views yet, so a route that selects from one declares
its base tables in `dbTables`; extending the facts, the graph and the reverse lookup is O-013.

**Verification.** `@facilis.dev/db` 14 files / 107 tests (views under RLS, read-only transaction, JSON-safe rows), `@facilis.dev/nitro` 19 files / 137 tests (both routes, guard/404, virtual module, view failure as a warning), IDE 83 files / 646 tests, IDE typecheck/lint (0 errors)/file-length/theme green (controller 2517 lines, under its 2518 ratchet). Root `lint` (0 errors, 212 warnings), `typecheck` (19 tasks), `test` (19 tasks) and `build` (12 tasks) green. The generated `defineView` file shape compiles inside `examples/todo-app`. Browser smoke re-run: 108 checks pass, including the Data Explorer table list and the whole query console flow (open, type, run, rows rendered); the 6 failures are all in the pre-existing chat flow (settings/provider picker, the proposal's file list, the patch reaching the VFS) plus the two global console/request checks it trips. Chat is known-broken and out of scope for this change; every non-chat check passes.

### D-098 — Views may carry their own permission: definer views with an `app.permissions` gate
**Status:** accepted (2026-11-07)

The user asked for views with dedicated permissions: most should follow the base tables (D-097),
but some must be reachable without access to the underlying rows (statistics, projections, a
"public" projection of a restricted table). D-097 made `security_invoker = true` mandatory, which
is the safe default but cannot express that, and the user accepted the trade-off: a view is a
table-like resource, the developer owns what its SQL exposes.

**Decision.** `permission` is an optional field of `defineView`. Absent: D-097 unchanged
(`security_invoker = true`, base tables' RLS/grants). Present: the framework creates the view
`WITH (security_invoker = false)` and wraps the query as `select * from (<query>) as "q" where
nullif(current_setting('app.permissions', true), '')::jsonb ? '<permission>'`; that permission
alone gates access and the base tables are not consulted. The permission must match the
identifier pattern and be declared in `facilis.config.ts`; `applyViews` reports an undeclared
one as a `view_failed` warning (boot stays up), the dev endpoint answers 400
`invalid_permission`, and `PolicyScope.permissions` travels in `app.permissions` beside the
other GUCs. Views remain full read-only SQL (the D-097 static single-statement rule), not a DSL.
The Create-view dialog offers the declared permissions (a selector) and the generated
`db/views/<name>.ts` keeps the choice; the console request is validated against the config
server-side.

**Why this shape.** A permission view behaves like a table with its own permission. The gate is
defense-in-depth (it survives a route that forgot its `permission`, or a context that never had
it) but not a boundary against deliberately hostile code: `app.permissions` is a custom GUC any
role can set. Primary authorization stays route RBAC; the definer ownership is what makes the
mode work, and the SQL is the developer's responsibility.

**Rejected alternatives.** *One Postgres role per app role/permission*: app roles are not
Postgres roles, policies read GUCs, and it multiplies roles (SPEC §8.4.5). *A restricted
aggregate/projection DSL*: less useful than full read-only SQL, and the user chose full SQL.
*Column-level grants*: the model grants whole tables and it does not solve cross-RLS aggregates.
*Keeping every view invoker-only*: cannot express statistics without the underlying data.
*Materialised views*: refresh lifecycle, a separate design.

**Consequences.** `ViewMetadata.permission/access` is exposed for the manifest; `createLiveView`
and `POST /__facilis/dev/view` take an optional permission; `applyViews(db, modules,
{ permissions })` validates it at boot. The analyzer's route↔view reverse lookup (O-013) will
check that a route using a permission view declares that permission; until then the DB gate is
the runtime check. Definer views bypass RLS by design: the release preview and the AI validator
should flag new ones (follow-up). Selector strings are i18n keys in the Studio.

**Verification.** `@facilis.dev/db` 17 files / 127 tests (8 permission-view tests: definer returns
cross-owner aggregates through `facilis_app`, zero rows without `app.permissions`, rows with it,
invoker unchanged, invalid/undeclared permission as data; the existing RLS leak/enforcement
tests stay green). `@facilis.dev/nitro` 20 files / 143 tests (endpoint accepts a declared permission,
400 `invalid_permission` otherwise, boot validation). IDE 83 files / 654 tests (selector,
codegen exact file with/without `permission`, client payload). Root `lint` (0 errors, 212
warnings), `typecheck` (19 tasks), `test` (19 tasks), `build` (12 tasks), file-length (674 files,
limit 300) and theme gates green.

### D-099 — Audited sudo: a framework system role and a dedicated append-only log
**Status:** accepted (2026-11-07)

The user needs server-side operations with global DB permissions when the caller's permissions
must stay narrower (a user reads a resource, the API creates a derived record with a system
identity), and wants every such access traced with the user session. A database audit table was
explicitly rejected: it disappears exactly when the transaction rolls back, and the user does not
want audit rows in the DB. The log pipeline/retention was deliberately left for later ("an easy
`console.log` for now").

**Decision.** A framework Postgres role `facilis_system` (`NOLOGIN NOSUPERUSER BYPASSRLS`, DML
grants only, no DDL, never assigned to users, never referenced by a policy) is provisioned by the
dev boot (`ensureSystemRole`, after `ensureAppRole`) or the deploy step;
`GRANT facilis_system TO facilis_app` lets the production connection `SET ROLE`.
`ctx.sudo({ operation, reason, tables }, fn)` is on authorized handlers: it validates the call
(non-empty strings, `tables` a non-empty subset of the route's `dbTables`, no nesting, **a
session is required** — jobs use `runAsSystem`), appends a `started` audit entry (fail closed: an
unwritable sink refuses the escalation), runs `fn` inside a SAVEPOINT as `facilis_system` with
`app.sudo_id`, restores `SET LOCAL ROLE facilis_app` on success (never `RESET ROLE`, which would
return to the dev superuser), and appends `succeeded`/`failed` (`errorCode:
handler_failed`, never the internal message). `runAsSystem({ actor: "system:<job>", ... })` is
the job/CLI counterpart with its own transaction and the same sink.

The trail is a dedicated append-only log, not a table: one JSON line per event on stdout
(`facilis:sudo {…}`, the default sink, replaceable with `setSudoAuditSink`), carrying id,
timestamp, event, actor (`user:<id>`/`system:<job>`), actorUserId, sessionHash (SHA-256 of the
session id, never the raw cookie), roles, tenant, route/method, the route's declared permission,
operation, reason, tables, request id, outcome, error code and duration. `writeSudoAudit` has no
update/delete counterpart. The session hash comes from `sessionMiddleware` via WebCrypto (the
auth package stays runtime-agnostic).

**Rejected alternatives.** *A raw superuser client handed to handlers*: impossible in production
(the connection is `facilis_app`) and unauditable. *Impersonating the admin app role*
(`app.roles += 'admin'`): insufficient for owner/cross-tenant writes, leaves no trail, and
silently changes what "admin" means. *A `SECURITY DEFINER` function per operation*: more DDL, no
session/request metadata, the function body becomes the permission surface. *A `sudo_audit`
table*: the trail must survive the rollback it describes; also rejected by the user. *Per-row
provenance column*: not wanted now; the log id (and `app.sudo_id` inside the block) is enough.

**Consequences.** SPEC §8.4.5 gets one named exception to "no Postgres roles" (§5.2/§8.6 too).
Sudo requires a session; jobs use `runAsSystem`. The audit is started/outcome only: the
commit/rollback of the enclosing request transaction and a hash-chained file/WORM sink are not
implemented (O-014); definer-view reads are not logged per query (O-015). An analyzer fact for
sudo call sites and the validator rule are follow-ups, as is the AST check that `tables` is a
subset of `dbTables` (the runtime check exists today).

**Verification.** `@facilis.dev/db` 17 files / 127 tests (role attributes and membership, BYPASSRLS
read/write inside the block, role restored + GUC cleared, savepoint rollback on throw,
`runAsSystem` audit ids, fail-closed sink; Postgres-wire GUC assertions in the policy test).
`@facilis.dev/core` 13 files / 100 tests (`ctx.sudo` success/failure, audit transitions, validation,
no nesting, session required, subset of `dbTables`). `@facilis.dev/auth` 6 files / 41 tests
(`sessionHash`). `@facilis.dev/nitro` 20 files / 143 tests (system-role boot warning, dev-view
permission). IDE 83 files / 654 tests; root lint/typecheck/test/build, file-length and theme
green.

**Follow-up (2026-11-07): the request DB is bounded; public routes use `ctx.system`.** The
handler event is now `FacilisHandlerEvent`: `defineAuthorizedHandler` captures the root client
and passes a copy whose `facilis` carries only `defaultTenantId`, so `ctx.db` (policy-scoped)
is the only default DB surface and any further operation goes through `ctx.sudo`/`ctx.system`.
Public or bootstrap routes with no session (registration, initial admin) got
`ctx.system({ actor: "system:<job>", operation, reason, tables }, fn)`: the same
SAVEPOINT/role/audit flow, no session, system actor recorded (no user/session hash), a shared
nesting guard with sudo. The example's registration keeps the duplicate-email read on `ctx.db`
and performs the user/default-role/initial-admin writes inside one `ctx.system` call
(`system:auth`, `user:register`). The analyzer adds a `route-direct-db` warning when route code
reaches for the raw client (raw `facilis.db` or a `createDb` import), so the direct policy-free
path is visible in the manifest and explicitly "not recommended". Verification: `@facilis.dev/core`
14 files / **109 tests** (system elevation, shared nesting, handler event without `db`),
`@facilis.dev/analyze` 10 files / **71 tests** (direct-db warning), example 5 files / 33 tests,
template consumers typecheck; the full root gates stay green.

### D-100 — Constructive validation feedback and the §9.4 retry loop
**Status:** accepted (2026-11-07)

The user reported that the IDE chat is unusable: when the 16-rule validator rejected the model's
patches, the turn dead-ended on a one-line error. `parseTurn()` already produced `fix_hint` and
`line`/`excerpt` per `ValidationError` (D-084), but nothing fed them back, so the model never
learned what to fix — the user could only retype the request and hope for a different answer.

**Decision.** The retry loop is implemented in the IDE chat, not in `@facilis.dev/ai`.

- `runTurn()` in `ide/src/ai/turn.ts` re-asks the model on a rejected answer up to
  `MAX_REPAIR_ATTEMPTS = 2` (§9.4's worst case is 3 attempts total; D-108 later removed the
  counter). The validator package
  stays a pure, synchronous function: it knows nothing about provider calls, messages or the VFS.
- A rejected answer is any failure, not only a validator error: unparseable JSON, an
  `AIResponse` contract violation or a rule violation. `AiParseFailure` carries the structured
  `findings` (rule, file, message, fix_hint, line, excerpt) and the rejected `patchedFiles`.
- `ide/src/ai/repair.ts` builds each repair request as one user-role turn: a numbered findings
  list, a reminder of the `AIResponse` contract, and the current content of the existing files
  the rejected patches tried to update or delete, capped like the rest of the prompt context.
  This is a clarification of §9.4's "not full files": a `create`/`update` patch carries the
  complete file, so re-emitting a whole-file rewrite from a `fix_hint` alone is a guess — the
  model needs the file it is editing. The cap keeps the context bounded.
- `SYSTEM_PROMPT` gains a "Validation repair" section: the repair report is not a new request;
  fix every finding and return one complete corrected object; when re-emitting a file keep every
  existing declaration (tables, columns, routes, config, keys); destructive changes only when
  asked, with `requires_confirmation: true` and a note.
- `state.repair = { attempt, max }` on the chat session exposes the progress to the UI.
- Final failure writes nothing: the findings are shown in the chat and the VFS is untouched.

**Rejected alternatives.** *Loop inside `@facilis.dev/ai`*: the validator is a pure function over
patches + context, while retrying needs the conversation, the provider stream and file reads, all
IDE-side. *Feed back `fix_hint`/`excerpt` only* (the literal §9.4 wording): documented, but it
dead-ends exactly on whole-file updates, the common case. *Unbounded file context*: the prompt
already has caps for a reason. *A snapshot of every project file*: needless tokens, and it leaks
files the rejected patch never touched.

**Consequences.** Worst case 3× the token cost of one answer; the repair context is capped per
file. Model B's `read_file` tool remains the general solution for pulling context on demand —
Model A cannot, so the loop pre-loads the files it knows the model needs. The prompt only
describes the protocol; the model still re-emits whole files, so the existing validator remains
the boundary. No write path changes: a failed turn has no proposal to apply.

**Verification.** Covered by `ide/src/ai/prompt.test.ts` (the new section and its position after
the response contract) and the IDE's repair/chat-session tests landed with task-1 (`runTurn` is
covered through ChatSession); the
Lead's final gate run (`pnpm lint`, `typecheck`, `test`, `build`) is the verification for
this change.

### D-101 — Model B is a PTC tool runtime, not preloaded context
**Status:** accepted (2026-11-07)

The user rejected the Model B strategy of passing project files in the prompt: it costs tokens on
large projects and cannot repair whole-file patches the model never saw (D-100's repair loop had
to inline the files as a stopgap). The chosen direction is PTC: the model writes one JavaScript
program per step; the IDE executes it in a sandbox against a read-only tool registry and returns
lossless JSON; the final answer is still the existing `AIResponse`, its patches validated by
§9.3 and written only by the user's Apply.

**Decision.**

- **Protocol (PTC pure):** one JSON object per turn, `script` XOR `patches`; the program is an
  async function body with `tools` as the only injected global; the run outcome (value or typed
  error) goes back as one user turn. Bounds: 6 script turns per message, 32 tool calls per
  program, 5 s wall, per-result and per-turn caps (D-108 later removed the counters; the 5 s wall
  and the size caps remain). No native function-calling mode in phase 1.
- **Sandbox:** sandboxed iframe (opaque origin) + one blob Worker per program; the iframe relays
  `{ id, tool, args }` to the IDE, which enforces path/secret/capability policy, caps and
  logging, and can drop the frame when the worker is unresponsive. The runner page is served
  with a CSP response header (`default-src 'none'`), not the Chrome-only `csp` attribute.
- **Read-only tools first:** list_files/read_file/search/get_schema/get_routes/get_config/
  get_manifest/get_i18n/get_project_summary. Patches remain the only write path.
- **`validate` tool:** the model can validate a candidate patch set with the same
  `validatePatch()` the final gate uses and fix the findings before its final answer. The final
  §9.3 gate stays mandatory (invariant 9); the goal is that it almost never fires, not that it
  is removed.
- **Extension seam:** MCP servers (remote Streamable HTTP, namespaced tools, explicit user
  enablement) and D-067 skill capabilities narrow the same registry.

**Evidence (phase 0 spike).** `spikes/ptc-sandbox/run.mjs`, Chromium 156.0.8078.47 headless with
COOP/COEP, 21/21 checks: the frame origin is `null` and the parent DOM, localStorage, IndexedDB
and OPFS are blocked; `fetch` is blocked; tool RPC and blob-Worker creation work in the opaque
frame; the worker inherits the restrictions and `terminate()` stops a busy loop; a 1.2 s busy
loop in the frame delayed the parent timer by 0 ms (isolated sandboxed iframes). The header-CSP
runner path was verified too. Only Chromium was exercised.

**Rejected alternatives.** *Preloaded file context* (the status quo, D-100 stopgap): does not
scale and cannot repair whole-file rewrites. *Native function calling only*: more round trips and
larger JSON than one program that can loop/aggregate. *Worker from a blob in the IDE origin*:
same-origin, so OPFS and storage stay reachable. *WebContainer process*: it is the app runtime
with project files and Node, not a trust boundary. *Removing the final validator*: it would break
invariant 9 — the `validate` tool makes it a pre-flight check, not a replacement.

**Consequences.** The phase-1 landing removes D-100's bounded inlined-file repair context (the
repair prompt points the model at `read_file` instead). Model A stays as the fallback until the
eval corpus shows the PTC path is at least as reliable. Cross-browser isolation and the managed
tool/server allowlist remain open (O-016, PTC.md §13).

**Verification.** `node spikes/ptc-sandbox/run.mjs` → 21/21. Phase-1 tests will cover the tool
policy, script runner, turn loop and the registry↔prompt parity.

### D-102 — Repair hardening: three corrections, per-file fix plan, canonical prompt shapes
**Status:** accepted (2026-11-07)

The first real PTC test surfaced two failures: the model's first script usually misused the
tools, and the two-correction budget sometimes ran out before a patch set was valid (one schema
rewrite produced several route findings, and each round fixed a symptom). The user asked for a
validation that works per file and repeats more often.

**Decision.**

- **Three corrections** after the first answer (`MAX_REPAIR_ATTEMPTS = 3`; `MAX_MODEL_CALLS`
  becomes 6 programs + 3 corrections + the answer = 10). The script budget is unchanged.
  (Superseded by D-108: the correction, part, program and call counters are all gone.)
- **Validation stays set-level; the feedback becomes per-file.** Per-file *validation* is not
  sound: the 16 rules include cross-patch rules (a route may reference a table added in the same
  set, a permission may be added to the config in the same set, a schema rewrite interacts with
  every existing route), so validating one file against the current project would report false
  errors. The repair report builds a **fix plan grouped by file, root cause first**
  (`db/schema.ts`/`facilis.config.ts` before route consequences, `destructive-confirmed` before
  its dependent findings), lists the files the rejected answer touched, and keeps the full
  numbered findings. The `validate` tool can still check candidate subsets while iterating.
- **Prompt hardening for the first-round failures:** canonical route and scoped-table shapes
  (copied from `examples/todo-app`), an exact script-turn example, "call every tool with one
  object argument", "the return value is the only data you receive: end with `return`", "no
  markdown fences inside the script", "read before re-emit", and the `validate`-before-answer
  rule. The response contract mentions the `script` alternative when the PTC section is present.
- **Self-correcting tool errors:** a refused call reaches the model as
  `<tool> <signature>: <reason>` (e.g. `read_file({ path, startLine?, endLine? }): path is
  required`); a program that returns nothing is reported with the `return` hint. The catalogue
  moves to `ide/src/ai/ptc/tool-specs.ts` to keep the router under the file-length limit.

**Rejected alternatives.** *Validate each patch in isolation*: false positives on the cross-patch
rules; the validator's contract is the resulting project. *Unbounded retries*: token cost; three
rounds plus a grouped plan cover the observed failures — **superseded by D-108**: the gate is
validity, so retries are unbounded and the counters are gone. *Native tool calling instead of PTC*:
out of scope (D-101).

**Consequences.** Worst case ten model calls per user message (superseded by D-108: no call cap,
no correction cap); the repair prompt gains a plan and a touched-file list, bounded by the
existing size caps. The final validator remains the only boundary
by design: the goal is that the model validates its own set first and the user rarely sees a
rejection.

**Verification.** `repair.test.ts` (root-cause ordering, plan, touched files, report cap),
`chat-session-repair.test.ts` (multi-correction until valid, role folding; D-108 removed the
attempt-count expectations),
`prompt.test.ts` (canonical shapes, object args, return rule, script contract),
`turn.test.ts` (no-value hint); full gates green.

### D-103 — The chat has one mode: PTC is always on
**Status:** accepted (2026-11-07)

The user asked to remove the non-PTC chat mode after testing the tool runtime. Keeping two paths
(preloaded context without tools, and the tool runtime behind a dev flag) doubles the surface and
lets the weaker path drift: the repair loop still carried an inline-file fallback, the prompt had
a tools/no-tools branch, and the production build behaved differently from the one under test.

**Decision.**

- `PTC_ENABLED` and `ide/src/ai/ptc/flags.ts` are gone: `chat-host.ts` always constructs the
  runner (`createPtcRunner` with a per-run tool router) and `ChatSessionOptions.runner` is a
  required field.
- `runTurn` requires the runner; there is no "tool runtime unavailable" branch and no prompt
  mode switch.
- The D-100 inline-file repair fallback is removed: the correction always sends the fix plan and
  tells the model to `read_file` the implicated files and to `validate` the exact set it will
  return (D-102).
- Production now needs the per-path headers for `/ptc-runner.html` (CSP
  `default-src 'none'; script-src 'unsafe-inline'; worker-src blob:` plus the site's COOP/COEP).
  They ship in `ide/public/_headers` (Cloudflare Pages) and in `ide/vite.ptc.ts` for
  dev/preview; another host must reproduce them. Without the CSP the iframe keeps its opaque
  origin but loses the egress block, so the header is a deployment requirement (PTC.md §5).
- The dev mock's "ptc"/"esplora" trigger stays as a no-key way to exercise the trace.
- Model A's context assembly (file list, config, manifest, AGENTS.md) stays as context, not as a
  second mode: removing it would make every first turn start blind.

**Rejected alternatives.** *Keep a fallback switch*: two chat behaviours to test and document,
and the tool runtime already covers the fallback's use cases. *Remove the preloaded context too*:
it is context assembly, not a mode. *Keep the dev flag until the eval corpus exists*: the user
wants the single path now; the eval corpus still tunes budgets but no longer gates a second mode.

**Consequences.** Every chat turn uses the PTC runtime (and therefore needs the runner page
served with its headers). The pre-PTC path remains in the spec as history (Model A, D-045/D-046).
Cross-browser isolation is still a gate (PTC.md §13); Chromium only so far.

**Verification.** `ChatSessionOptions.runner` is required and every session test injects one;
the turn loop has no runtime-off branch; `repair.ts` has no file-inlining path; the full gates
are green and `node scripts/dev/check-ptc-runner.mjs` still passes 9/9.

### D-105 — Rule 1 uses the analyzer's oxc parser; validator outages are not repairs
**Status:** accepted (2026-11-07)

The user hit `[ts-parse] db/schema.ts: TypeScript syntax could not be checked: Timed out parsing
the patched file` on a real turn. Rule 1 was injected with Monaco's TypeScript language service —
a viewer feature (IntelliSense) that is re-created on cold projects and can hang — while every
other rule already reads the framework analyzer, the warm oxc-based worker that parses the same
files. The rejection also went through the repair loop, so the model was asked to fix a timeout
it could not fix, burning corrections and ending in a misleading "invalid patch set".

**Decision.**

- The IDE's rule-1 checker is `createAnalyzerSyntaxChecker()` (`ide/src/ai/analyzer-syntax.ts`):
  it runs `analyzeProjectFiles` on the patched file (a one-file map) in the analyzer worker and
  keeps only `parse-error` diagnostics. `ide/src/ai/monaco-syntax.ts` and its test are deleted;
  Monaco remains the editor's IntelliSense surface only, and `scripts/dev/smoke-intellisense.mjs`
  keeps testing that viewer feature. Node tooling keeps `@facilis.dev/ai/node` (rolldown/oxc), so
  rule 1 has one parser family in the browser and in Node.
- `ValidationError.infrastructure` marks findings about the validator's own plumbing: rule 1
  when the checker cannot answer, and `project-analysis` when the analyzer is down. The turn
  loop returns `ChatFailureKind "validator"` without a repair round; the chat shows "validator
  temporarily unavailable — retry in a moment" and writes nothing.
- No second browser parser: the analyzer is already required by every other rule, so a Monaco
  fallback would validate half the rules with a different parser.

**Rejected alternatives.** *Keep Monaco with more retries*: that was the 6×2.5 s loop that timed
out; a viewer service is the wrong dependency for a gate. *Fallback to Monaco only when the
analyzer is down*: the analyzer is required anyway, so the fallback would be partial. *Treat the
outage as a model repair*: the model cannot fix a worker.

**Consequences.** Rule 1 fails closed on the analyzer worker (the 30 s readiness/analysis budget
in `analyze-client.ts`); a one-file analyze per patched file is cheap on the warm worker. The
validator has one parser family and the chat no longer spends corrections on infrastructure
outages: a dead analyzer surfaces as a retryable validator error, not as a bad patch.

**Verification.** `analyzer-syntax.test.ts` (parse-error mapping, non-parse diagnostics ignored,
fail closed), `validator-context.test.ts` (infrastructure flag), `turn.test.ts` (no repair on
infrastructure), `chat-session-validation.test.ts` (validator kind), i18n parity; full gates
green.

### D-106 — Large patch sets arrive in parts; a cut answer is not a parse error
**Status:** accepted (2026-11-07)

A real turn — "add attachments (upload, preview, download) to the todo app" — produced a ~28 KB
answer that the provider cut at its output limit. The cut landed right after a complete patch
object, so the JSON ended mid-array: `JSON.parse` failed with `Expected ',' or ']' after array
element in JSON at position 28469`, the chat showed that raw error, and the repair loop asked the
model to resend the whole set — which the same limit cut again, until the three corrections were
gone. The user saw "the assistant could not produce a valid patch set" for a request that was
just too large for one answer.

**Decision.**

- The client surfaces the provider's stop reason (`finish_reason: "length"` /
  `stop_reason: "max_tokens"`) as `CallModelResult.truncated` (`ide/src/ai/client.ts`); when a
  stream carries no stop reason, the parser marks a JSON error at the end of the text as
  truncated too (`ide/src/ai/response.ts`).
- The model may split a set: every part is a complete `AIResponse`, and `"continue": true` marks
  every part but the last. `ide/src/ai/turn.ts` merges the parts by path (a later part may correct
  a file), ORs `requires_confirmation`, keeps the notes and validates the merged set once
  (`ide/src/ai/patch-set.ts`); the chat shows "sending the patch set in parts (n)". The part
  count is informational only: D-108 removed the per-answer part quota, so the loop keeps asking
  until a last part arrives; a part without patches still needs a message.
- A correction **keeps the rejected set** (`beginCorrection` in `patch-set.ts`): the model re-emits
  only the files the findings name, files it omits keep their rejected patch, and `"delete"` drops
  one. This is what keeps a correction cheap: a fix to two files of a three-part set is one answer,
  not another three parts.
- A part that only repeats files already received gets an explicit continuation line instead of
  silently spending calls. (D-106 originally also capped the turn at 22 model calls and 6 parts;
  D-108 deleted every counter.)
- A cut answer is not thrown away: `ide/src/ai/salvage.ts` scans the `patches` array with a
  string-aware brace scan and keeps the complete patch objects before the cut; the turn asks for
  the rest with the list of files already received (their content is not re-sent). If no complete
  patch survives, the repair report gains a "## The answer was cut off" section with the part
  protocol instead of only the raw JSON error.
- The system prompt, the repair contract and the new large-set guidance tell the model to keep an
  answer under the output limit and send as many complete files as fit (usually 2–4).

**Rejected alternatives.** *Raise `max_tokens`*: provider- and model-dependent (Anthropic
rejects values above the model's limit) and the set already exceeds a conservative cap. *Retry
the same answer after cutting it*: the tail is lost and the next attempt has the same budget.
*Validate each part separately*: the §9.3 rules are cross-file, so a part would false-positive;
the merged set is validated once, exactly like a one-answer set.

**Consequences.** A feature spanning more than one answer completes; a cut answer keeps its work
and asks for the remainder; a genuinely malformed answer still gets the ordinary repair (now with
the part advice), with the raw JSON error as detail only. The conversation stays bounded: each
part is recorded as a synthetic assistant turn listing its paths, not the raw part content, which
would push the next request over the context window. A correction is usually a single call
because it merges, so the common large-feature turn costs one exploration pass, two or three parts
and one correction; with the part quota gone (D-108) the number of parts is whatever the set needs.

**Verification.** `salvage.test.ts` (cut tail, brace inside content, missing separator, malformed
element), `response.test.ts` (continue contract, truncation detection), `turn-parts.test.ts`
(merge, a correction that re-emits one file, salvage continuation, a nine-part set),
`chat-session-repair.test.ts` (part progress in the chat state),
`client.test.ts`/`provider.test.ts` (stop reasons); full gates green.

### D-107 — Background jobs: a durable queue on framework primitives, not Nitro's tasks
**Status:** accepted (2026-11-07); the job table declaration is amended by D-162

The user asked for background jobs: a configurable concurrency/retry/timeout budget; project code
that starts a job and optionally schedules it for a future instant; serialized input and output;
every run in a system context with the sudo audit; an id that `enqueue` returns so the caller can
read or cancel that instance; and read access to the running jobs and the queue. Jobs are
independent — chaining is a future "workflow" construct, not this feature. The project keeps its
own HTTP surface; the framework adds no route of its own.

**Decision.** No new package: the existing layer split owns the feature. `@facilis.dev/core` holds
the contract (`FacilisJobsConfig`, `defineJob`, `isJobDefinition`, `serializeJobData`,
`JobError`, `JobsApi`/`JobRecord`/`JobStatus`/`JobQueueStats`, the six-key `jobs` config
section), `@facilis.dev/db` the `facilis_jobs` table, `@facilis.dev/nitro` the runtime (virtual
module, registry, engine, stores, boot wiring, `ctx.jobs`). A new package would be another
tarball the IDE template must vendor and another version to pin.

- `facilis.config.ts` gains `jobs` with defaults `maxConcurrent: 2`, `maxAttempts: 1`,
  `retryDelayMs: 5000`, `timeoutMs: 30000`, `pollIntervalMs: 1000`, `persist: true`; a
  definition may override `maxAttempts`/`timeoutMs`. `maxAttempts: 1` keeps retry an opt-in:
  at-least-once delivery already makes a retry a business decision.
- Definitions are one default export per `server/jobs/**/*.ts`, scanned into the
  `#facilis/jobs` virtual module; an invalid or duplicate definition is a
  `job_definition_invalid` manifest warning and is skipped, never a boot failure.
- `input`/`output` are Zod schemas and both sides cross a JSON round-trip: invalid input at
  enqueue is `JobError("job_invalid_input")`, an invalid result fails the attempt
  (`job_invalid_output`). `enqueue` persists first and returns `{ id }` immediately.
- The queue is `facilis_jobs` (tenant-scoped RLS, re-exported by the project's `db/schema.ts`,
  created by a Drizzle migration). With `persist: true` it survives a worker reload or process
  restart; `start()` recovers rows left `running` — re-queued while attempts remain, else
  `failed` with an `interrupted` error. Without the table the engine degrades to the in-memory
  store plus a `jobs_table_missing` warning; a runtime that cannot start is a
  `jobs_boot_failed` warning. Boot never fails because of jobs.
- Every attempt runs through `runAsSystem` in its own transaction as `facilis_system`, with
  actor `system:job:<name>`, operation `jobs:<name>`, the definition's `tables` and the same
  audit sink as `ctx.sudo` (D-099). `runAsSystem` is relaxed to accept `tables: []` when a job
  declares no audit tables; `ctx.sudo`/`ctx.system` keep the non-empty subset rule.
- `JobsApi` is exposed only as `ctx.jobs` on an authorized handler (and on the request event
  for framework middleware): enqueue/get/list/queue/running/cancel/stats. There is no HTTP
  surface behind it; a project writes its own `defineAuthorizedHandler` route with a permission,
  a body schema and `dbTables`, exactly as the example app does.
- A route always has `ctx.jobs`. If the runtime failed to boot, the middleware omits
  `facilis.jobs` and the wrapper substitutes an unavailable API: every call rejects with
  `JobError("job_unavailable")` (added to `JOB_ERROR_CODES`). The route keeps serving — a route
  that never touches jobs is unaffected, and one that calls the API handles the coded failure
  rather than a framework-wide 500. `unavailableJobs()` stays internal; only the code is public
  through `JobError`, and the boot failure is the `jobs_boot_failed` manifest warning.
- Jobs are independent: the job context exposes no `enqueue`, so no chain is expressible and no
  workflow engine is added.

**Rejected alternatives.** *Nitro's own task system* — the primary alternative, evaluated before
the decision; `docs/JOBS.md` §3 records the pinned `nitro@3.0.260903-beta` evidence in full and
is not duplicated here. In short: `runTask` dedupes by task name and returns the same in-flight
promise, so two independent instances cannot exist; no row/id/status/retry/timeout/cancellation
exists, so there is nothing to inspect or stop; `scheduledTasks` is a static cron map, not "run at
this instant"; `payload` and result are untyped with no schema; a task is an arbitrary function
with no system role, transaction or audit; the `nitro-dev` preset mounts an unauthenticated
`/_nitro/tasks/**` execution route with no origin allowlist (against §8.5/invariant 6); and
`experimental.tasks` is process-local, so nothing survives the worker reloads the IDE triggers on
every project edit. *A new `@facilis.dev/jobs` package*: more tarball/template churn for a seam the
three existing packages already expose. *An in-memory-only queue*: loses scheduled work on every
worker reload, which is exactly when a queue matters. *Workflow/chaining inside the engine*: a job
graph is a different product surface (O-017); the durable claim/attempt counters are the seam a
later construct reuses.

**Consequences.** Delivery is at-least-once: a worker crash or timeout can run an attempt again,
so job bodies must be idempotent. A timeout aborts the attempt's `AbortSignal`; JavaScript cannot
kill a function, so the signal is the contract — a job that ignores it keeps running after the
engine has moved on. The engine assumes one long-lived server process per database (no
multi-instance claim, no serverless scheduling guarantee). PGlite is single-connection, so a
handler's `ctx.jobs` is bound to the request's policy transaction (`JobsApi.bindScope` /
`JobStore.scoped`); queue calls join that transaction instead of opening a nested one, which
would deadlock the request. The generated app's schema gains
`facilis_jobs`, so previously created projects need a migration. A broken queue degrades to
`job_unavailable` on `ctx.jobs` calls, not to a failing route. New manifest warnings:
`job_definition_invalid` (bad/duplicate definition), `jobs_table_missing` (persistence
requested, table absent), `jobs_boot_failed` (runtime could not start) and
`jobs_runtime_error` (scheduler/store failure during a tick, reported once per context).

**Verification.** `@facilis.dev/nitro` suites `src/runtime/jobs/engine.test.ts` (concurrency cap,
retry delay, timeout via an injected `JobTimers`, queued/running cancellation, schedule, stats,
stop/requeue, output-schema failure), `memory-store.test.ts`, `definitions.test.ts`
(dedupe/warnings), `db-store.test.ts` + `db-store-recovery.test.ts` (PGlite + RLS claim
round-trips, interrupted recovery, counts),
`executor.test.ts` (system role reads a row RLS hides from `facilis_app`, audit actor/tables),
`runtime.test.ts` (`runAt`/`delayMs` mapping, ISO records, `maxConcurrent` in stats,
`bindScope` delegation), `engine-scoped.test.ts` (the scoped view shares scheduler state),
`boot.test.ts` (store choice and warnings) plus `module.test.ts` (`#facilis/jobs`
registration); `db-store.test.ts` also pins the request-transaction join (the nested-`BEGIN`
deadlock regression); `@facilis.dev/db/src/sudo.test.ts` accepts `tables: []` for `runAsSystem` and
still rejects an empty string. The example app exercises it end-to-end in
`examples/todo-app/scripts/verify-headless.sh`: enqueue with a future `runAt`, read it back
`queued`, cancel it, read it back `cancelled`. The Lead's final root gates
(`lint`/`typecheck`/`test`/`build`) are the release check.

---

### D-108 — The turn loop has no call, part or correction budgets
**Status:** accepted (2026-11-07)

The chat kept dead-ending on its own counters: a large request exhausted the 6-part budget
("The patch set needed more than 6 parts, so it was not completed"), exploration exhausted the
6-program budget, and a set that kept failing exhausted the 3-correction budget ("the assistant
could not produce a valid patch set"). Each was a hard stop before the model could finish. The
user's verdict: the counters are meaningless at this point — the only thing that matters is the
validity check.

**Decision.** Delete every conversation counter from the turn loop (`ide/src/ai/turn.ts`):

- no part quota: `MAX_PATCH_TURNS` is gone; a set may take as many parts as it needs (D-106's
  merge, salvage and continuation stay);
- no model-call backstop: `MAX_MODEL_CALLS` is gone;
- no exploration quota: `MAX_SCRIPT_TURNS` is gone; the model may run as many programs as it
  needs;
- no tool-call quotas: `MAX_TOOL_CALLS_PER_RUN`, `MAX_TOOL_CALLS_PER_TURN` and
  `PtcRunOptions.toolCallBudget` are gone;
- no correction quota: `MAX_REPAIR_ATTEMPTS` is gone (`repair.ts` still caps one report at 40
  findings and echoes at most 20 000 chars of the rejected answer — size caps, not counts).

The loop ends only on: the merged set passing the §9.3 validator, a provider/transport failure,
the user's Stop (abort), or a validator outage (an internal failure the model cannot fix, D-105).
The chat keeps numbering what it shows — `part N`, `attempt N`, program N — because numbering is
progress, not a budget: `ChatState.patchParts = { part }` and `ChatState.repair = { attempt }`,
and the i18n labels lost their `/{max}` placeholders.

**Kept, deliberately, because they bound resources rather than the conversation:** the sandbox's
per-program wall clock (`RUN_TIMEOUT_MS`, 5 s), the program source cap (`MAX_PROGRAM_CHARS`,
16 KB), the run-result cap (`MAX_TOOL_RESULT_CHARS`, 64 KB), the trace-argument cap, and the
finding/echo caps above. The user's Stop button aborts the provider request and the sandbox.
`HISTORY_LIMIT = 20` in `chat-session.ts` stays too: it bounds how much conversation is
*replayed* on the next message, not how long the current turn may run.

**Rejected alternatives.** *A very high counter* (say 100 calls) produces the same dead end later;
the user asked for validity to be the gate, not a bigger number. *Applying a partial set when the
parts run out*: an incomplete set is not a project state (cross-file rules), and Apply is the only
write path. *A no-progress detector*: it is another count that can stop legitimate work; the model
already gets an explicit "none of these files is new" continuation line.

**Consequences.** A big feature — the attachment request that started this — completes without a
part quota, and a model that keeps producing invalid JSON keeps being corrected until the provider
context window or the user stops it: that error is the natural outer bound. The old failure
messages are gone with the counters. The prompt, the repair report and the continuation turn no
longer advertise a quota; they ask for as many complete files as fit in one answer.

**Verification.** `turn.test.ts` (ten exploration programs before the answer), `turn-parts.test.ts`
(nine parts in one set), `chat-session*.test.ts` (four corrections, parts progress, no dead end on
a rejected set), `repair.test.ts` (no attempt count in the report), `ptc/runner.test.ts` (every
tool call served), `prompt.test.ts` (no quotas advertised); i18n parity; full gates green.

### D-110 — The chat shows what the model is doing: reasoning and one activity row per call
**Status:** accepted (2026-11-07)

The user could not tell whether the assistant was thinking: the chat only showed the
exploration programs and the busy strip's elapsed seconds, and a provider round trip is silent
in between. The old per-call counters (D-108) had been the only visibility, and they were a dead
end, not insight.

**Decision.**

- **Reasoning stream.** `providers.ts` reads the visible reasoning each protocol exposes —
  OpenAI-compatible `delta.reasoning_content` (DeepSeek) or `delta.reasoning`
  (OpenRouter-style gateways), Anthropic `thinking_delta` — as `ProviderEvent.reasoning`,
  never mixed into `text`. `client.ts` streams it through `CallModelInput.onReasoning` and
  returns it as `CallModelResult.reasoning`; the JSON contract and the repair loop are
  untouched (reasoning is display data and is never replayed to the model).
- **Activity rows.** `turn.ts` reports every model call through `onCallStart`/`onCall` with a
  `ChatTraceCall`: number, duration, answer characters, reasoning characters, the provider's
  truncation flag and what the loop did with the answer (`script` | `part` | `answer` |
  `rejected` | `cut` | `failed`). The call row precedes the program row it asked for, so the
  timeline reads call → program → call.
- **State and UI.** `ChatState.trace` becomes `ChatActivity[]` (`ChatTraceCall | ChatTraceRun`,
  discriminated by `kind`); `ChatState.reasoning` holds the live stream of the current call.
  The call row is **inserted when the call starts** (`beginTraceCall`, outcome `running`) and
  completed **in place** (`completeTraceCall`), so the live reasoning streams inside that row
  and the timeline is strictly chronological: call → program → call. `ChatTraceView` opens the
  running row (its reasoning is what the user is watching), keeps finished rows collapsed with
  their reasoning behind them, and numbers programs separately. The wiring lives in
  `chat-turn-hooks.ts` because `chat-session.ts` is at the 300-line limit.
- **Caps are display caps:** 12 000 chars for the live block (tail) and 4 000 chars per stored
  call row. Nothing here is a budget; the loop's terminators are unchanged (D-108).

**Consequences.** A model that exposes its reasoning shows it while it works and keeps it in the
transcript; a model that does not (DeepSeek `deepseek-chat` today) still shows the call
timeline — duration, size, outcome — so the user can see whether the assistant is calling the
provider, exploring, sending parts or correcting. Reasoning is not replayed: the conversation
stays as small as before. In dev the seed model comes from `ide/.env`
(`VITE_DEEPSEEK_MODEL`); a reasoning model there is what makes the reasoning stream appear
inside the call rows.

**Verification.** `provider.test.ts` (the three reasoning fields), `client.test.ts` (streamed
separately from the text), `turn.test.ts` (one row per call, outcomes, reasoning forwarded),
`chat-session.test.ts` (live state + row), `chat-trace.test.ts` (union rows and caps), i18n
parity; full gates green.

### D-111 — The AI can inspect and drive the running app (preview tools)
**Status:** accepted (2026-11-07)

The chat could only read the project's source. The failures that cost the user the most were at
runtime — "the upload doesn't work", a 500, a click that does nothing — and the model had no way
to see them, so every diagnosis was a round trip through the user's report.

**Decision.**

- The preview page already carries chobitsu (the CDP backend the preview Service Worker injects,
  `ide/public/sw.js`), and the DevTools panel relays it to chii. A programmatic client
  (`ide/src/vv/preview-cdp.ts`) now uses the same channel without opening DevTools: per preview
  tab it sends `Runtime.evaluate` (DOM reads, click, fill) after the bootstrap `init`
  handshake, and buffers `Runtime.consoleAPICalled` / `Runtime.exceptionThrown` / `Network.*`
  events.
- The relay in `preview-devtools.ts` forwards every target message to that client (in addition to
  the DevTools frontend), keyed by the frame's tab; `PreviewSession` owns the client and exposes
  the active tab and route navigation (`navigatePreviewPath`).
- Eight PTC tools drive it (`ide/src/ai/ptc/preview-tools.ts`, with the AI-facing facade in
  `preview-access.ts`): `preview_state`, `preview_console`, `preview_network`,
  `preview_dom`, `preview_click`, `preview_fill`, `preview_open`, `preview_wait`. They are
  registered only when the host has a preview (the IDE always does); arguments are validated; with
  no running project they return `{ available: false }` as data so the model can ask for Run and
  retry.
- The prompt gains a "running app" section when a preview tool is registered: read
  `preview_console`/`preview_network` before proposing a fix when the failure is a runtime error
  or a failed request, reproduce a flow with click/fill, and never guess the runtime state.
- Safety: the tools act on the app's own data (they can create or delete rows) but never write the
  project; the only write path is still the validated patch set plus Apply (invariant 9).

**Rejected alternatives.** *A separate preview in an iframe we control*: the app under test is the
real preview (same SW, same Vite dev server, same HMR); a second renderer would prove a different
app. *CDP through a new dependency*: chobitsu is already injected; the client is ~280 lines.
*Screenshots now*: chobitsu can screencast through html2canvas, but the model still needs the
multimodal message format — that is the later slice.

**Consequences.** A runtime bug can be diagnosed from the app itself: console errors and failed
requests arrive as data, and a flow can be reproduced with clicks before the patch. The model
still cannot see pixels; a preview that is not running reports unavailable instead of failing the
program. Clicks mutate the app's dev data (not the project).

**Verification.** `preview-cdp.test.ts` (handshake, evaluate, console/network buffers, reload
cleanup, no-preview), `preview-tools.test.ts` (specs gated on the host, argument validation,
unavailable data), `prompt.test.ts` (the running-app section only with a preview tool), plus the
existing tool router suite; gates green.

### D-112 — Screenshots of the running app, and images for vision models
**Status:** accepted (2026-11-07)

Some failures are visual or layout-level, and the preview tools (D-111) only returned text. The
owner asked for screenshots as part of the running-app inspection.

**Decision.**

- chobitsu already implements `Page.startScreencast`: it renders the page with html2canvas and
  emits `Page.screencastFrame` (base64 JPEG + metadata). `PreviewCdp.captureScreenshot()` starts
  the screencast, waits for one frame (2.5 s cap, `null` on timeout) and stops it; the frame
  becomes a `data:image/jpeg;base64,…` URL.
- `preview_screenshot()` captures one screenshot per call (at most 2 per program). The image is
  attached to the program's activity row (the user sees it, clickable) and to the tool-result
  user turn.
- Images travel only for a preset that declares `vision` (Anthropic, OpenAI and DeepSeek — see
  the update below; OpenRouter auto and Custom do not). `providers.ts` builds the protocol's
  content parts —
  `image_url` for OpenAI-compatible, `image` + base64 source for Anthropic — and otherwise keeps
  the plain string content, so a text-only model never receives a content array it cannot parse.
- `AiChatTurn.images?: string[]` carries data URLs into the wire; `ChatTraceRun.images` carries
  them into the transcript. The turn loop drains `host.preview.takeImages()` after each program
  and attaches them to that program's result turn.
- Nothing is persisted or replayed: images live for the turn (and in the visible row) only; a new
  user message starts from the text transcript.

**Rejected alternatives.** *A new screenshot dependency*: chobitsu's html2canvas path already
ships in the injected backend. *Sending images to every preset*: a text-only endpoint rejects the
request or swaps in a placeholder; the preset decides. *Persisting screenshots in the
conversation*: they would bloat the replay and the provider context; the row keeps them visible,
the model only needs the current turn.

**Consequences.** The model can see a rendered page (through a vision model) and the user always
sees the screenshot in the activity row; a text-only provider still records the capture but not
the pixels. The capture is html2canvas-quality: no canvas/video/iframe content, CSS shadows may
render approximately, and it takes up to ~2.5 s (inside the 5 s program budget).

**Update (2026-11-08) — DeepSeek reads images, and the DevTools backend cannot take a better
photo.** DeepSeek V4.1 Flash accepts image parts on both aliases (`deepseek-chat` resolves to
`deepseek-flash`); verified live against `/v1/chat/completions` (a red PNG answered "Red", 197
prompt tokens) and against `/v1/models`, which lists `input_modalities: ["text","image"]` for
`deepseek-flash` and text-only for `deepseek-v4-pro` (which replaces the image with a
`[Unsupported Image]` placeholder). The `deepseek` preset therefore declares `vision: true`;
screenshots now reach the model there too.

The preview's "DevTools" are chobitsu, an in-page reimplementation of CDP, not the browser's
own protocol: its `Page` domain implements `startScreencast` (html2canvas, SVG
`foreignObject`, scale 1) and has no `Page.captureScreenshot`; and a web page has no native
capture API at all (only `getDisplayMedia`, which needs a user permission prompt). So CDP cannot
yield a sharper or more faithful photo than the screencast frame the pipeline already uses — a
higher-resolution capture would mean a second renderer in the page, not a DevTools call.

**Verification.** `preview-cdp.test.ts` (screencast frame, timeout, stop), `provider.test.ts`
(OpenAI/Anthropic image parts), `provider-vision.test.ts` (DeepSeek image part, a preset without
`vision` drops them), `turn.test.ts` (images on the result turn and the onScript callback),
`chat-trace.test.ts` (images on the run row), `preview-tools.test.ts` (screenshot handler);
gates green.

---

### D-113 — Images pasted into the chat (Ctrl+V)

**Status:** accepted (2026-11-08)

D-112 carried images only for the AI's own preview screenshots. The owner wants the user's own
screenshot in the conversation: "l'utente in caso se la scatta da solo… importante che sia
possibile inserirla tramite ctrl+v dentro la chat". CHAT-UX (O-018) had listed OS images as a
later items of the attachments slice.

**Decision.**

- Ctrl+V in the composer reads the clipboard's image files (only `image/png`, `image/jpeg`,
  `image/webp`, `image/gif`; 12 MiB per file, at most 4 images per message). `ide/src/ai/chat-image.ts`
  owns the reading and the caps; `ChatComposer.tsx` owns the pending thumbnails, the remove
  button and the skipped-files notice.
- Every image is downscaled and re-encoded before it joins the conversation
  (`ide/src/ai/chat-image-resize.ts`): longest edge 1536 px, JPEG q0.85, transparent pixels drawn
  on white; the smaller of the JPEG and the original wins, so an already-small image is never
  inflated. The generous source cap exists only because the copy that travels is the compressed
  one — a Retina screenshot lands around 100–300 KB instead of several megabytes, which matters
  because replay resends it with every later message.
- The data URLs ride on `ChatMessage.images` and `AiChatTurn.images`; D-112's wire path
  already turns them into the protocol's content parts, and only a preset that declares
  `vision` serializes them — the composer warns (`chat.image.noVision`) when the current
  provider does not.
- `replayTurns` keeps image-only messages (a paste with no text is a valid message) and merges
  the images of folded consecutive user turns, so the screenshot stays with the conversation.
  Nothing is written to the project and nothing leaves the in-memory session.
- A message with neither text nor images is still ignored, and a new chat remounts the composer,
  dropping any pending attachment.

**Rejected alternatives.** *A file picker or drag-and-drop now*: paste is the owner's explicit
path (the picker belongs to the project-file attachment slice). *Sending the raw paste*: a 4 MB
PNG replayed on every later message is waste the provider does not pay back — the canvas
downscale is a few lines and an order of magnitude. *A server-side/transform pipeline*: the IDE
is browser-only and the canvas is already there. *Persisting the images*: the conversation is
memory-only as before; localStorage would carry multi-megabyte data URLs into the origin's
quota.

**Consequences.** A pasted screenshot costs image tokens on the turn that carries it (and again on
later messages, because replay keeps it) and reaches the model only for a `vision` preset. The
16-rule validator is untouched: images never reach disk.

**Verification.** `chat-image.test.ts` (data URL, type/size caps, clipboard order, per-message
cap, undecodable file skipped), `chat-image-resize.test.ts` (the scale that fits the longest
edge), `chat-session-images.test.ts` (image-only message, replay, folding merge, empty message
ignored), `provider-vision.test.ts` (wire parts), i18n parity; gates green.

---

### D-114 — Lighter chat transcript (CHAT-UX density pass)

**Status:** accepted (2026-11-08)

With the composer changing anyway, the owner asked for the chat's graphic direction from
[CHAT-UX.md](./CHAT-UX.md): "sistema anche la grafica della chat come da istruzioni".

**Decision.**

- `ChatTraceView` drops the card chrome: one `<details>` line per step — icon left, title and
  status, right-aligned monospace meta — 11–12 px type, `hover:bg-muted/40`, expanding into the
  existing reasoning / program / tool rows. Model calls carry the brain icon, programs the
  terminal icon, and the running step spins. D-110's behaviour is unchanged: the running call
  and the latest call stay open, and the timeline stays strictly chronological (call → program →
  call).
- `ChatMessageView` makes the assistant's prose a plain full-width block (no bubble) and the
  user's message a quiet `bg-muted/70` bubble on the right; pasted images (D-113) render above
  the text.
- `ChatPanel` keeps its layout: the single scrolling transcript, the out-of-list busy status line
  and the error box are unchanged.

**Rejected alternatives.** *Collapsing the detail away*: the expanded row is the only place the
reasoning, the program and the tool results stay visible. *A density toggle*: the owner chose one
lighter style, not a switch (same reasoning as the "compact" definition in CHAT-UX).

**Consequences.** The transcript reads top-to-bottom like the harness's session view and fits more
steps per screen. Presentation only: no state, wire or contract changes.

**Verification.** Typecheck, lint, format and build; the transcript is covered indirectly through
`ChatSession` state (no component test harness exists in the repo) and a visual pass in the IDE.

---

### D-115 — Getting past the app's own login (preview tools)

**Status:** accepted (2026-11-08)

The owner asked how the AI copes with a generated app that requires a login before it can be
inspected. The preview tools (D-111) can click and type, but nothing told the model what a login
screen means.

**Decision.**

- The prompt (`PREVIEW_PROMPT` in `ide/src/ai/prompt.ts`, appended only when a preview tool is
  registered) teaches the flow: the preview runs inside the user's own session, so a login the
  user already did is usable; when the app is not logged in, the model registers a throwaway
  account through the app's own form (the development database is per project) or asks the user —
  it never guesses a real password. The guidance also says where the fields live (the app's page
  source, e.g. `src/pages/login.tsx`), that generated inputs commonly carry no `name` attribute
  (select by type or label), and that a redirect to the login route is an ended session, not a
  broken page.
- An OAuth/SSO or two-factor step lives outside the preview frame: the model asks the user to
  complete it and continues afterwards. The IDE stores no credentials, and a throwaway account
  exists only in the project's development database.
- The session is the kernel's cookie jar, one per listening port and therefore per project
  (`vendor/vivari/AGENTS.md`, "The kernel keeps the cookie jar…"): the preview frame the tools
  drive is the same one the user sees, so the user's login is shared and two projects never share
  a session.

**Rejected alternatives.** *A credential store in the IDE*: the app's dev database is ephemeral and
per project, and storing passwords would add a secret surface for no function. *A dev auth bypass
the model can use*: it would skip the real flow — the very thing being investigated — and would
have to ship in generated apps. *Seeding a demo user in every template*: the user row is app data,
not framework data, and the templates do not own their tables' contents.

**Consequences.** The model stops treating a login page as a failure and exercises the flow the way
a user would. Anything the frame cannot reach (external IdP, 2FA, CAPTCHA) is handed back to the
user.

**Verification.** `prompt.test.ts` (the login guidance appears with a preview tool and not
without one); gates green.

---

### D-116 — Binary storage runtime wiring and the multipart upload contract

**Status:** accepted (2026-11-08)

D-053 shipped `@facilis.dev/storage` as a package — drivers, signing, metadata and link tables —
but left the runtime wiring open: a generated project could not upload anything without
hand-rolling the config section, the boot, the multipart parsing and the proxy route. The
template's file attachments are the Phase 1 proof that the whole path works inside the
WebContainer.

**Decision.**

- **Config.** `FacilisConfig.storage` carries only the non-secret half, and every key has a
  default: `driver: "local"` (default; `"s3"` in production), `bucket`/`region` (required
  with `"s3"`, validated at config load), `endpoint`/`forcePathStyle` for S3-compatible
  stores, `maxUploadBytes` default 10 MiB with a hard cap of 100 MiB, and
  `tokenTtlSeconds` default 300 s with a 24 h maximum. Secrets are environment only, never
  config: `FACILIS_S3_ACCESS_KEY_ID`, `FACILIS_S3_SECRET_ACCESS_KEY`, optional
  `FACILIS_S3_SESSION_TOKEN`, and `FACILIS_STORAGE_SECRET` (the download-token HMAC key).
- **Boot.** The `facilis-context` middleware resolves storage right after the config, before
  and independently of the database, and exposes it as `event.context.facilis.storage`;
  `defineAuthorizedHandler` passes it to the handler as `ctx.storage` and falls back to
  `unavailableStorage()` when the boot refused. A production boot with `driver: "local"`
  refuses storage (`storage_local_in_production`), an S3 driver without
  `FACILIS_S3_ACCESS_KEY_ID`/`FACILIS_S3_SECRET_ACCESS_KEY` is
  `storage_s3_credentials_missing`, production without the token secret is
  `storage_secret_missing`, and an unexpected driver-construction failure is
  `storage_boot_failed`. Every failure is a manifest warning (never the
  `storage_unavailable` error code) and degrades to `available: false`: the file routes
  answer `storage_unavailable` (503) while the rest of the app keeps working. Dev writes
  `<project>/.facilis/binary/<hh>/<hash>` through the project filesystem, so the VFS/OPFS
  mirror persists it; production uses S3 (or an S3-compatible endpoint) under `blobs/<hash>`.
- **Multipart.** `body` and `form` are mutually exclusive on `defineAuthorizedHandler`; with
  `form` the wrapper reads `req.formData()`, collapses repeated names to arrays, validates
  them with the declared Zod schema and hands the parsed fields to the handler as `ctx.form`.
  A missing or malformed multipart body is `invalid_input`; JSON routes are unchanged.
- **Helpers.** `@facilis.dev/nitro/storage` exports `storeUpload` (enforces
  `maxUploadBytes`, stores the bytes, inserts the `facilis_files` metadata row and returns
  `{ id, name, mime, size, url }`) and `sendStoredFile` (verifies the HMAC token, loads the
  metadata row and streams the blob, or redirects to a driver-presigned S3 GET). The helpers
  do not attach the file to a parent: the project route inserts the generated `fileLinks`
  row through `ctx.db`, so attachment stays an ordinary RLS-checked write.
- **Download.** `GET /api/files/:id?token=…` is written with `defineAuthorizedHandler` and
  `permission: []`: the short-lived token is the credential, so `<img src>` and shared links
  work without a cookie, while every mutation (upload, attach, delete) stays
  session-authenticated. Responses serve the stored mime with
  `x-content-type-options: nosniff` and an attachment `content-disposition`, so user content
  never renders as a privileged same-origin page.
- **Errors.** `file_too_large` (413) and `storage_unavailable` (503) join the closed core
  registry (O-002); malformed input stays `invalid_input` (400).
- **Metadata policies.** `facilis_files` ships **two** policies: a RESTRICTIVE
  `tenant_isolation` (the structural boundary) and a PERMISSIVE
  `facilis_files_tenant_access` whose predicate is just "a tenant is set"
  (`nullif(current_setting('app.tenant_id', true), '') IS NOT NULL`). A restrictive policy
  only narrows what a permissive one already allows, so without the permissive gate the
  policy-scoped `facilis_app` role cannot insert the metadata row (42501), exactly like the
  auth and job tables (D-008). The generated link table keeps its own restrictive tenant
  policy and the permissive `parent_access` policy that inherits the parent's RLS.
- **No GC.** D-053's rule is unchanged: bodies are immutable and deduplicated, and deleting
  the metadata row is what a user sees as deletion.

**Consequences.** A generated app gets working attachments from its first commit. A project
that declares nothing still has working dev storage, and when the boot degrades only the file
routes fail — the rest of the app is unaffected. Production refuses the dev driver instead of
silently writing local files a deployment cannot serve. The template's `todo_files` link
table makes the attachment a real, introspectable table (RLS inherited via `parent_access`),
and the analyzer synthesizes it from `fileLinks`, so the manifest, project graph and release
preview see it.

**Verification.** The `@facilis.dev/storage` suites from D-053; `@facilis.dev/core` route/config/
input/errors suites pin the form-XOR-body rule, the storage defaults/validation and the two
new codes; `@facilis.dev/nitro` covers the boot target and both helpers; `examples/todo-app`'s
`verify-headless.sh` uploads and downloads a file; the IDE drift tests
(`example-template`, `release-routes`, `release-schema`, `starter-contract`) pin the
template wiring; `pnpm ide:smoke` proves the path inside the WebContainer.

---

### D-117 — Optional at-rest encryption for binary storage

**Status:** accepted (2026-11-08)

D-053 and D-116 store every blob in plaintext: the local driver writes plaintext into the
project's VFS/OPFS, and production writes plaintext into an S3-compatible bucket. S3 SSE
protects the bucket, but not a copied body, a bucket operator, or a dev mirror. Some
deployments need the stored bytes unreadable while keeping D-053/D-116's content-addressing,
dedupe and presign path unchanged for every project that does not ask for it, so encryption
is an opt-in layer rather than a new default. It also has to fit the streaming rule: the
storage, crypto and download path never buffers a whole file (the platform's multipart parser
is the one place the upload is materialized, and it is bounded by `maxUploadBytes`).

**Decision.**

- **Config.** `storage.encryption = { enabled: boolean }`, default `false`, is the only
  encryption value in `facilis.config.ts`; the schema is strict (an unknown key is a config
  error) and the whole section still defaults, so a project that declares nothing keeps
  D-116's plaintext behaviour. Key material is environment only.
- **Keys.** `FACILIS_STORAGE_ENCRYPTION_KEY` is the active key-encryption key (KEK): 32 bytes
  as base64 or as a 64-character hex string, required when encryption is enabled.
  `FACILIS_STORAGE_ENCRYPTION_KEY_ID` labels it (default `primary`; `/^[A-Za-z0-9._-]{1,64}$/`,
  embedded in the blob header, so it must be safe ASCII).
  `FACILIS_STORAGE_ENCRYPTION_RETIRED_KEYS` is an optional JSON object `{ keyId: key }` of
  decrypt-only rotation keys. Dev needs an explicit key too: unlike the download-token secret
  there is no per-boot random fallback, because blobs written with a one-boot key would become
  undecryptable after a restart.
- **Warnings.** Enabled without a key is the `storage_encryption_key_missing` manifest
  warning; an unparseable key, an invalid key id or malformed retired-keys JSON is
  `storage_encryption_key_invalid`. Like D-116's warnings they never fail the boot:
  `ctx.storage.available` is false and the file routes answer `storage_unavailable` (503)
  while the rest of the app keeps working.
- **Crypto.** AES-256-GCM envelope encryption, applied as a stream. Each blob gets a random
  256-bit data key (DEK), wrapped by the active KEK; the stored object is a self-describing
  `FACILIS1` header (version 1, key id, 1 MiB chunk size, wrap nonce, wrapped DEK) followed by
  the chunks, each with its own nonce and tag. There is no plaintext length and no chunk count
  in the header: each chunk's AAD binds the full header, the chunk index and a final-chunk
  flag, the KEK wrap authenticates the header prefix, and holding one chunk back is what marks
  the last one. Editing the key id, reordering chunks, truncating the body or appending bytes
  all fail authentication, and the encryptor never needs the size up front.
  `encryptStream`/`decryptStream` and `createEncryptedStorage({ driver, keys })` in
  `@facilis.dev/storage` do this while streaming: the encryptor holds one 1 MiB plaintext
  chunk, and the decryptor keeps up to two ciphertext frames (about 2 MiB) in flight to
  establish whether the last chunk is final.
- **Streaming.** Bytes are async iterables at every layer: `StorageDriver.put` takes a
  `BlobSource` and hashes (and encrypts) while writing, and `get` validates the hash and
  returns a `BlobSource`; `@facilis.dev/core` mirrors that as `StorageStream`. The local driver
  writes to a temp file and renames the finished blob into place. An S3 PUT must know the
  payload hash and length for SigV4, so the driver stages the upload stream (ciphertext when
  encryption is on) to a `0600` temp file while hashing and counting it, uploads from that file
  and deletes it.
  `sendStoredFile` returns the plaintext stream as the response body, with `content-length`
  taken from `facilis_files.size` (the plaintext size). One qualification keeps that honest:
  the platform multipart parser (`request.formData()`) materializes the uploaded form once,
  bounded by `maxUploadBytes` (default 10 MiB, hard cap 100 MiB), before the file is streamed
  into storage — uploading is not zero-copy for the whole request, only the framework's
  storage/crypto path is.
- **Content addressing.** The content hash is sha-256 of the **stored** bytes — ciphertext in
  encrypted mode. Equal plaintexts therefore produce different blobs and different hashes,
  which deliberately disables cross-upload dedupe (and stops the store revealing equality);
  `facilis_files.size` and `maxUploadBytes` stay the plaintext size, because the metadata
  describes the user's file.
- **Downloads.** An encrypted deployment has no S3 presigned redirect: the bucket holds only
  ciphertext, so handing a browser a bucket URL would serve ciphertext. The wrapper exposes no
  `signedGetUrl`, so `sendStoredFile` always proxies through the app and decrypts while
  streaming, with the response size taken from the metadata row. S3 server-side encryption
  (SSE-S3/SSE-KMS) is orthogonal and can be layered underneath: it protects the bucket, while
  this layer protects a copied body or a reader of the bucket.
- **Rotation and enabling it later.** Rotation is: make a new key active and move the old key
  into `FACILIS_STORAGE_ENCRYPTION_RETIRED_KEYS`. Every blob names the key that wrapped its
  DEK, so a retired key keeps decrypting old blobs while new uploads use the active one.
  Enabling encryption on a project that already holds plaintext blobs refuses those blobs
  (the decrypt stream sees no `FACILIS1` magic and the first read throws, so the download fails
  instead of ever returning plaintext) — they must be re-uploaded. There is no online
  re-encryption and no GC: D-053/D-116's immutable-body and no-sweeper rules are unchanged.

**Consequences.** Plaintext projects are unchanged byte-for-byte (default off: same hashes,
dedupe and presign path), so D-053 and D-116 keep their contracts. An encrypted deployment
loses cross-upload dedupe — storage grows with uploads, not distinct content — pays per-blob
crypto overhead and proxies every download through the app instead of redirecting to S3. Both
modes stream: the download size header comes from the metadata row, and an S3 upload trades a
bounded temp-file staging step (disk, up to `maxUploadBytes`) for a signed payload. The
platform's multipart parser still materializes the upload form once before the stream starts.
The stored hash is a ciphertext address, not a plaintext one, so tooling must not use it to
detect equal content.

**Verification.** `packages/storage/src/encryption.test.ts` pins the stream: empty, one-byte,
chunk-boundary and multi-chunk round-trips; independence from how the source and stored blob
are chunked; the self-describing header and key id; no plaintext and no repeated ciphertext;
failure on an unknown/wrong/short key, a flipped ciphertext byte, an edited header, truncation
and a plaintext legacy blob; and rotation with a retired key. `encrypted.test.ts` pins the
wrapper: streamed ciphertext, plaintext size returned, dedupe disabled (equal plaintexts
become distinct hashes) and no `signedGetUrl`. `s3.test.ts` pins the streamed PUT (SigV4
payload hash, temp-file staging) and GET. `@facilis.dev/nitro`'s `storage-encrypted.test.ts`
uploads a multipart file through encryption and downloads it byte-for-byte with a plaintext
`content-length`; `storage-target.test.ts` pins the two key warnings and the absent presign;
`@facilis.dev/core`'s config suite pins the strict `encryption` section; the D-053/D-116 plaintext
suites stay green.

---

### D-118 — MCP servers as remote PTC tools (PTC phase 3)

**Status:** accepted (2026-11-08)

The owner wants the assistant to use MCP servers to speed up app development. PTC.md §8 had
planned this seam (phase 3: "MCP client + project-level enablement + managed allowlist"); this
entry lands the client and the registry, and leaves the settings UI and the managed allowlist as
the remaining pieces.

**Decision.**

- **Transport: remote Streamable HTTP, in the page.** JSON-RPC 2.0 over POST with
  `initialize` / `notifications/initialized` / `tools/list` / `tools/call`; the reply is either
  JSON or an SSE stream, both read by `ide/src/ai/mcp/mcp-client.ts` (session id and negotiated
  protocol version are echoed on later requests). Per-request timeout 15 s; inside a program the
  5 s wall clock is the tighter bound, so a remote call must be the program's main work.
- **Registry: an MCP tool is a PTC tool.** The name is `mcp_<server>_<tool>` (sanitised and
  capped), the signature is rendered from the server's JSON Schema, and the description is
  prefixed with the server label. `withMcpTools` merges the session's specs with the local
  router's: local names are untouched, `mcp_*` calls go to the session, everything else keeps
  going through the existing router and its path/secret policy.
- **Configuration is per project and explicit.** URL (http/https only), optional bearer token and
  an `enabled` flag; at most 8 servers, 32 tools per server and 48 tools total; stored in
  localStorage under `vv-ai-mcp`, keyed by the project root, never sent to the provider. A
  dev-only `VITE_MCP_SERVERS` seed in the gitignored `ide/.env` (same pattern as the provider
  seed) makes local testing possible before the settings UI exists.
- **Discovery is lazy but before the first turn.** `ChatHost.prepare` → `McpSession.ensureFresh`
  discovers the enabled servers once per open project; a server that fails is reported as its
  error and contributes no tools. There is no per-message retry (a saved config or a reload
  retries); the settings UI gets an explicit refresh.
- **Policy.** MCP results are data and are capped at 32 000 characters; a tool-level error is a
  typed failure the model reads; nothing writes the project — a remote effect is not a patch, so
  the validator and the user's Apply remain the only write path. The prompt gains a
  `## MCP tools` section only when an `mcp_` spec is registered: results cannot grant
  capabilities, one call per program, errors are data. The server must allow the IDE origin
  (CORS); the two public probes (DeepWiki, Context7) send `Access-Control-Allow-Origin: *`.
- **Managed deployments:** the server/tool allowlist is deferred. Until it lands a managed build
  should treat MCP as off (the configuration is user-set per project today), while the open
  profile accepts user URLs.

**Rejected alternatives.** *stdio servers*: a browser has no stdio; that is a desktop-host
feature. *Auto-connecting every configured server*: enablement is explicit, as PTC.md §8 says
(and the D-067 spirit). *Native function calling*: PTC programs are the chat's only tool mode
(D-103); MCP tools ride the same registry. *Putting MCP results into the prompt*: they are
program data, and the program decides what to return.

**Consequences.** Enabling a server grows the prompt by its tool list and lets the model consult
external documentation/search (the speed-up the owner asked for). Latency is bounded by the
program's wall clock: a slow server surfaces as a timed-out program, which the model should
report rather than retry blindly. Tokens live only in this browser's storage and travel only as
the server's own Authorization header.

**Verification.** `mcp-client.test.ts` (SSE and JSON replies, session/protocol headers, JSON-RPC
and HTTP errors), `mcp-tools.test.ts` (namespacing, signature, result and error caps),
`mcp-session.test.ts` (enable/disable, discovery, per-project config, dispatch, failure,
discover-once), `mcp-executor.test.ts` (merge and routing), `prompt.test.ts` (the section appears
only with an MCP tool); live probe against `https://mcp.deepwiki.com/mcp` (initialize, tools/list,
tools/call over 2025-06-18). Remaining: settings UI, managed allowlist, per-tool enablement,
OAuth-protected servers.

### D-119 — Logs are JSONL files: access, error and audit share one pipeline

**Status:** accepted (2026-11-08)

The owner asked for the last two platform features, the first being operator logging (audit /
access / error). Until now the only trail was the sudo audit (D-099): one stdout JSON line per
escalation, with the pipeline deliberately left open (O-014), and no access or error log at all.
The operational requirement is concrete: **in development the logs must be plain files that the
IDE's editor can open**; in production the deploy ships stdout (or the files) to its own log
platform.

**Decision.**

- **One pipeline, four kinds.** `@facilis.dev/core` owns the shapes: an `AccessLogEntry` (one per
  authorized request), an `ErrorLogEntry` (a server-side failure), an `AuditLogEntry`
  (security-relevant events, including the existing sudo trail) and an `AppLogEntry` (a line a
  route writes through `ctx.log`). Every entry carries a `ts`, a `level` and, when request-scoped,
  the correlation `requestId`, the user id, the session hash and the tenant — never the email,
  the cookie or a bearer token.
- **Access is structural.** `defineAuthorizedHandler` records exactly one access entry on
  **every** exit path: 401/403, `400 invalid_input`, `503 db_unavailable`, a handler result and an
  unexpected throw. The fields are method, pathname only (query strings can carry tokens),
  status, duration, request id, user id, session hash and tenant, plus the User-Agent only when
  `logging.includeUserAgent` is on. No route has to remember to log itself.
- **Errors stay server-side.** An unexpected handler failure is recorded with the canonical code
  (`internal_error`), the error name, message and stack; the client still receives only
  `{ code }` (SPEC §6.4). A missing logging runtime falls back to the previous `console.error`
  trace, so the wrapper stays usable in a bare Fetch runtime.
- **The audit stream is never filtered and stays fail-closed.** Audits ignore
  `logging.level`/`logging.access`/`logging.errors`; the db package's
  `setSudoAuditSink` is bridged into the same sink, so a sudo entry becomes
  `event: "sudo:started|succeeded|failed"` with its actor, roles, operation, reason, tables,
  request id, method/path, tenant, session hash, outcome, error code and duration. If the audit
  sink is not writable the write throws and sudo refuses to escalate (D-099 unchanged). Only the
  access/error/app streams are best-effort: a broken file must never fail a request.
- **Files, not an endpoint (owner decision, 2026-11-08).** Entries are JSON Lines in
  `<projectRoot>/.facilis/logs/{access,audit,error,app}.jsonl` (one object per line, no pretty
  printing), which is the project's existing internal-state directory. `FACILIS_LOG_SINK` =
  `auto|stdout|file|both` selects the sink: `auto` (the default) writes files when
  `NODE_ENV !== "production"` and stdout in production, so the IDE workflow needs no setup and a
  deploy needs no disk. `FACILIS_LOG_DIR`, `FACILIS_LOG_MAX_BYTES` (default 10 MiB),
  `FACILIS_LOG_KEEP` (default 5) and `FACILIS_LOG_LEVEL` complete the environment surface.
  Sinks are env-owned like the database target and storage credentials: a project must not be
  able to redirect an operator's trail.
- **No HTTP surface, not even dev-only.** A log endpoint would expose request paths, user ids,
  session hashes, client IPs and stack traces to anyone who can reach the dev server, and the
  dev origin allowlist is not a boundary inside the browser VM. The IDE viewer reads the files
  through the kernel VFS and opens them in the editor instead.
- **Redaction and caps.** Keys matching token/secret/password/cookie/authorization/set-cookie/
  api-key/credential/SAML payload/assertion/email/session-id (case-insensitive) are redacted in
  `data`/`details`; object depth 6, arrays 50, strings 1000 characters, cycles marked. Headers
  and request/response bodies are never logged.
- **Rotation and retention.** Before an append would pass the byte cap the active file shifts to
  `.1`, `.2` … keeping `FACILIS_LOG_KEEP` files; the writes are serialized synchronous appends
  (the runtime is single-process). Retention/WORM is the deploy's responsibility (O-019), not the
  framework's.
- **Tamper evidence.** File-written audit entries carry `seq`, `prevHash` and `hash` =
  SHA-256 over a stable canonical JSON of the entry without the hash fields, and
  `verifyAuditChain` verifies a readback. The chain is tamper-evident within a file, not
  tamper-proof (it has no secret key); a deploy that needs WORM ships the stdout/file stream to
  storage it cannot rewrite.
- **Request id.** The logging middleware accepts an inbound `x-request-id` only when it matches
  `^[A-Za-z0-9._-]{8,128}$` (otherwise it generates one), returns it in the response and puts it
  on the event context; the route wrapper reuses it, so access, error and audit entries for one
  request correlate without ever logging a header wholesale.
- **Config is small and defaulted.** `logging: { level, access, errors, includeUserAgent,
  trustProxy }` in `facilis.config.ts`; the environment overrides the level and owns the
  destination. `trustProxy` is off by default, so `x-forwarded-for` is ignored unless a deploy
  says it terminates a trusted proxy.

**Rejected alternatives.** *A database log table*: a rolled-back transaction would erase the
record of what it touched, it would write-amplify every request, and the audit trail must not be
subject to the RLS/write policy it describes. *A dev-only `GET /__facilis/dev/logs`* (the
original sketch): rejected by the owner — a log endpoint is a security liability, and files are
the artifact the IDE already knows how to open. *Per-route logging calls*: a route that forgets
one removes the security record; the wrapper is the only place that cannot forget. *Sampling
audit entries*: an audit trail with holes is not an audit trail. *A separate `FACILIS_AUDIT_SINK`
protocol*: the sudo audit is one of the four streams, not a parallel mechanism. *Logging the raw
`Drizzle` client's SQL*: query text can contain user data; pgaudit/log-statement is the
database-level tool for that (O-015).

**Consequences.** Development accumulates bounded log files inside `.facilis/` (already
gitignored), which operators and the IDE can inspect with any text tool; production defaults to
stdout so a platform can collect it; a project that wants files in production sets
`FACILIS_LOG_SINK=file`. Access volume is one line per API request, not per static asset. The
audit file doubles as the sudo trail with a verifiable chain, while WORM/HMAC and external sinks
remain open (O-019). The IDE viewer is read-only and cannot mutate or delete the files.

**Verification.** `@facilis.dev/core`: the config section defaults/cross-checks, access entry on
401/403/400/503/success/throw, error entry never reaches the client, audit actor for a session vs
anonymous, request-id fallback. `@facilis.dev/nitro`: env resolution and defaults, stream routing,
redaction/caps, level filtering, rotation and keep, audit chain verify (good and tampered),
fail-closed audit, best-effort access writes, middleware request-id/attach, bootstrap wiring and
the sudo bridge (the existing db sudo tests stay green). `@facilis.dev/ide`: the logs panel model
(parse, filters, rotation ordering) and its VFS read path. `docs/LOGS.md` is the operator
contract; the no-HTTP rule is also asserted by the absence of a route in the module registry.

---

### D-120 — Single sign-on: OIDC, generic OAuth2 and SAML as framework auth

**Status:** accepted (2026-11-08)

The owner asked for single sign-on (OIDC / SAML / OAuth2) as the second and final missing
feature. Facilis already owns the session, RBAC, users and roles (SPEC §5.3): a password login is
an app route blueprint, sessions are opaque rows and every request is tenant-scoped. SSO belongs
in that same subsystem — not in each generated app — so the flows cannot drift or be implemented
insecurely per project.

**Decision.**

- **Configuration is code, secrets are environment.** `auth.sso.providers` is a discriminated
  union on `kind` (`oidc`, `oauth2`, `saml`): id, label, discovery/manual endpoints, client
  id, scopes, mapping, `autoProvision` and an optional `defaultRole`. A secret is named by the
  ENV VAR ( `clientSecretEnv` / `certificateEnv`), never stored in the config. `defineConfig`
  validates ids (URL-safe and unique), URLs, `defaultRole` against `auth.roles`, token auth mode
  and redirect paths eagerly, so a broken provider fails at boot, not at first login.
  `auth.sso` adds `failureRedirect` (same-origin path, default `/login`) and `stateTtlMs`
  (default ten minutes).
- **Framework-owned routes, one handler.** `/api/auth/sso/**` is registered by `@facilis.dev/nitro`
  in dev and production alike and handled by one `defineAuthorizedHandler` with
  `permission: []`: `GET /api/auth/sso/providers` (`{ providers: [{ id, label, kind,
  startUrl }] }`, no secrets), `GET /api/auth/sso/:provider/start` (302 to the IdP) and
  `GET|POST /api/auth/sso/:provider/callback` (302 back to `redirectTo` or to the failure
  redirect with `?sso_error=<code>`). A provider whose secret/certificate env var is missing is
  hidden from the list and answered with `sso_provider_unavailable`. App-owned login/register
  routes are unchanged; the namespace is reserved by the framework and documented in SPEC §5.3.
- **OIDC** is authorization code + PKCE (S256) + nonce + single-use state; discovery is fetched
  from `<issuer>/.well-known/openid-configuration` and cached per provider; the ID token is
  verified with `jose` (JWKS, issuer, audience = client id, nonce, expiry), with a userinfo
  fallback only when the email claim is missing. `client_secret_post`, `client_secret_basic` and
  public-client `none` are supported.
- **Generic OAuth2** uses explicit authorization/token/userinfo endpoints and a dotted-path
  mapping (`subject`/`email`/`emailVerified`) for the userinfo JSON, with the same
  authorization-code + PKCE S256 flow (sent unconditionally; a provider that does not implement
  PKCE ignores the unknown parameters per RFC 6749, while a public `tokenAuth: "none"` client is
  protected). Email verification is claim-driven; a provider that never reports it must opt in
  with `assumeEmailVerified`.
- **SAML** is SP-initiated Web Browser SSO: an `AuthnRequest` built by the framework
  (HTTP-Redirect binding, deflate+base64, unique request id, ACS URL, audience/issuer) and an
  HTTP-POST ACS. Assertions are validated by `@node-saml/node-saml`, imported **lazily** inside the
  SAML path so a project that does not use SAML never loads it at runtime; a production server
  build may still emit it as a separate on-demand chunk, and the WebContainer dev path only
  reads it from node_modules if SAML is actually configured.
  `wantAssertionsSigned` defaults to true (response signing is opt-in), clock skew is 5 seconds,
  and InResponseTo is checked when present in addition to the single-use RelayState. IdP-initiated
  SSO is not accepted (no unsolicited assertion surface).
- **Account linking is conservative.** The identity key is `(provider, subject)`, so a changed
  email never breaks the link. Without an identity, an email must be **verified** and is matched
  against `users`: an existing user gets the identity linked; otherwise `autoProvision` (default
  true) creates the user with a null password hash and the provider's `defaultRole` or
  `auth.defaultRole`. Unverified email never links or provisions (`sso_email_unverified`), and
  `autoProvision: false` refuses unknown users (`sso_account_not_found`). Writes to
  `users`/`user_roles`/`auth_identities`/`auth_sso_states` run only inside the audited
  `ctx.system` elevation, never on a raw client; the session is created with the framework's
  `createSession` and the cookie helper, exactly like a password login.
- **Tables.** `auth_identities` (`(provider, subject)` PK, user id, email, tenant, timestamps) and
  `auth_sso_states` (single-use state, provider, nonce, PKCE verifier, SAML request id, redirect,
  expiry, tenant) live in `@facilis.dev/auth` with the standard restrictive tenant RLS plus a
  permissive tenant-scope policy; the project ships the generated migration.
- **Audit and privacy.** `ctx.log.audit` records `auth:sso:start`, `auth:sso:login`,
  `auth:sso:link` and `auth:sso:provision` with the provider id and outcome only. Tokens,
  authorization codes, SAML payloads and email addresses are never logged (D-119's redaction is
  the second line of defence).
- **Public origin.** The callback/ACS URL is derived from `FACILIS_PUBLIC_ORIGIN` when set,
  otherwise from the request origin; a deploy behind a proxy must set the variable and register
  `https://<origin>/api/auth/sso/<provider>/callback` at the IdP. `redirectTo` is restricted to
  same-origin paths (no `//`, no backslash), which closes the open-redirect hole.

**Rejected alternatives.** *Per-app SSO route blueprints*: every generated project would
reimplement state/PKCE/signature checks, and a bug would be a vulnerability. *Secrets in
`facilis.config.ts`*: the config is committed. *Hand-rolled XML signature verification*: XML
canonicalization is precisely where SAML implementations get broken; node-saml is maintained and
only loaded when needed. *IdP-initiated SAML*: it removes the request binding and turns the ACS
into an unsolicited-assertion endpoint. *Auto-linking unverified emails*: an account-takeover
primitive. *Leaving SSO to the app's own OAuth client for Git*: D-082's device flow is scoped to
Git operations and never creates a Facilis session. *A static `@node-saml` import*: it would
pull a CJS crypto tree into every project's in-VM bundle, including projects with no SAML.

**Consequences.** Projects without `auth.sso.providers` are byte-for-byte unaffected (empty
`providers` is the default). A project enabling SSO needs its DB, the secret/cert env vars and
the callback URL registered at the IdP. SAML adds `@node-saml/node-saml` (and its tree) to
the generated project's install; the import is lazy, so boots and non-SAML logins do not touch
it. Passkeys, TOTP/2FA, SCIM provisioning and token refresh are explicitly out of scope (O-020).

**Verification.** `@facilis.dev/auth` SSO tests: config/provider resolution (hidden when a secret is
missing, public list shape), state single-use/expiry and redirect guard, PKCE/challenge and
authorize URLs, OIDC ID-token verification against a local JWKS (valid, wrong nonce, wrong
audience, expired), OAuth2 mapping and emailVerified policy, identity rules (existing identity,
link by email, provision, autoProvision off, unverified email, role assignment), SAML request
generation and ACS rejection (tampered/unsigned), audit entries without secrets. `@facilis.dev/nitro`:
the route dispatch (providers, start 302, callback 302 + cookie, unknown path 404, SAML POST body
validation) with an injected fetch. The example app migration/schema and the login page are
covered by the starter contract; a real-IdP checklist is in `docs/SSO.md`.

---

### D-121 — `blocks` is not part of the project config
**Status:** accepted (2026-11-08)

`facilis.config.ts` carried a `blocks: { packages: string[] }` section whose only consumer was
the AI validator's block-import rule: it named extra packages that ship `BlockManifest`s. The
generated project no longer composes external UI packages — the v2 frontend copies Base UI
primitives into `src/components/ui` (D-090, D-096) — so the section described a supply chain
nothing ships.

**Decision.** Remove `blocks` from `FacilisConfig`/`FacilisConfigInput` and its Zod schema (a
config that still declares it fails the strict object check instead of being silently ignored),
from the analyzer's `ConfigFacts.blocksPackages`, and from the example. AI rule 7
(`block-import-valid`) keeps validating imports of the one shipped `@facilis.dev/blocks` package
through its `DEFAULT_BLOCKS_PACKAGE` constant; the manifest's `BlockManifest` contract is
unchanged.

**Consequences:** SPEC §7.1 and Appendix B no longer list the section; the example config shrinks
by one entry. Block discovery (O-004) remains a Phase 5 concern for the shipped package, not a
project knob.

---

### D-122 — The generated project marker lives in `.facilis/`
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

---

### D-123 — A new project starts as a git repository
**Status:** accepted (2026-11-08)

The generated project ships a `.gitignore` and D-065 relies on the project's git history as the
undo for updates, but "New project" left the folder uninitialized: the ignore rules did nothing
until the user ran Source Control → Initialize, and a user who initialized later could stage
`node_modules/` before noticing.

**Decision.** `createProject` calls the existing `ScmSession.init` after the template is written
and the folder is open. Init is idempotent (`git init` on an existing repo is a no-op), seeds the
default `.gitignore` only when the project lacks one, and uses `main` as the default branch. It
creates no commit: the user reviews and commits from Source Control. The GitHub clone/scaffold
paths are untouched — they already have `.git`.

**Consequences:** the new project appears in Source Control immediately as an untracked repo; the
isomorphic-git chunk loads lazily on creation; no network is involved.

### D-124 — The bottom panel is closed by default; the status bar is its only door
**Status:** accepted (2026-11-08)

The IDE inherited VS Code's chrome, where the bottom panel (Console / Terminal / Ports) is
opened from a layout toggle in the title bar and every run force-opened it to narrate
`npm install`. That fits a developer's editor and misfits this product's main user, who is
building an app in the browser: the console is kernel narration nobody needs, the terminal is
only how the app gets started, and "ports" are in-VM listeners reached through the preview, not
host ports. The panel was also the only way to start a project (command palette, or the create
dialog's "Install and run" checkbox) and there was no Stop.

**Decision.** The bottom panel starts closed and nothing opens it implicitly — not a run, not
opening a project. Its three surfaces are opened from chips at the right of the status bar
(Console icon-only, Terminal, Ports with a live count); clicking the active chip closes the
panel, and the panel no longer carries its own tab strip. The same status bar row carries
`Run`/`Stop` for the active folder: idle → `Run`; during install → a spinner with the phase,
which opens the terminal; once the preview paints → `Running` (opens the preview) with `Stop`;
a run that dies before binding a port leaves `Start failed`, which opens the terminal. The title
bar keeps a Run/Stop twin and loses its panel toggle; the empty preview gains a `Run project`
CTA and the same failure state. `runProject` no longer opens the panel or focuses a terminal,
and `stopRun` closes only the terminal a run created (a hand-typed `npm run dev` is not ours to
stop).

**Consequences:** the first run is watched in the preview and the status bar, not the terminal;
a failed install is visible without opening anything; the run readouts (`runTerminalId`,
`runFailed`) live in the snapshot and `controller.ts` stays under its ratchet without growing
(the dead upstream demo-run path it replaced is gone); the touched chrome files were migrated to
`t()` (D-043) and are ticked in `ide/I18N.md`.

### D-125 — The project graph is a primary development surface: live drag, free attachment, editable curves
**Status:** accepted (2026-11-08)

The graph was a schematic: edges only left/right with smoothstep corners, a controlled React
Flow node list that snapped into place on drop, and route cards that did not show the request
shape. Using the graph alongside chat as the main development surface needs it to feel direct.

**Decision.** The graph canvas is interaction-first:
- **Live drag.** Nodes are local React Flow state (`applyNodeChanges`): the card follows the
  pointer and the committed position is written to `.facilis/graph.json` on drag stop only.
- **Free attachment.** Edges are floating: an endpoint is the intersection of the node rectangle
  with the centre-to-centre line, recomputed from measured bounds while dragging, so an edge can
  leave and enter any side (a self-reference loops) as the layout grows in every direction.
- **Editable curves.** The edge path is a cubic bezier; selecting an edge reveals a midpoint
  handle that drags a per-edge offset, persisted as `edgeCurves` in the layout file (schema v2;
  version 1 files still load). Double-click straightens an edge; "Reset layout" clears positions
  and curves. The layout stays local editor state (D-052/D-092), never project source.
- **Route input in the graph.** `RouteNodeData` gains the analyzer's `input` presence facts
  (body/form/query/params) and the IDE derives path parameters from the route template; route
  cards show them as chips, so the graph is also the API-contract view.

**Consequences:** no new project file and no new write path (the existing layout writer gains one
schema version); the analyzer graph contract change is additive (`RouteNodeData.input`); graph
geometry, layout parsing and curve round-trips are pure and unit-tested, so the canvas needs only
the browser smoke.

**Superseded in part by D-126:** the layout is no longer a single gitignored `.facilis/graph.json`;
it is a per-element, committable file set under `.facilis/graph/` with markdown notes and AI graph
tools. The interaction rules above (live drag, floating endpoints, editable curves) stand.

---

### D-126 — The project graph is committable, merge-friendly team state (notes + AI graph tools)
**Status:** accepted (2026-11-08)

D-125 made the graph interaction-first, but the layout was local editor state: a single
gitignored `.facilis/graph.json`, no way to annotate the diagram, no way for the assistant to
work on it, and text selection fought node dragging. The graph is meant to be the primary
development surface beside chat, so the arrangement plus the team's annotations have to travel
with the repository — without turning every concurrent edit into a merge conflict.

**Decision.**
- **One element, one file.** The state moves to `.facilis/graph/`: `layout.json` holds the
  settings (`hiddenEdges`, `collapsed`), `positions/<key>.json` one small position per node or
  note, `bends/<key>.json` one manual bend per edge, and `notes/<uuid>.md` one markdown file per
  annotation. Pan/zoom is per machine and stays in `viewport.json`, git-ignored. A normal git
  3-way merge is therefore automatic for independent edits — moving two different nodes, or
  adding notes on two branches, does not conflict; only the same element conflicts, and then on
  one readable file. (Measured: a single JSONL file conflicted as soon as the two changed lines
  were adjacent, even for different nodes.)
- **The format is the merge strategy.** `.facilis/.gitignore` keeps `*` and gets a narrow,
  idempotently appended allowlist (`!graph/`, `!graph/**`, `graph/viewport.json`): the graph
  is committable, everything else in `.facilis` (database snapshot, binary blobs, logs — D-052)
  stays local. The file is never rewritten, only extended.
- **Migration.** A pre-D-126 `.facilis/graph.json` (schema v1/v2) is read once, written as the
  v3 files on the next save, and removed; `.facilis` is still excluded from export, publish and
  the search index.
- **Markdown notes.** A note is a React Flow node (`note:<uuid>`) with a markdown body in its
  own file; its geometry is a separate `positions/<key>.json`, so moving and editing a note are
  independent edits. The card renders the markdown (escaped before rendering, the notebook's
  renderer), double-click edits it, and an empty note opens ready to type.
- **AI graph tools.** The chat's PTC runtime gains `graph_state` (read the nodes/edges/notes
  with positions) and `graph_arrange` (moves, bends, notes, visibility) — validated, capped and
  written through the same `graph-layout` IO. They are not source patches: the §9.3 patch flow
  and its allowlist stay untouched, because the graph is diagram state, not project source. A
  successful write announces itself on `graph-live`, so the open panel reloads.
- **Selection.** The canvas and the cards are `select-none`; only the note editor allows text
  selection, so dragging or box-selecting no longer selects card text.

**Consequences:** the graph becomes team state that is committed from the IDE's git panel; git
is the sync mechanism (no server-side merge needed). Two branches that move the same node keep a
one-file conflict a human can resolve in seconds. No new dependency, no new write path outside
`.facilis`; the codec, migration and merge behaviour are pure and unit-tested.

---

### D-127 — A workspace opens on its project graph, with the Explorer on the left
**Status:** accepted (2026-11-09)

The project graph became a primary development surface (D-125): it is the one place that
answers "what is this project made of". Opening or creating a project, however, still
opened `src/app.tsx` in the editor — so the first thing a developer saw was one file out of
context, and the graph was a tab they had to discover.

**Decision.** `createProject` and `openProject` open (and focus) the project-graph tab
instead of the template entry file. The entry file is not opened implicitly any more: it is
one click away from the graph (double-click a node) and from the Explorer. The left sidebar
stays the **Explorer** by default. A fresh project has no saved viewport, so the graph fits
and centres itself; a project that already has a saved layout keeps that viewport, because
the arrangement is the user's (D-126) and silently re-fitting it on every open would throw
it away.

**Why Explorer and not the AI chat on the left.** The graph answers "what is this project",
the Explorer answers "where is this thing": they are complementary, and the left column is
the orientation slot. The chat is a working mode — it auto-widens the sidebar (AppShell) and
wants the conversation to be the focus; defaulting to it would force every first visit into
a chat before the user has a mental model of the project. The chat is one click away in the
activity bar (and `⌘K`), and the first-run tour (D-128) opens it at the moment it explains
what it is for.

**Rejected alternatives.** *Entry file by default*: it was the behaviour and it buries the
project overview. *Chat on the left by default*: it is a valid AI-first layout, but it is a
per-user preference, not a safe default — the activity bar already makes it a single click.
*Fit the graph on every open*: it would discard a saved layout. *A blank welcome tab*: one
more screen between the user and the project.

**Consequences.** The editor area is the graph on landing; tests and the smoke flow that
assumed an active file tab after opening a project are adjusted or made explicit. The tab
keeps its own id/title (D-087) and never becomes a file tab.

### D-128 — The guided tour is a first-run overlay over the real IDE
**Status:** accepted (2026-11-09)

Classic IDEs and editors teach their layout with a short guided tour. Facilis has many
surfaces (graph, Explorer, chat, preview, bottom panel, status bar, command palette) and no
in-product explanation of them; a screenshot tour would go stale on the first UI change.

**Decision.** A small, custom, in-app tour: `ide/src/tour/` holds the step list, the state
machine and the card/spotlight geometry (pure, unit-tested); `components/tour/` renders an
overlay that, for each step, **runs an action** (opens the Explorer, the chat, the preview,
the bottom panel) and then spotlights the real element — located by a `data-tour` attribute
— with an animated scrim and a card. Eight steps, the chat step omitted when the deployment
disables AI. It auto-starts once per origin after the first workspace open (`vv.ide-tour`,
versioned), is replayable from the `?` button in the title bar and from the command palette,
skips on `Esc`, ends if the user leaves the workspace, and respects
`prefers-reduced-motion`. Automated/headless runs never auto-start it (`navigator.webdriver`
or a `HeadlessChrome` user agent, plus an explicit `?tour=off`): the smoke suite must drive
the real UI, not an overlay.

**Why custom instead of a library.** The anchors are our own attributes, the positioning is
`getBoundingClientRect` + a few pure functions, the look must use the semantic theme roles
(D-043/D-044), and the tour is small enough that a dependency (driver.js, react-joyride,
shepherd) would add packaging, styling and accessibility decisions we would only fight. The
parts that can break are pure and covered by Vitest.

**Rejected alternatives.** *A static welcome modal*: it explains nothing about the actual
UI. *A library*: see above. *Auto-start on every project open*: noisy; once per origin, then
opt-in. *Starting it on the Home screen*: there is no workspace chrome to explain yet.

**Consequences.** One more `data-tour` attribute on the surfaces the tour points at
(activity bar, status bar, panel wrappers, help button); the strings are under `tour.*` in
`ide/src/i18n/en-tour.ts` / `it-tour.ts`; the overlay is `z-50`, above the app but in the
same layer as dialogs, and it owns a real `role="dialog"`.

---

### D-129 — Route descriptions are source documentation: one English sentence, kept in step with the route's contract
**Status:** accepted (2026-11-09)

D-125/D-126 made the project graph the primary development surface, but the route node still showed only the request shape: the first thing a reader needs — what the route is for — lived in `description?` in the wrapper config (D-092), reached the OpenAPI document, and then disappeared from the graph. The field was optional, unmeasured and unchecked, so the assistant wrote it on new routes (the prompt's canonical example) and silently dropped it whenever it re-emitted a file.

**Decision.**
- **One field, one home.** The description stays in the `defineAuthorizedHandler` config and nowhere else: it is source, committed and diffed with the route. The graph's `.facilis/graph/` state (D-126) is diagram state, never source. The analyzer already reads it statically; it now also carries it on `RouteNodeData`, so the route card shows it without a new analysis pass.
- **One language: English.** The consumers are the OpenAPI document, the static analyzer, the AI's own context and git — none negotiates a locale, and the field sits next to English identifiers (`dbTables`, `permission`). It is source documentation, not UI copy: never a `t()` key, never in `locales/*.json`. The user-facing language of a generated app stays in its own catalogues, so "can this be Italian?" is answered by the layer, not by preference. No language validation is added: detection is unreliable (URLs, names, acronyms) and a false-positive gate is worse than a convention.
- **Two lines, measured in characters.** 120 characters (about two lines at the graph card's width and in the route file). The fact keeps the full string; the card clamps to two lines and keeps the whole sentence in its tooltip. The analyzer warns `route-description-length` above the limit, so the number is enforced where the fact is born.
- **The patch keeps it in step.** Validator rule 17 `route-description` is a **warning**, never a block (the 5/13/14 precedent): missing or blank on a patched, valid route; over the limit; or stale — the route's contract changed in the patch (wrapper, permission, inputs, `dbTables`/`dbColumns`) and the sentence is byte-identical. The assistant writes or refreshes the sentence in the *same* patch turn, so there is no second model call, no extra latency and no offline failure; the prompt states the rule and the validator is the safety net for what the model forgets.
- **The graph shows the sentence, the edges show the rest.** The route card renders it as a quoted source line (muted, clamped to two lines), not as localized interface copy. "What is under the node" is otherwise already the graph: `dbTables`, `dbColumns` and page→route calls are edges, so no expansion panel duplicates them.

**Consequences:** one string now serves the OpenAPI document, the route node and the assistant's context, so they cannot disagree; the analyzer's graph contract and §9.3 gain additive fields (the validator becomes 17 rules, still a warning-only addition); a project without descriptions keeps working — the analyzer flags length only, never absence, so existing projects are not flooded with diagnostics and the nudge arrives when a route is actually touched. Pages stay deliberately out of scope until they have an equivalent contract.

### D-130 — Framework tables reach the browser analyzer through build-time inlined package source
**Status:** accepted (2026-11-09)

D-092 says framework tables reached by re-export are read from the installed `@facilis.dev/*` source. That held for the CLI (`@facilis.dev/analyze/fs` walks `node_modules/@facilis.dev`) but never for the IDE: the browser analyzer's input is the controller's VFS snapshot, and the workspace index skips `node_modules` by design (quick-open and search must not crawl an install). The starter's `db/schema.ts` re-exports nine framework tables, so the graph silently lost every one of them and every route/FK edge that targeted them — the todo-app graph showed 2 tables and 21 edges, with no edge from `GET /api/files/{id}` and no `todo_files → facilis_files` FK. The re-export pass only emitted an `info` diagnostic, so nothing looked broken.

**Decision.**
- **Inline the table-bearing packages at IDE build time.** `ide/src/facilis/framework-sources.ts` inlines `packages/auth` and `packages/db`'s `src/**/*.ts` (test files excluded) plus their `package.json`, with the same `import.meta.glob(…, { query: "?raw", eager: true })` pattern the starter template already uses, remapped to the `node_modules/@facilis.dev/<pkg>/…` paths the analyzer resolves re-exports through. `analyzeProjectFiles()` merges it into every analysis input: one choke point covers the project graph, the AI patch validator and the Release Preview, and caller files win on collision.
- **Why inlining, not a VFS read.** The vendored tarballs ship this same source (they are packed from `packages/` by `scripts/dev/vendor-facilis-deps.sh`), so it is what a project actually installs. Reading it from the VFS would cost hundreds of bridge reads per analysis plus a cache-invalidation problem around `npm install`; inlining is zero I/O, deterministic, and correct before/without an install. The ~180 KB of raw source rides in the analyze-client bundle.
- **Only template packages that declare tables.** `FRAMEWORK_TABLE_PACKAGES` lists `auth` and `db`. A drift-guard test fails when a package in `TEMPLATE_PACKAGES` starts declaring `pgTable` without being listed, so a future framework table cannot silently vanish again (`i18n-db` declares one, but the template does not install it).
- **The table is visibly framework state.** `TableNodeData.framework` is true when the declaring file is under `node_modules/`; the card shows a `framework`/`sistema` badge next to RLS, so a reader can tell project-owned DDL from re-exported framework state.
- **Rejected.** Reading installed sources through the VFS per analysis (bridge cost and install-timing cache); a hand-maintained DDL mirror inside `@facilis.dev/analyze` (drifts from the packages, while the CLI already reads real source); keeping the dangling edges without their nodes (an edge into nothing answers nothing).

**Consequences.** An analysis input now carries a fixed ~40-file framework prefix, so `files` and `revision` include it; diagnostics from framework sources stay filtered by the `node_modules/` prefix. The AI validator and the Release Preview see the same framework tables, which removes false "unknown table" facts rather than adding policy. The IDE bundle grows by the inlined source, and the e2e test pins the starter's 11-table / 46-edge graph as the regression.

**Verification.** `@facilis.dev/analyze`'s graph tests cover `framework: true` for re-exported tables and `false` for project tables; the IDE's `framework-sources.test.ts` covers the map and the drift guard, and `framework-analysis.test.ts` runs the real oxc parser over `exampleProjectFiles()` + `frameworkProjectFiles()` (11 tables, 29 nodes, 46 edges including `GET /api/files/{id} → facilis_files` and `todo_files → facilis_files`; the same project without framework source stays at 2 tables / 20 nodes / 21 edges). `pnpm lint`, `pnpm typecheck`, `pnpm test` (IDE 981, analyze 82, nitro 354) and `pnpm build` pass; file-length, theme and prettier checks are clean.

### D-131 — Phase 5 (headless blocks) is retired: the project owns its UI components
**Status:** accepted (2026-11-09)

Phase 5 planned a versioned `@facilis.dev/blocks` supply chain (DataTable, ResourceForm, AuthGuard, …),
block discovery over `node_modules`, and a `RoleAssignment` block; the package in the repository
was only a 29-line type skeleton, and no workspace package, template or generated project
referenced it. The direction changed twice since: D-121 removed the `blocks` config section because
the generated project no longer composes external UI packages, and the v2 frontend (D-090/D-096)
copies Base UI primitives into `src/components/ui` as source the project owns, with the AI writing
pages against that source (docs/FRONTEND.md). A registered block supply chain has no consumer left.

**Decision.** Retire the phase and delete the artifact:
- delete `packages/blocks` and its lockfile importer; `scripts/dev/vendor-facilis-deps.sh --all`
  no longer packs it, and no source imports it;
- SPEC §4/§5.4 drop the package; §12 replaces the Phase 5 plan with a tombstone that keeps the
  number, so Phase 6/7 and the `Phase 5` references in this log keep their identifiers;
- the Phase 7+ "Block marketplace" backlog item, the Phase 6 `add-block` how-to page, O-004 (block
  discovery) and the README status row go with it; O-004 closes as *not needed*;
- the manifest `blocks` slot, the `BlockManifest` type (§7.2/§7.3) and validator rule 7 stay as a
  reserved, always-empty guard, following D-121: dropping them changes the manifest wire format
  and the 17-rule numbering, so that is a manifest revision, not a plan change.

**Rejected.** Keeping the skeleton "for later" (dead code and a plan that promises a supply chain
nobody builds); renumbering Phase 6/7 to 5/6 (churn across the spec, README and this log for no
reader benefit); building the blocks anyway (they would duplicate the copy-in primitives D-090
chose over a component package, and the AI already writes those pages directly).

**Consequences.** One workspace package fewer; the manifest `blocks` section is now permanently
empty, and rule 7 rejects any `@facilis.dev/blocks` import as an unknown block (rule 12 would also fail
it, since the package is not installed). No user-facing behaviour changes.

**Verification.** `pnpm lint`, `pnpm typecheck`, `pnpm test` (19 workspace tasks; IDE 981, analyze 82,
nitro 354) and `pnpm build` (11 packages) pass with the package removed. No source imports it;
`grep` finds `@facilis.dev/blocks` only in this log, the spec's reserved notes, the validator's guard
constant and its test fixtures.

### D-132 — The preview routing state survives Service Worker eviction
**Status:** accepted (2026-11-09)

`ide/public/sw.js` is the single router between every IDE tab's preview and its kernel: a preview
frame is mapped to the tab that served its navigation, and a per-boot kernel token to that tab,
because two tabs' dev servers both bind the same in-VM port (upstream #23; issue #4). That state
lived only in the worker's memory, and Chrome terminates an idle Service Worker after ~30s; nothing
re-announces a page that is already open, and both tabs answer the same port with 200, so a reload
could silently paint the other tab's project — worst in a background tab, where the focus-ordered
`pickKernelClient()` guess lands on the wrong one.

**Decision.** Persist the routing maps and restore them on the first preview request after a revival:
- one blob at `https://vv.config/preview-routing` in the `vv-config` Cache Storage already used for
  keep-prefix and DevTools, written on frame recording, on `vv-kernel-host`, on a per-tab
  keep-prefix change and on a prune that removed something; writes are serialised and no request
  awaits them;
- `loadRouting()` reads it once per worker instance and is awaited by `resolveKernelSink` and by the
  tokened-navigation branch (which runs before there is a sink to ask); it never rejects, so a
  corrupt blob costs the fallback route, not every preview;
- client ids are stable across an SW restart, which is what makes the restore sound; a persisted
  route whose kernel client is gone is dropped by `pruneRouting` before it can be followed;
- the per-tab keep-prefix decision rides in the same blob, so a revived SW does not fall back to the
  last writer's global set (one tab may keep `/preview/<port>/` while the other strips it).

**Why the IDE copy.** `ide/public/sw.js` forks Vivari's `packages/studio/public/sw.js`; that package
is out of scope in the Vivari repository, so the canonical fix has to be carried here and re-applied
whenever the file is synced (the file header and AGENTS.md say so).

**Rejected.** Re-announcing from every server `listen` (what the old comments assumed: it does not
happen, and it would still lose the frame→tab mapping); a per-tab origin or port (one kernel origin);
trusting a persisted route blindly (it may name a closed tab).

**Consequences.** One cache entry and a few best-effort writes per preview document; a revived SW
restores routing before it looks anything up. The regression gate described in #4 (share one storage
map between two `loadSw` instances) belongs in the Vivari fork's SW spike; here the fix was verified
with that eviction scenario plus the existing vendor routing/multitab/isolation spikes.

**Verification.** The eviction scenario passes against the patched `ide/public/sw.js` — reload and
subresources reach the tab that served them, a fresh tokened navigation resolves, per-tab keep-prefix
survives, a dead route falls back and is pruned, a corrupt blob does not reject — and fails on the
pre-fix file with exactly the reported symptom (the reload after eviction is served by the other
tab). The pinned Vivari submodule's `spike-sw-multitab`, `spike-sw-routing` and
`spike-sw-isolation-policy` pass against the patched file, and `pnpm lint`, `pnpm typecheck`,
`pnpm test` and `pnpm build` are green.

### D-133 — Chat context compaction replaces the replayed history with a summary
**Status:** accepted (2026-11-09)

O-018's owner decision (2026-11-07) defined "compact" as **context compaction**, not a density
toggle (CHAT-UX "Compact"). The chat replays only the last `HISTORY_LIMIT = 20` messages
(`chat-session.ts`), while the visible transcript survives far longer, so after twenty turns the
model silently loses the beginning of the conversation. Compaction is the user-triggered fix: it
changes the replay only, never the transcript.

**Decision.** `ChatSession.compact()` makes one plain-text model call with a fixed
`COMPACTION_SYSTEM` prompt (no tools, no PTC) whose answer becomes a `ChatSummary` —
`{ content, at, through }`, where `through` counts the transcript prefix it covers. It is a
header action (`chat.compact`, FoldVertical) enabled only when the chat is idle, a provider is
configured and the conversation has text; while it runs the chat is in a new `ChatPhase`
`"compacting"` so the composer is blocked and Stop aborts through the existing cancel path. A
provider failure (including an empty answer) surfaces as an ordinary `ChatFailure` and keeps the
previous summary.

- **Replay.** `send()` calls `replayWithSummary(messages, summary, HISTORY_LIMIT)`: with a
  summary, the model gets it as one user turn followed only by the messages after `through`,
  still capped at 20; without one, the old `replayTurns` path is unchanged. A second compaction
  feeds the previous summary plus the newer messages and moves the coverage.
- **Transcript.** The covered messages stay visible; a dashed `ChatSummaryView` row after the last
  covered message expands to the exact summary. `newChat()` clears the summary with the rest of
  the state.
- **Guards and cost.** The button is disabled when the current summary already covers the whole
  transcript, and `compact()` re-checks that there is new text (one extra provider call per real
  compaction). The compaction call reads the whole covered transcript (or summary + newer
  messages), so a conversation larger than the provider window surfaces the provider failure
  rather than dropping context silently.

**Why a new module.** `chat-session.ts` was at the 300-line limit: the prompt, summary shape and
replay preparation live in `ide/src/ai/chat-compaction.ts`. The streamed-bubble bookkeeping moved
out to `ChatStreamWriter` in `chat-stream.ts` (behaviour unchanged; `StreamAccumulator` still
throttles the paint) so the session had room for the action. The composer needed no change:
`busy = phase !== "idle"` already disables it and swaps Send for Stop.

**Rejected.** A slash-command parser in the composer (the header button is the same command with
no extra state); automatic compaction on a threshold (silent model calls cost money and the user
must see when the context was replaced); persisting the summary (the chat is in-memory and the
transcript is not persisted either); removing the covered messages from the transcript (the
visible history is the user's audit trail; only the model replay changes).

**Consequences.** After compaction the model's history is one summary plus up to 20 newer turns;
the marker's count is the covered prefix size. The transcript can grow without bound (as before),
so compaction is repeatable: each run replaces the replay, not the visible history.

**Verification.** `chat-compaction.test.ts` (10 tests: success and replay swap, second compaction,
provider failure keeps the previous summary, empty answer, busy/cancel, no conversation, no
provider, no re-summarizing an already-covered transcript, replay cap, and the no-summary
delegation to `replayTurns`); the IDE suite is 122 files / 991 tests and root `pnpm lint`,
`pnpm typecheck`, `pnpm test`, `pnpm build` are green. The button and marker row have no browser
pass yet — theme, i18n parity and typecheck cover the static rules.

---

### D-134 — The project graph shows real pages, explicit page links and audited elevation
**Status:** accepted (2026-11-10)

The graph was an API-first view: page nodes existed only for client files that called a route,
so a real page like `not-found.tsx` disappeared, while a lib file that called an API could look
like a page. The route card also hid the one fact a reviewer needs before trusting a
`route → table` edge: whether the table is reached through the audited `ctx.sudo`/`ctx.system`
elevation (D-099). Pages had no structure and no navigation edges, so the page column stayed a
list of filenames.

**Decision.** Keep one graph and one AST fact model; add the missing facts additively.

- **Pages only.** A graph page node is a `src/pages/**` file (`PageFact.kind === "page"`) and is
  shown even when it calls no API. Component/lib consumers stay analyzer facts; they are not
  graph nodes. The page card shows the URL paths resolved from the explicit route table and an
  `unrouted` badge when the page is absent from it.
- **Elevation edges.** The route handler pass reads destructured `{ sudo }`/`{ system }` and
  `ctx.sudo`/`ctx.system` calls, plus their static `tables` array (literal, same-file const or
  one-hop import). A table in that set marks the existing route-table edge with
  `access: "elevated"`; the graph uses one warning colour for both APIs, a route-card chip and a
  legend entry, never a second duplicate edge. A dynamic `tables` list is recorded as unknown
  rather than guessed.
- **Static page preview.** A `screens` pass reads the explicit `src/app.tsx` route table and the
  page/layout/app JSX, resolves components through the module graph, splices child routes into
  `<Outlet>`, and emits bounded flat preview nodes (depth 4, 60 nodes, cycles cut, dynamic
  branches marked, UI primitives kept as leaves). The page inspector renders that structure as
  nested boxes that jump to source; it is explicitly a structure view, not a rendering.
- **Explicit page links.** Only `Link`/`NavLink` `to` and `useNavigate()` calls with a static path
  become `page-link` edges; guards, `<Navigate>` redirects and shared providers are out of scope.
  Targets resolve through the route table, so a link to a page that is not routed stays unknown.

**Consequences:** the graph gains `page-link` as a fifth kind (filters, legend, persistence and
AI tools pick it up from `GRAPH_EDGE_KINDS`); old `.facilis/graph/` files remain valid because
unknown hidden-edge names are ignored. `@facilis.dev/analyze` gains route `elevations`, page
`routePaths`/`preview` and internal screen facts; the Nitro metadata/OpenAPI contract is
unchanged. The preview is capped and static by design: conditions, data and CSS are never
executed.

**Verification:** analyzer unit tests cover `ctx.sudo`/`ctx.system` extraction (including the
unknown-tables path), page previews through `Outlet`, route-table path resolution, all pages and
page links; IDE graph-model/style tests cover the new data, stats and the single elevated style;
the framework analysis regression is updated to the new node/edge counts. Root
`pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` are the gate.

---

### D-135 — Workflows are a state machine over rows; manual steps are tasks
**Status:** accepted (2026-11-10) — design approved; W1 (manual tasks), W2 (workflows) and W3 (reject branches, task assignment, example, SPEC §7.10) implemented, and the analyzer pass puts workflow definitions in the project graph (D-161); there is no Studio inbox tab (D-161).

Owner request (2026-11-10): a workflow is a chain of jobs, and a manual step (typically an
approval) should be the simplest possible mechanism — the chain stays suspended until a row
flag changes. The jobs runtime (D-107, [JOBS.md](./JOBS.md)) deliberately keeps jobs
independent (O-017: "a workflow is a separate construct"), and a job body runs through
`runAsSystem` inside its own transaction on the single PGlite connection (JOBS.md §8): a
suspended attempt would hold that connection and deadlock the app, and the browser host has no
cross-process wake-up. A blocking wait is therefore not expressible; the wait must be data.

**Decision.** Add a workflow layer above the unchanged job queue: `facilis_workflows` (one
row per instance: status, input, progress/plan snapshot, current step, waiting task, attempts)
and `facilis_tasks` (one row per manual step: i18n title, payload, pending → decided/expired,
`decided_by`/`decided_at`, comment). `defineWorkflow` declares an ordered chain of job and
approval steps in `server/workflows/**/*.ts`; a runtime tick advances each workflow by CAS
transitions (dispatch the step, observe the job, observe the decision) in short transactions
and reconciles interrupted instances on boot. The manual flag is the task row's
`status = 'decided'` plus `decision`, written by an authorized `ctx.tasks.decide` (permission
`tasks:decide`); the runtime keeps ownership of the workflow row, so a decision cannot race
the tick and who decided when is audited. Like jobs, the framework owns no HTTP endpoint —
the example project ships the task routes. Design and the phased plan (W1 tasks, W2 workflows, W3
polish) are in [WORKFLOWS.md](./WORKFLOWS.md).

**Rejected.** A root job with `parent_job_id` and a `waiting` status (pollutes the job
contract, scatters chain state — O-017); a chain assembled by `ctx.jobs` inside job bodies
(recovery/observability in app code); advancing only from the decision route (no boot
reconciliation after a reload between job completion and advance); suspend points inside step
functions (a job cannot release its transaction).

**Consequences.** Jobs stay independent and unchanged; workflow state is rows, so a reload
resumes it; step jobs are at-least-once (jobs semantics), decisions are exactly-once via the
CAS. v1 is linear (only a forward rejection jump) and has no compensation. SPEC §5.6/§7.9
describe the jobs surface and §7.10 the workflow/task surface (v1.30).

Verification: W1 landed with unit and integration tests (contract, handler binding, the Drizzle
store over PGlite with RLS, boot and API). W2 landed with the workflow contract and registry,
the Drizzle store over PGlite (CAS transitions, RLS), the runner over PGlite (job chain,
approval resume/reject, expiry, missing-job re-dispatch, plan-snapshot mismatch, cancellation),
the API (start/get/list/cancel/bindScope) and boot degradation. W3 landed with the reject
branch (contract validation, forward jump, plan-snapshot check and runner test), task
assignment (`assigned_permission` column and migration 0007, store filter, runtime validation,
example route enforcement), the example workflow with its start route, and SPEC §7.10; root
`pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` are green. The analyzer pass and
the `workflow` graph node landed in D-161; the Studio adds no task inbox tab (D-161).

---

### D-136 — Every table is RLS-scoped or system-only: RLS is the app-role grant boundary
**Status:** accepted (2026-11-10)

The project graph shows the live schema's RLS state, and the owner asked what "no RLS" means for
access. The answer was wrong by construction: `ensureAppRole` granted DML on **every** table and
`runWithPolicyScope` runs every handler as `facilis_app`, so without RLS the app role had no row
filter at all — a table without RLS was open to every handler (a route could read all sessions),
not "system-only". Only RLS-on-without-a-policy denied rows. The framework's no-RLS tables were
`sessions`, `roles`, `role_permissions` and `user_roles`, so the gap was real: D-014's "sessions
is only reachable through the session id" was an app-level convention, not a privilege.

**Decision.** Every table in `public` is exactly one of two classes: app-scoped (RLS enabled, the
app role holds DML, the policies decide the rows) or system-only (no RLS, no table privilege for
the app role; reachable only through the privileged owner connection and `facilis_system`). A
table is system-only because RLS is off — never because some list names it.

**Mechanism.** `ensureAppRole` reads `pg_class.relrowsecurity` after migrations and reconciles:
it clears every table-class privilege first (an older cluster's blanket grant must not survive on
partition children, materialized or foreign tables), then grants DML on RLS tables and
`REVOKE ALL ... FROM facilis_app` and `PUBLIC` on the rest. The table
default privilege is removed (and explicitly revoked on old clusters), so a table created now
stays closed until its RLS is on and provisioning runs again; the first query fails closed with
`permission denied`. Sequences stay granted: USAGE cannot read or write a table, and serial /
identity columns need it. The app role becomes `NOINHERIT`: its `facilis_system` membership
exists only so a deployment whose connection already is `facilis_app` can `SET ROLE` for the
audited elevation (D-099), and inheriting that role's grants would reopen every system-only table
— `SET ROLE` itself still works.

**Framework tables.** `sessions` and `user_roles` become app-scoped with an `EXISTS` policy over
`users` (the D-053 inheritance pattern) instead of a tenant column: the session middleware needs
them, and a per-request audited elevation would be the wrong cost. `roles` and
`role_permissions` become system-only: nothing reads them at runtime (permissions come from the
config through `expandRoles`, the table is seeded by migrations). Existing projects need one
migration; the example ships `db/migrations/0005_app_access.sql` as the template, and
`ensureAppRole` runs after it.

**Rejected.** "RLS off means nobody" (false in Postgres: it means no row filter, so it means
everyone); making `sessions`/`user_roles` system-only and reading them through `ctx.sudo` per
request (audit noise for an elevation nothing actually needs); an allowlist in code of system-only
tables (fails open for the next table and can disagree with the catalog); relying on the analyzer
or the AI validator alone (a warning does not close a privilege).

**Consequences.** A migration that adds or changes tables must be followed by `ensureAppRole`
(the deploy step in POSTGRES §4 already owns provisioning); a table without RLS is visible in the
graph as system-only (the badge said "no RLS" until D-137 renamed it). Sessions and role assignments are visible exactly when
their user is visible in the current tenant scope. The app-role connection in production is
`NOINHERIT`; nothing else changes for handlers, which still only see `ctx.db`.

**Verification.** `packages/db/src/policy.test.ts` (classification, denial, leaked-grant
re-assertion, a table created after provisioning stays closed), `packages/db/src/production-identity.test.ts`
(a real `facilis_app` session via `SET SESSION AUTHORIZATION`: boundary holds, `SET ROLE` still
elevates and restores), `packages/auth/src/access.test.ts` (sessions/user_roles tenant isolation,
cross-tenant write refusal, system-only roles), `policy-postgres.test.ts` (the same table stays
closed over the wire until RLS plus a re-run), plus `pnpm test`/`typecheck`/`lint`/`build`.

### D-137 — System-only is a class: named in the graph, refused in a route's dbTables
**Status:** accepted (2026-11-10)

D-136 made "no RLS" mean system-only. Two surfaces still treated it as a defect: the project graph
painted the no-RLS table badge amber ("no RLS") next to the green "RLS", and a route could declare
`dbTables: ["roles"]` even though `facilis_app` has no privilege on that table — the query would
fail closed with `permission denied` at runtime while the graph drew the edge as a normal one.

**Decision.** The project graph and the Data Explorer label the second class **system-only**, in a
neutral colour: it is a legitimate classification, not a warning. The analyzer gains one diagnostic,
`route-system-table`: a route that declares a system-only table in `dbTables` (or as the table
side of `dbColumns`) is reported. A table named in the route's audited elevation `tables`
(`ctx.sudo`/`ctx.system`) is exempt — that elevation is the only legal access (D-099/D-136).

**Why a warning, not a gate error.** An elevation's table list is a static fact only when it is a
literal array; `tables: loadTables()` is recorded as unknown, and a route that is actually correct
must not fail CI because the analyzer cannot read the array. The runtime already fails closed, so
the diagnostic is the discoverable form of that failure — it shows in the graph's diagnostics
footer and in CI as a warning.

**Consequences.** The i18n key `projectGraph.noRls` becomes `projectGraph.systemOnly`
("system-only"/"solo sistema"); `dataExplorer.rls.rls_off` shows the same label while
`rls_off_scoped` keeps the red defect styling. No runtime, schema or contract change beyond the
diagnostic: a system-only table stays unreachable from route code and the fix is to move the access
into an elevation, not to enable RLS on a table that should not be app-visible.

**Rejected.** Making the diagnostic an error (fails a correct route whose elevation tables are
dynamic); suppressing the warning when any elevation exists (the elevation may name other tables);
turning the graph badge red (system-only framework tables are normal, and a red badge would train
people to ignore it).

**Verification.** `@facilis.dev/analyze` `src/passes/route-tables.test.ts` (declaration warns, the
literal elevation exempts, `dbColumns` counted, unknown table silent); analyzer suite 15 files/93
tests; IDE i18n catalog tests, graph tests, typecheck and lint.

### D-138 — The chat transcript is strictly chronological: a turn's activity sits between its question and its answer
**Status:** accepted (2026-11-10)

The owner reported that the assistant's answer appeared **above** the tool executions of the turn
that produced it: "mi risponde con il messaggio sopra le esecuzioni ... non c'è tanto la linearità
del tempo". The cause was structural, not cosmetic. `ChatPanel` rendered `ChatState.trace` — the
current turn's model-call and program rows — once, after the whole `messages` list, while the
turn's answer is appended to `messages` (so it rendered above those rows). `TURN_RESET` cleared
the trace at every new send, so a finished turn's activity was never persisted and vanished from
the transcript on the next message. And because only the first provider call streams
(`turn.ts`), an exploration turn kept its streamed prose bubble while its program ran, so that
narration also sat above the program row it introduced.

**Decision.**

- `ChatMessage.activity` carries the `ChatActivity[]` of the turn that followed a message and is
  set on the **user** message when the turn ends — success, failure or cancel (`turnEnded` in
  `chat-session-types.ts`). `ChatState.trace` remains the **live** turn only and is cleared when
  its activity moves, so the two never double-render.
- `transcriptEntries(state)` (`ide/src/ai/transcript-entries.ts`, pure and React-free) builds the
  ordered transcript: each message, then its persisted activity; the live activity after the user
  message that opened the turn and **before** a trailing streaming answer bubble; the compaction
  marker after the activity of the last covered message. `ChatTranscriptView` maps the entries to
  `ChatMessageView`/`ChatTraceView`/`ChatSummaryView` 1:1.
- Only the turn's final answer is transcript prose. When a model call turns out to be an
  exploration program, `turnHooks.onScriptStart` drops its streamed bubble: the call row records
  the call and the program row shows what it did, so the prose cannot outlive its step.
- A finished turn's rows stay collapsed (`live={false}`: the newest call row only stays open in
  the live turn), so the history reads as a dense timeline rather than a stack of open cards.
- No new user-facing strings: the existing `chat.trace.*` keys are reused; the ordering is
  display state and is never replayed to the model (`activity` is ignored by `replayTurns`).

**Consequences.** A turn reads question → activity → answer in every state, and that order
survives later turns; a failed or aborted turn keeps its rows too. D-110's row order and
reasoning-inside-the-running-call-row behaviour are unchanged, and compaction keeps working
(`ChatSummary` still replaces a message prefix for replay; the marker just follows the covered
messages' activity). No provider, prompt or validator change.

**Rejected.** Keeping one global trace block with `order` metadata (still loses a turn's rows and
needs a merge in the renderer); moving the activity into the assistant message (it would render
above the answer again, or require the answer bubble to be split from its turn); a card per turn
(D-114's lighter transcript direction).

**Verification.** `transcript-entries.test.ts` (streaming turn, finished turn, two turns, failed
turn, summary marker, live activity before the streaming bubble), `chat-session` tests (activity
persisted on the user message and cleared from `trace`; failed turn keeps it), focused IDE
vitest, typecheck and the file-length gate.

### D-139 — The AI gets a git tool family: inspect, stage, commit, branch, sync, open a pull request
**Status:** accepted (2026-11-10)

The owner asked for the whole git surface in the chat: "tutta la parte di tool per gestire i
commitment sul repository e eventuali pull request o comunque tutta la parte di git". The AI could
already read the project and write validated patches, but it could not see what was modified, make
the commit, or open the pull request — the developer had to leave the chat for every step.

**Decision.**

- The PTC runtime gains a `git_*` family, registered like the preview (D-111) and graph (D-126)
  families through the host seam (`PatchContextHost.git`, `createGitAccess`): `git_status`,
  `git_diff`, `git_log`, `git_branches`, `git_remote`, `git_stage`, `git_unstage`,
  `git_commit`, `git_branch`, `git_sync`, `git_pull_request`. Signatures and returns are in
  [PTC.md](./PTC.md) §6.
- **Repository operations, not source writes.** The facade drives the IDE's own sessions —
  `ScmSession` (index/history/refs) and `GitRemoteSession` (the D-079 proxy) — and never shells
  out. Staging mutates the index; `git_commit` writes a local commit; the AI still authors source
  only as a validated patch set plus the user's Apply (invariant 9 unchanged). Diffs are read
  through a narrow blob/index/workdir port (`git-repo.ts`), not by handing the model `.git`.
- **Destructive operations do not exist.** No discard, reset, clean, rebase or force-push tool.
  The operations that move the working tree — branch switch and pull — refuse a dirty tree with
  `{ ok: false, reason }` as data, so uncommitted work can never be clobbered.
- **One credential, no arguments.** The only token the tools use is the tab-memory GitHub OAuth
  token from the existing device flow (`githubSessionToken()`, D-082). No tool accepts a token
  argument; nothing is persisted, logged or returned, and no token ever enters a URL. Without a
  session (or for a GitLab/Gitea remote in v1) the call answers `{ available: false, reason }`
  and the prompt tells the model to ask the user to sign in — never to invent a credential.
- **Pull requests.** `git_pull_request` posts to the GitHub REST API with the parsed origin repo
  and returns the number and URL. GitLab and Gitea/Forgejo are a deliberate v1 gap: their push
  flows take a per-operation pasted token that is not retained tab-wide, so implementing PR
  creation there would first require a credential-store decision; the tool reports
  `{ available: false }` and the user can open the PR from the host UI.
- **State, not exceptions.** "No project", "no repository", "not signed in", "wrong provider" and
  "dirty tree" are data the model can report or act on; argument errors are `PtcToolError`s naming
  the field and signature. Caps: diff 24 KB/100 files, log 30 entries. Write operations refresh
  the SCM panel and the remote snapshot so the UI follows the tool.
- The prompt gains a `## The project repository` section only when `git_*` tools are advertised
  (generated from the same registry, per D-101), telling the model that a commit is local until
  pushed and that the user owns the sign-in.

**Rejected.** A shell/exec tool or a raw `.git` reader (violates "never exposed" and the sandbox
model); a token argument or an AI-settings credential store (a second trust boundary, and tokens
in model context); discard/reset/force-push (irreversible, and the chat is not the place for
them); GitLab/Gitea PR creation now (see above).

**Consequences.** The owner can ask the assistant to review the changes, commit them with a
message, push the branch and open the PR without leaving the chat; every step is a trace row. The
source write path, the 17-rule validator and the apply/undo contract are untouched: no tool
*authors* source content, so a working-tree edit still needs a proposal + Apply. The only tools
that change existing working-tree bytes are branch switch and pull, and they refuse a dirty tree
first. A pull rewrites the working tree: D-140 gives it (and checkout/discard) one reload path
that refreshes the SCM list and the Explorer and reloads the open editor buffers while keeping
unsaved ones.

**Verification.** `git-access.test.ts` (status/diff/stage/commit/branch/sync/PR over fake ports,
token absent, dirty-tree refusals, provider gate), `git-sync.test.ts`, `ptc/git-tools.test.ts`
(dispatch, argument validation, availability as data), prompt tests (the section appears only with
`git_*`), focused IDE vitest, typecheck, file-length and lint gates.

### D-140 — A git operation that rewrites the working tree reloads the open editor buffers
**Status:** accepted (2026-11-10)

`ScmSession` already fired `onWorkdirChanged` after a checkout or discard, so the controller
reloaded the Explorer and the open Monaco models. A remote **pull** took the other path
(`GitRemoteSession`) and never told the controller: after a pull the Source Control list and every
open tab still showed the pre-pull bytes, and saving one of them would have written stale content
over the files git had just merged. D-139 made this easy to hit — `git_sync({ action: "pull" })`
can succeed while the user is looking at an editor that did not change.

**Decision.**

- `GitRemoteSession` gets the same `onWorkdirChanged` callback as `ScmSession`, fired only after
  a successful **pull** (fetch and push leave the file bytes alone).
- The controller wires both sessions to one reload callback (`ide/src/vv/workdir-reload.ts`,
  created in the constructor): it refreshes the SCM change list and the Explorer tree, and reloads
  every open text buffer whose bytes changed on disk. Checkout, discard, pull, the Remote git
  dialog and the AI git tools therefore converge on the same refresh.
- **A dirty buffer is never clobbered.** A path in `snap.dirty` (unsaved edits) keeps its Monaco
  model and `localFiles` cache untouched, and the count is reported with `toast.warning` under
  the new `editor.workdir.unsavedKept` key (en/it). When every buffer is clean the reload is
  silent. Saving a kept buffer over the pulled file stays the user's explicit action.
- The reload logic lives in its own module because `controller.ts` is pinned by the file-length
  ratchet: the controller keeps only the narrow host closures, and the module is unit-tested
  without Monaco.

**Rejected.** Reloading dirty buffers and discarding the edits (silent data loss); refusing the
pull while any buffer is dirty (unsaved bytes are not in the repository, and the pull itself is
safe); polling the VFS (the git RPC is the only writer that bypasses `vv-fs-changed`).

**Consequences.** After any git worktree change the editor matches the repository and the SCM list
is current; the only way to lose unsaved work is the user's own deliberate save. Diff tabs and
non-text tabs are skipped, as before.

**Verification.** `workdir-reload.test.ts` (clean reload, dirty kept + reported, all-dirty, deleted
file skipped), `git-remote-session.test.ts` (the callback fires after a successful pull, never for
fetch/push or a failed pull), i18n parity, IDE typecheck and the full gate set.

### D-141 — CSRF: origin gate di default, Content-Type strict, e `crossSite` come dichiarazione di esposizione
**Status:** accepted (2026-11-10)

L'owner ha chiesto se con i cookie SameSite un token CSRF sia ancora necessario e se un flag
per-route possa dichiarare un'API chiamabile dall'esterno del sito. L'analisi ha mostrato che
`SameSite=Lax` copre il caso classico (POST cross-site su route autenticate da cookie) ma non:
le route che *scrivono* cookie (login/logout/register), il same-site cross-origin (sottodomini
dello stesso registrable domain), le GET che mutano stato, e non e' una difesa del framework ma
del browser. Inoltre la preview in-VM tiene la sessione nel cookie jar del kernel, dove
`SameSite`/`Secure` sono ignorati: la protezione esiste solo in un deploy reale, e il deploy
dell'app generata e' fuori scope (SPEC §2.2).

**Decision.**

- **Il choke point e' `defineAuthorizedHandler`.** Prima del controllo di permission, ogni
  richiesta con metodo unsafe (POST/PUT/PATCH/DELETE) passa un gate dell'origine: `Sec-Fetch-Site`
  e' autoritativo quando presente (`same-origin`/`none` ammessi; `same-site` ammesso solo verso
  un'origine in `security.trustedOrigins`; `cross-site` rifiutato); in sua assenza si confronta
  `Origin` con l'header `Host` (o con `trustedOrigins`); `Origin` assente = client non-browser,
  ammesso (il CSRF e' un attacco del browser; l'autenticazione resta comunque richiesta), `null`
  rifiutato. Il rifiuto e' `403 forbidden` e passa dal logging come ogni altra uscita.
- **Content-Type strict.** Una route con schema `body` accetta solo `application/json`, una con
  `form` solo `multipart/form-data`; ogni altro media type e' `415 unsupported_media_type`
  (nuovo codice del registry chiuso O-002), letto prima del body. Chiude il trucco della simple
  request `text/plain` con body JSON, che non fa preflight, e rende obbligatorio il preflight per
  una fetch JSON cross-origin.
- **`security.trustedOrigins`** (default `[]`, origini assolute http/https senza path/query) e'
  l'escape hatch per SPA e API su origini diverse dello stesso sito. Non abilita da sola la
  lettura cross-origin: quella resta dichiarata per route.
- **`crossSite?: boolean`** (default `false`) in `AuthorizedHandlerConfig`: dichiara una route
  *pubblica* chiamabile da una pagina su un'altra origine, senza credenziali. E' ammesso solo con
  `permission: []` (altrimenti `defineAuthorizedHandler` lancia: un cookie di sessione non
  attraversa le origini) e viene rifiutato dall'analyzer con `route-cross-site-authenticated`.
  Propaga come gli altri campi statici (RouteFact -> RouteMetadata -> `x-cross-site` in OpenAPI,
  `crossSite` in `RouteMeta`); un valore non statico e' `null`/unresolved, mai indovinato. Una
  middleware Nitro registrata prima di context/session risponde al preflight (`204` + CORS) e
  aggiunge `Access-Control-Allow-Origin` alle sole route flaggate: il flag dichiara l'esposizione,
  non e' la difesa CSRF.
- **Niente token CSRF per ora.** Con `SameSite=Lax` + Content-Type strict + gate dell'origine il
  token sarebbe ridondante per le route cookie first-party. Torna necessario solo se si
  introduce `SameSite=None`/embed di terze parti, un allowlist cross-site con credenziali, o
  un'auth a token; login-CSRF non si risolve con un token legato alla sessione (non esiste ancora)
  ma con il gate, che copre anche login/logout/register.
- **Il POST cross-site dell'ACS SAML** e' una route framework-owned che passa dal wrapper (e'
  un defineAuthorizedHandler), quindi il gate la rifiuterebbe: la decisione D-142 aggiunge
  originCheck: 'skip' al suo config. Resta l'unico endpoint di protocollo con l'eccezione.

**Rejected.** Solo CORS (non ferma le scritture simple/form e non protegge nulla lato server);
token CSRF adesso (ridondante, richiede binding di sessione e un trattamento pre-login);
`SameSite=None` (riapre il CSRF e peggiora l'isolamento); il flag come unica difesa (non e' una
difesa); `__Host-` immediato (richiede Secure+Path=/+no Domain, inerte nel cookie jar del kernel
in dev e un rename di contratto: rimandato a un deploy reale).

**Consequences.** Le richieste unsafe cross-site verso le route applicative ora rispondono `403`
salvo dichiarazione esplicita; login/logout/register CSRF sono chiusi; `SameSite=Lax` resta la
difesa di default del cookie. Un deployment dietro un proxy che riscrive `Host` deve aggiungere
la propria origine pubblica a `security.trustedOrigins`. La preview in-VM continua a funzionare:
il browser manda `Sec-Fetch-Site: same-origin` attraverso il proxy e il cookie jar del kernel non
e' governato da SameSite. Il registry errori resta chiuso: aggiungere un codice e' una decisione,
non un refactor.

**Verification.** `request-security.test.ts` (cross-site/same-site/trusted/Origin/Host/assenti),
route tests (`403` cross-site, `415` media type; il throw `crossSite`+permission e' rimosso da
D-142), config tests
(default e validazione origini), analyzer tests (`route-cross-site-authenticated`, null
fail-closed), `cors-policy.test.ts` (match `{id}`/`{*rest}`, preflight, trusted), manifest/OpenAPI
tests (`crossSite`, `x-cross-site`), typecheck/test/lint/build root.

### D-142 — API esterne: OAuth2 client-credentials, service account e crossSite autenticato
**Status:** accepted (2026-11-10)

L'owner vuole esporre API ad altri sistemi. Il modello scelto: un endpoint OAuth2
client_credentials (client id + secret) che rilascia un access token, API taggate come esposte, e
il ruolo scelto sulla credenziale. D-141 aveva reso crossSite sinonimo di route pubblica
(permission: []); questa decisione lo estende al caso autenticato e corregge l'assunzione — errata
— che l'ACS SAML restasse fuori dal wrapper.

**Decision.**

- **Service account nella tabella users.** users.is_service (boolean, default false) e' l'unico
  marcatore. Un service account non puo' mai fare login: validateSession lo rifiuta, createSession
  lancia, il flusso SSO non lo linka ne' lo provisiona, la route di login del template lo rifiuta.
  Non ha password (password_hash null) e non e' un utente persona; resta la riga per RLS, audit e
  ownership (ownerId = il suo id).
- **Tabelle app-scoped (D-136).** api_clients (client_id pubblico unico, secret hashato, nome,
  ruolo, service user, createdBy, revokedAt, lastUsedAt) e api_tokens (token hashato unico, client,
  service user, expiresAt, revokedAt, lastUsedAt) hanno RLS con la policy parent-user-access
  (ereditano la visibilita' del service user nella tenant scope): sono raggiungibili dal ruolo
  applicativo, come sessions, senza un secondo meccanismo di elevation. Nessuna FK verso roles
  (system-only): il ruolo e' validato contro config.auth.roles.
- **Endpoint framework POST /api/auth/token.** Body JSON { grant_type: "client_credentials",
  client_id, client_secret } (deviazione documentata da RFC 6749, che usa form-urlencoded: la
  route e' coerente con il contratto JSON del framework). Risposta { access_token,
  token_type: "Bearer", expires_in } con cache-control: no-store. Nessun refresh token: RFC 6749
  §4.4 non lo prevede per client_credentials; il rinnovo e' un nuovo grant. 404 quando
  auth.apiClients.enabled e' false; 401 generico per client/secret errati o revocati (nessuna
  enumerazione); audit di emissione e fallimenti senza mai loggare il secret. Access token opachi
  (32 byte random, solo hash SHA-256 a riposo), TTL auth.apiClients.tokenTtlMs.
- **Bearer nel middleware di sessione.** Con Authorization: Bearer <token> il middleware valida il
  token nella stessa tenant policy scope del cookie e popola context.auth con il service user e il
  ruolo del client espanso dalla config (via: "bearer", sessionHash = hash del token per l'audit).
  Un Bearer invalido non fa fallback al cookie. Le route cookie restano SameSite=Lax + gate D-141:
  il gate non e' toccato dal Bearer perche' un client server-to-server non manda Origin; un browser
  cross-site con Bearer deve comunque usare una route crossSite.
- **crossSite = esposta, con permessi.** Il throw di D-141 (crossSite solo con permission: [])
  sparisce: una route crossSite con permessi e' valida ed e' raggiungibile solo con un'identita'
  Bearer. Resta nel manifest (RouteMeta.crossSite) e in OpenAPI (x-cross-site + security:
  [{ bearerAuth: [] }] con lo scheme dichiarato); il preflight CORS consente l'header
  authorization. Le route pubbliche (permission: []) non cambiano.
- **originCheck: "skip" per i protocolli.** L'ACS SAML e' un POST cross-site e la route SSO e' un
  defineAuthorizedHandler: senza eccezione il gate D-141 la rifiuterebbe. Il config del wrapper
  guadagna originCheck?: "enforce" | "skip" (default enforce), usato solo dagli endpoint di
  protocollo framework-owned; un'app non deve usarlo.
- **Gestione dei client nel template.** Helper in @facilis.dev/auth (createApiClient, listApiClients,
  revokeApiClient) e route del template starter protette da permessi dell'app
  (api-clients:read/api-clients:write): il secret e' mostrato una sola volta, il ruolo e' scelto
  tra config.auth.roles, la revoca invalida i token esistenti, la lista non restituisce mai hash.
  Un supporto Studio/UI arrivera' solo se serve.

**Rejected.** Refresh token (non esiste in client_credentials; sarebbe un secondo segreto a vita
lunga), JWT (revoca immediata piu' difficile dei token opachi), tabella service_accounts separata
(FK e policy custom per un caso che users.is_service copre), ruolo fotografato nel token (un
cambio/revoca del client deve valere subito), API key non-OAuth (l'owner ha chiesto client id +
secret + token).

**Consequences.** auth.apiClients.enabled e' false di default: nessun endpoint nuovo finche' l'app
non lo attiva. I service account compaiono in users e vanno filtrati con is_service. crossSite non
significa piu' "pubblica": permission decide se serve un Bearer. L'ACS SAML torna a funzionare
cross-site. Docs: SPEC §5.3/§6.9/§7.1/§7.4/§8.4.4/§8.6, contracts §4.4.

**Verification.** api-clients.test.ts (creazione service user, secret mai in chiaro, grant, secret
errato, revoca, scadenza, ruolo), session tests (Bearer, no fallback, service user rifiutato,
createSession throw), SSO guard test, route tests (originCheck skip, crossSite + permission
definibile), token route test (404/401/200/400), analyzer warning, OpenAPI bearerAuth, manifest,
typecheck/test/lint/build root.

### D-143 — Rate limit del token endpoint per client, revoca per client confermata
**Status:** accepted (2026-11-10)

`POST /api/auth/token` accettava tentativi illimitati: un loop con il secret sbagliato arrivava a
un confronto SHA-256 (costante nel tempo) per ogni richiesta e nulla lo rallentava. D-142 aveva
gia' scelto la revoca per client (client + ogni token emesso); l'owner ha chiesto il rate limit e
confermato che la revoca per client e' la granularita' giusta.

**Decision.**

- **Finestra fissa in-process per client id.** Il token endpoint consuma un tentativo prima di
  toccare il database, sia che il secret sia corretto sia che non lo sia; a budget esaurito
  risponde `429 too_many_requests` con `retry-after` in secondi interi. La chiave e' il
  `client_id` della richiesta (le richieste malformate restano un 400 senza costo DB e non
  consumano budget). Il limiter e' un Map con finestre per chiave, potata oltre 1024 chiavi, cosi'
  un attaccante che ruota `client_id` non fa crescere la memoria senza limite.
- **Config.** `auth.apiClients.rateLimit: { windowMs, maxRequests }` (default 60000/30): trenta
  scambi al minuto sono molto sopra il fabbisogno di un client legittimo (il token dura un'ora) e
  abbastanza sotto per rendere inutile un brute force. Entrambe le chiavi sono interi positivi;
  configurarle e' indipendente dall'abilitare gli API client.
- **Nuovo codice di errore.** `too_many_requests` = `429` entra nella registry chiusa (O-002);
  il template registra `errors.too_many_requests` in `locales/en.json`/`it.json` e in
  `KNOWN_ERROR_CODES`, cosi' il client traduce il codice come gli altri. Il tentativo bloccato e'
  auditato come `auth:token:issue` fallito con `errorCode: "too_many_requests"`; il client id non
  viene loggato in quel ramo (non serve a correlare e non e' un dato utile).
- **Nessuno store condiviso.** Un deploy Facilis esegue un solo processo Nitro, quindi lo stato in
  memoria e' coerente; piu' istanze richiederebbero uno store condiviso (Redis o DB) che il
  framework non spedisce, e il limite dichiara questo confine invece di fingere di averlo risolto.
  Un riavvio azzera le finestre.
- **Revoca per client, confermata.** `revokeApiClient` marca il client e ogni suo token nella
  stessa operazione, e' idempotente e un token di un client revocato non autentica piu'. Non c'e'
  revoca per singolo token: la superficie di gestione e' il client, la rotazione e' revoca +
  ricreazione, e un token ha gia' una vita breve. Una tabella `api_tokens` revocabile a mano
  sarebbe un secondo pannello di amministrazione senza un caso d'uso.

**Rejected.** Rate limit in banca dati (una scrittura per tentativo, e lo stato di throttle non
appartiene alle tabelle app-scoped), limiter globale invece che per client (un client rumoroso
affamerebbe gli altri), revoca per singolo token (superficie di gestione senza un caso d'uso),
refresh token (gia' rifiutato in D-142).

**Consequences.** Il token endpoint e' throttled di default anche se nessuno lo configura; il
blocco e' per processo e si azzera al riavvio. La config `auth.apiClients` guadagna un terzo
blocco con default, quindi le app esistenti non cambiano comportamento finche' non abilitano gli
API client. Docs: SPEC §7.1/§7.4/§8.6, contracts §4.4.

**Verification.** `rate-limit.test.ts` (budget, deny con retry-after, finestra che si riapre,
chiavi indipendenti, clock iniettabile), `token.post.test.ts` (429 + `retry-after` + lo scambio
negato non arriva al database + audit), config tests (default e validazione di windowMs/
maxRequests), errors test (429 nella registry), root gates lint/typecheck/test/build.

### D-144 — Session id hashato a riposo: la riga `sessions` non contiene più la credenziale
**Status:** accepted (2026-11-10)

L'audit di sicurezza (SEC-06) ha mostrato che le policy RLS padre di `sessions`, `user_roles`,
`api_clients`, `api_tokens` e `auth_identities` sono tenant-wide per necessità: il middleware di
sessione valida il cookie **prima** di conoscere l'utente, quindi la sua transazione ha solo
`{ tenantId }` e non può usare `app.user_id`. Il problema specifico di `sessions` era però che la
colonna chiave **era il valore del cookie**: una lettura della tabella (consentita al ruolo app nel
tenant) restituiva credenziali vive.

**Decision.** La riga memorizza `sha256(cookie id)`; il valore grezzo (32 byte casuali, base64url)
esiste solo nel cookie. `createSession` calcola l'hash prima della INSERT e restituisce il valore
grezzo al chiamante che imposta il cookie; `validateSession` e `destroySession` hashato il valore
presentato prima della query. Nessuna modifica di schema (la colonna resta `text`), quindi nessuna
migrazione; `AuthContext.sessionHash` (D-099) coincide già con la chiave di riga, e il trail di audit
continua a non contenere il cookie.

**Rejected.** Policy per-utente su `sessions`: bloccherebbe il lookup pre-auth (l'utente non è noto);
`sessions` system-only con lettura in elevazione: richiede un `SET LOCAL ROLE` per richiesta e
sposta il filtro `tenant_id` nelle query (rimandato: è la stessa scelta dei job, e può essere
rivalutato insieme). La revoca del grant al ruolo app non è praticabile senza una delle due.

**Consequences.** Le sessioni esistenti al momento dell'aggiornamento diventano irraggiungibili
(righe con id grezzo): gli utenti rifanno il login, accettabile perché le sessioni sono effimere e
scadono comunque. La tabella `sessions` resta RLS-scoped e tenant-wide: una lettura non espone più
credenziali riutilizzabili, ma resta visibile la mappa utente→sessioni (id hashati). Se in futuro si
vorrà nascondere anche quella, la strada è `sessions` system-only (stessa decisione dei job).

**Verification.** `session.test.ts` (la riga è `sha256(cookie)` e l'id grezzo non compare nella
tabella; lifecycle, scadenza, distruzione, middleware, Bearer che non fa fallback al cookie),
suite `@facilis.dev/auth` (135 test) e typecheck del pacchetto.

### D-145 — Coda: accesso gated da `jobs:read`/`jobs:exec`, non da un ruolo system
**Status:** accepted (2026-11-10)

L'audit SEC-13 aveva proposto di rendere `facilis_jobs` system-only, ma la coda non è isolata:
engine, runner dei workflow e task store girano oggi come `facilis_app` sotto il tenant, quindi il
cambio avrebbe trascinato in system anche workflow e task, con elevazione/audit su ogni consumer.
L'owner ha scelto l'alternativa: la coda resta RLS-scoped e l'accesso è governato da **permessi**;
la visibilità per-utente dei job è responsabilità dell'endpoint che li espone (nessuna colonna
owner finché non serve).

**Decision.**

- **Policy per comando su `app.permissions`.** `facilis_jobs` mantiene la
  `tenant_isolation` restrictiva (D-008) e sostituisce la vecchia
  `facilis_jobs_tenant_access` (permissiva `for all`, che avrebbe OR-abilitato tutto) con quattro
  policy permissive: `SELECT` richiede `jobs:read`; `INSERT`/`UPDATE`/`DELETE` richiedono
  `jobs:exec`. Il predicato è
  `nullif(current_setting('app.permissions', true), '')::jsonb ? '...'`, lo stesso meccanismo
  delle viste con permesso (D-098): un ruolo app che tocca la coda senza il permesso prende
  `permission denied` dal database, non solo un check nel wrapper.
- **Scope del motore.** Il worker del motore passa `permissions: ["jobs:read","jobs:exec"]` nella
  propria transazione (`runWithPolicyScope`): sono permessi di framework, non di un utente. Le
  operazioni fatte da una route usano la transazione della richiesta, quindi i permessi della
  sessione (o del client Bearer); il *body* del job resta `runAsSystem` audited, invariato.
- **Blueprint e config.** `facilis.config.ts` dichiara `jobs:read`/`jobs:exec` e li assegna ai
  ruoli (l'esempio li dà a `user` e `manager`; `admin` ha il wildcard). Le route dei job usano
  quei permessi al posto di `todos:read`/`todos:write`. Un progetto che abilita la coda senza
  dichiararli fallisce chiuso (RLS), non silenziosamente aperto.
- **Workflow e task.** Stesso schema quando W2/W3 atterrano: `tasks:read`/`tasks:decide`,
  `workflows:read`/`workflows:exec`; niente system-only, niente cascata di elevazioni. Il
  requisito "everything runs in a system context like jobs" di WORKFLOWS.md diventa "engine
  app-role sotto il tenant con i permessi di framework; solo i body dei job sono system".
- **Migrazione.** Una migrazione hand-written (le migrazioni dell'esempio sono scritte a mano, non
  generate in CI): `0007_jobs_permissions.sql` droppa la policy vecchia e crea le quattro nuove.

**Rejected.** `facilis_jobs` system-only (cascata su workflow/task, elevazione e audit su ogni
lettura di coda, più "tutto system"); colonna `owner_id` (la visibilità per-utente non è un
requisito: la decide l'endpoint, e resta additiva se servirà); ruoli Postgres per permesso
(`jobs_read`/`jobs_exec` come `ROLE`: le app role non sono Postgres role, SPEC §8.4.5).

**Consequences.** I nomi `jobs:read`/`jobs:exec` entrano nel contratto della config quando un
progetto espone la coda; un client API Bearer ha bisogno di un ruolo con quei permessi; una route
anonima che vuole accodare deve passare da `ctx.system` (audited). Il costo è un predicato jsonb
per riga, come per le viste con permesso. Il modello si estende a `facilis_tasks`/`facilis_workflows`
senza cambiare la classe delle tabelle.

**Verification.** `examples/todo-app/db/migrations.test.ts` (le quattro policy + la vecchia
assente), `packages/nitro/src/runtime/jobs/db-store.test.ts` (scope con permessi: passa; scope
senza: INSERT negato e SELECT invisibile), suite jobs di `@facilis.dev/nitro`, suite
`@facilis.dev/db`, gates root.

### D-146 — Rilevamento produzione fail-closed: solo `development`/`test` sono dev
**Status:** accepted (2026-11-10)

L'audit SEC-03 ha mostrato che `isProductionEnvironment` era `NODE_ENV === "production"`: un deploy
che ometteva la variabile otteneva i dev endpoint (manifest, dev/query, dev/schema, dev/view), il
cookie senza `Secure`, i log su file e il fallback PGlite. Il default ora è **fail-closed**: solo
`NODE_ENV=development` o `NODE_ENV=test` sono dev; qualunque altro valore (incluso l'assenza) è
produzione. Lo stesso helper governa cookie, storage, logging, dev guard e rifiuto di PGlite in
produzione, quindi non restano controlli con default diversi. Docs e test aggiornati: i test che
simulavano "dev" con `{}` ora passano `NODE_ENV: "development"`.

### D-147 — SAML: `validateInResponseTo: "always"`, nessuna risposta non sollecitata
**Status:** accepted (2026-11-10)

SEC-07: `"ifPresent"` lega l'asserzione alla AuthnRequest solo quando l'asserzione porta
`InResponseTo`; una risposta IdP-initiated o una replay senza quel campo passava la validazione
(restava solo il RelayState, che l'attaccante può creare). Ora node-saml richiede sempre
`InResponseTo` e lo confronta con il request id dello state monouso; il commento del modulo e il
test SAML sono allineati a "sempre", non "se presente".

### D-148 — PBKDF2 a 600k iterazioni e login a tempo costante
**Status:** accepted (2026-11-10)

SEC-11: PBKDF2-SHA256 era a 210.000 iterazioni (sotto la raccomandazione OWASP di 600.000) e il
blueprint di login usciva **prima** di `verifyPassword` quando l'email non esisteva (o l'account
era SSO/service), creando un timing oracle per l'enumerazione. Default portato a 600.000 (gli hash
esistenti restano validi: le iterazioni sono nel formato versionato) e il blueprint verifica un
hash dummy valido quando l'account non ha password, così il costo PBKDF2 — e il tempo di risposta —
è lo stesso in tutti i casi. Il rate limiting resta aperto (SEC-04).

### D-149 — Rate limiter del token endpoint con mappa limitata (FIFO, 4096 chiavi)
**Status:** accepted (2026-11-10)

SEC-08: il limiter creava una finestra per ogni `client_id` distinto e potava la mappa solo oltre
1024 chiavi, pagando uno sweep O(n) per ogni chiave nuova (memoria e CPU controllate
dall'attaccante, che sceglie il client id prima dell'autenticazione). Ora la mappa ha un cap fisso
(FIFO: si evince la finestra più vecchia) e il costo per chiave nuova è O(1); la quota resta per
client id (l'eventuale lockout di un client altrui è accettato: senza store condiviso non c'è
un'alternativa migliore, e il token dura un'ora). Il test copre l'eviction.

### D-150 — Bootstrap a token monouso e email canonica: l'indirizzo non è una credenziale (SEC-01)
**Status:** accepted (2026-11-10)

SEC-01: la registrazione è pubblica e non verifica l'email, ma `registerInitialAdmin` promuoveva ad
`admin` chi registrava per primo l'indirizzo di `FACILIS_INITIAL_ADMIN` (confronto case-insensitive,
mentre `users.email` era unico case-sensitive: una variante di maiuscole passava). Chi conosce
l'indirizzo poteva diventare admin senza possedere la casella.

**Decision.**

- **L'indirizzo non è una credenziale.** La promozione richiede anche
  `FACILIS_INITIAL_ADMIN_TOKEN`: entrambe le env var devono essere impostate, il token si confronta in
  tempo costante (hash SHA-256 di entrambi i valori e confronto dei byte) e manca il token → nessuna
  promozione (fail closed). La promozione avviene solo se non esiste già un `admin`: è monouso, quindi
  tenere la variabile configurata dopo il bootstrap non permette una seconda promozione.
- **Email canonica.** `normalizeEmail` (trim + minuscolo) è usata in registrazione, login, linking SSO
  e confronto di bootstrap; la tabella `users` guadagna l'indice unico `users_email_lower_idx`
  (`lower(email)`, migrazione `0008`), così il database rifiuta le varianti quanto l'applicazione.
- **Risposta generica.** La route di registrazione del blueprint risponde `{ accepted: true }` sia al
  successo sia all'email già registrata, senza ruolo né id: non è più un oracolo per l'esistenza di un
  account né per la promozione; l'esito reale (ruolo) resta nell'audit server-side.
- **Il token viaggia nel body** della registrazione, mai loggato (il redact di D-119 copre i body: non
  vengono registrati) e protetto dal throttle della route (D-152).

**Rejected.** Verifica email vera (richiede trasporto email e token: feature separata, vedi SEC-02);
promozione solo CLI/migrazione (il blueprint ha bisogno di un bootstrap dalla sua stessa superficie);
fidarsi dell'indirizzo con `emailVerified` assente (è proprio il difetto); allowlist di IP.

**Consequences.** Il deploy documentato ha una seconda variabile; un token perso richiede di
rigenerarlo prima del primo bootstrap. La migrazione `0008` fallisce su un database che contiene già
varianti di maiuscole dello stesso indirizzo (pre-rilascio: si azzera il DB di sviluppo). SPEC
§5.1/§5.3/§8.4.3 e la quickstart sono aggiornate.

**Verification.** `seed.test.ts` copre env mancanti, token errato, variante di maiuscole, promozione
unica e blocco dopo il primo admin; `migrations.test.ts` verifica l'indice; suite auth/core/examples.

### D-151 — Link SSO verso un account password: opt-in esplicito (SEC-02)
**Status:** superseded by D-156 (2026-11-10) — l'opt-in è stato sostituito dal claim basato sulla
verifica email; l'analisi del problema resta valida.

SEC-02 (pre-hijacking): D-120 assume che un'email verificata basti a collegare un'identità SSO a un
utente esistente, ma un account creato dalla registrazione password non ha alcuna prova di possesso
dell'indirizzo. Chi registra per primo l'email della vittima ottiene un account con una password che
conosce; al primo login SSO della vittima il flusso lo collegherebbe a quell'account, consegnandolo
all'attaccante.

**Decision.** `auth.sso.linkPasswordAccounts` (default `false`) abilita il link a un account con
`password_hash` non-null; senza opt-in `resolveIdentity` rifiuta con il nuovo codice sicuro
`sso_email_conflict` (redirect, nessun dettaglio). Gli account provisionati da SSO (password null)
continuano a collegarsi per email verificata, e le email di utenti/identità sono salvate canoniche
(D-150).

**Rejected.** Implementare ora la verifica email (nuova feature: campo, token, trasporto, template);
rifiutare sempre il link per email (romperebbe l'unione di identità SSO multiple sullo stesso
account); creare un secondo utente con lo stesso indirizzo (l'indice unico lo impedisce).

**Consequences.** Una migrazione password→SSO richiede di impostare il flag (rischio documentato)
oppure di aspettare la verifica email; l'errore è un redirect sicuro, non un 500. La decisione
D-120 resta valida per il claim del provider. Sorveglianza futura: verifica email vera, linking
con notifica all'utente, e la stessa guardia per inviti/admin.

**Verification.** `identity-guard.test.ts`: rifiuto con password, link con opt-in, email canonica;
login OIDC/SAML esistenti verdi; `sso-config` validation test.

### D-152 — Throttle per route nel wrapper, con chiave client + route (SEC-04)
**Status:** accepted (2026-11-10)

SEC-04: l'unico rate limit del framework era il token endpoint; login e registrazione del blueprint
non avevano alcun limite (credential stuffing illimitato, creazione massiva di account). Il login
aveva già il tempo costante (D-148), mancava il volume.

**Decision.**

- **Capacità del wrapper.** `defineAuthorizedHandler({ rateLimit: { windowMs, maxRequests } })`
  consuma un tentativo dopo l'origin gate e prima di permessi e parsing del body: `429
  too_many_requests` con `retry-after`, e un audit `http:rate_limit` fallito. La chiave è
  `METHOD path clientAddress`: stessa finestra per client e route, mai condivisa fra route.
- **Address dal middleware.** `event.context.facilis.clientAddress` è risolto con `getRequestIP`
  (socket; `x-forwarded-for` solo con `logging.trustProxy`). Senza un address fidato non si applica
  il throttle: meglio nessun limite che una finestra condivisa che un attaccante può esaurire per
  bloccare tutti (fail open esplicito, documentato).
- **Limiter condiviso e limitato.** Riusa la finestra fissa in-process di D-149 (cap 4096 chiavi,
  eviction FIFO), una sola istanza per processo.
- **Blueprint.** Login 10/minuto per client, registrazione 5/minuto; il token endpoint mantiene la
  sua quota per `client_id` (D-143).

**Rejected.** Chiave basata su `x-forwarded-for` senza trust (spoofabile: si ruota l'header e il
limite sparisce); fallback a una finestra globale (DoS di login a costo zero); lockout per account
(richiede stato per account, crea un DoS mirato e non copre il credential stuffing distribuito);
store condiviso (nessuno in questa fase, D-143).

**Consequences.** In deploy dietro proxy va configurato il trust (srvx `trustProxy` o un proxy che
sovrascrive `x-forwarded-for`), altrimenti il throttle non parte; in sviluppo senza address il
limite è inerte. Lo stato è per processo e si azzera al riavvio. SPEC §7.4/§8.2 e contracts aggiornati.

**Verification.** `route-rate-limit.test.ts` (429 + retry-after, chiavi per client, route separate,
nessun address → nessun throttle), `context.test.ts` (clientAddress solo da fonte fidata),
`rate-limit.test.ts` invariato, blueprint con i due limiti.

### D-153 — Cap dei byte del body prima del parsing e codice `payload_too_large` (SEC-09)
**Status:** accepted (2026-11-10)

SEC-09: il wrapper leggeva `req.json()`/`req.formData()` senza alcun limite; `storage.maxUploadBytes`
era controllato dopo che il body multipart era già bufferizzato. Un body enorme su una route pubblica
(login, registrazione) esauriva memoria senza che nulla lo fermasse.

**Decision.**

- **Cap nel wrapper.** JSON 1 MiB; multipart `storage.maxUploadBytes + 1 MiB` (1 MiB se lo storage non
  è configurato). Prima il `content-length`, se numerico e oltre il cap, rifiuta senza leggere; altrimenti
  un contatore sullo stream interrompe (e cancella il reader) appena supera il cap. Il parser riceve
  solo i byte entro il limite.
- **Nuovo codice chiuso.** `payload_too_large` = 413 con `details.maxBytes`, in
  `FACILIS_ERROR_CODES`/registry, nelle locale `en`/`it` e in `KNOWN_ERROR_CODES` del template.
- **Il test dei fake event resta com'era**: se non c'è stream (unit test, runtime non-Request) si usa il
  path precedente, così il wrapper resta usabile in ogni runtime Fetch.

**Rejected.** Fidarsi del solo `content-length` (assente in chunked e falsificabile); lasciare il
controllo a `storage.maxUploadBytes` (la memoria è già stata consumata); reimplementare il multipart
parser (si bufferizza una volta, ma entro il cap, e il parser standard resta valido).

**Consequences.** Un body JSON oltre 1 MiB è rifiutato (documentato: alzare il cap significa
cambiare il wrapper, non la config); un multipart può ancora bufferizzare fino a `maxUploadBytes + 1
MiB`, e un singolo file oltre `maxUploadBytes` resta rifiutato dal path storage con
`file_too_large`. SPEC §7.4/§8.2 e O-002 aggiornati.

**Verification.** `request-input.test.ts` (content-length, chunked, JSON/multipart sotto e sopra il
cap, errori esistenti invariati), suite core/nitro verdi, file-length e lint.

### D-154 — Gate CI sulle invarianti 1-2 per le route scritte a mano (SEC-12)
**Status:** accepted (2026-11-10)

SEC-12: l'analyzer produceva `wrapper: "invalid"` ma solo l'IDE e il validatore AI lo usavano; niente
in CI impediva di aggiungere a mano una route senza `defineAuthorizedHandler` o senza `dbTables`.

**Decision.** Un test Vitest in `@facilis.dev/analyze` (`routes-gate.test.ts`) carica le app con
`server/routes`/`server/api` sotto `examples/` (e `starter/` quando esiste), esegue l'analyzer reale e
fallisce se una route non ha un `RouteFact`, se `wrapper !== "valid"` o se `dbTables` è assente/non
leggibile staticamente. Un fixture temporaneo dimostra che il gate scatta (default export non-wrapper,
`dbTables` assente, `dbTables` dinamico). Gira in `pnpm test` (la CI esegue già turbo test): nessun
nuovo script né modifica del lint root.

**Rejected.** `scripts/check-routes.mjs` (nuovo wiring e secondo entry point dell'analyzer, mentre la
pipeline test esiste già); regola oxlint (non può verificare l'accuratezza di `dbTables` rispetto
all'AST, solo la presenza del token).

**Consequences.** Il gate copre le route del blueprint (quelle che gli utenti copiano); una directory
applicativa nuova va aggiunta all'elenco del test. L'accuratezza semantica di `dbTables` resta una
responsabilità del validatore AI per i patch e dell'analyzer per il resto.

**Verification.** Analyze suite 102 test (prima 100), il probe sull'esempio riporta 17/17 route valide,
typecheck/lint/prettier verdi.

### D-155 — Isolamento della preview "open" (SEC-10) rimandato a una feature IDE dedicata
**Status:** accepted (2026-11-10)

SEC-10: nel profilo open la preview gira same-origin con l'IDE (`allow-same-origin`), quindi il codice
del progetto può leggere la AI key/MCP token da `localStorage` e l'OPFS. La chiusura richiede o
un'origine di preview separata di default o la rimozione di `allow-same-origin`, entrambe scelte di
prodotto che cambiano cookie/storage/Service Worker della preview (D-063, D-132) e vanno verificate
con `pnpm ide:smoke` in un browser.

**Decision.** Non toccare il sandbox in questo PR di hardening: il rischio residuo resta documentato in
D-063 e nel finding SEC-10, che resta aperto. La feature IDE dedicata sceglierà fra origine separata di
default, preview senza `allow-same-origin`, o chiave AI non estraibile (worker/crypto), e aggiornerà il
threat model.

**Rejected.** Rimuovere `allow-same-origin` ora (rompe storage e cookie della preview, e la pipeline
`ide:smoke` non è eseguibile in questa sessione); dichiarare il profilo open "sicuro" senza modifiche.

**Consequences.** SEC-10 resta un finding aperto con priorità P2, tracciato nell'audit; nessuna regressione
nelle preview attuali.

### D-156 — Verifica email degli account password e claim SSO dell'account pendente (SEC-02)
**Status:** accepted (2026-11-10)

SEC-02 alla radice: il framework non aveva alcun modo di provare che un indirizzo appartenesse a chi
registrava. D-150 aveva chiuso il bootstrap e D-151 aveva bloccato il linking SSO a un account
password, ma restavano due problemi: un account password non era mai verificato (quindi il linking
restava disabilitato per sempre) e la registrazione pubblica poteva creare un account "segnaposto"
sull'indirizzo della vittima.

**Decision.**

- **Schema.** `users.email_verified_at` (timestamp nullable) è la prova; `auth_email_verifications`
  custodisce i link: chiave `sha256(token)`, `user_id` con `ON DELETE CASCADE`, `expires_at`,
  `tenant_id` e policy RLS come le altre tabelle auth (D-136). Un solo link attivo per utente: emettere
  un nuovo token cancella il precedente.
- **Primitive.** `issueEmailVerification` (TTL, rotazione), `consumeEmailVerification` (single-use:
  la riga viene cancellata prima del controllo di scadenza; token sconosciuto/scaduto → `null`) e
  `markEmailVerified` (fallback dev). Scrivono solo dentro l'elevazione audita `ctx.system`, come la
  registrazione: la route di verifica non ha sessione (D-099).
- **Config.** `auth.verification: { enabled (false), tokenTtlMs (24 h, max 30 giorni), successRedirect,
  failureRedirect }`; ogni chiave ha un default, `enabled: false` non cambia il comportamento di un
  progetto esistente.
- **Blueprint.** La registrazione crea l'utente con `email_verified_at` NULL, emette il link e risponde
  `{ accepted: true }` (mai il token, mai un oracolo di esistenza). Con la verifica attiva il login
  risponde `403 email_unverified` **dopo** la verifica della password, quindi non è un oracolo.
  `GET /api/auth/verify-email?token=…` consuma il link e redirige a
  `successRedirect?verified=1` / `failureRedirect?verify_error=invalid_token`, con audit
  `auth:email:verify`. Ri-registrare un'email con account PENDENTE reclama l'account (password
  sostituita, link ruotato): chi controlla la casella lo dimostra, chi ha solo registrato per primo no.
- **Delivery del progetto.** Il framework non spedisce email: il blueprint posta
  `{ to, subject, text }` a `FACILIS_EMAIL_WEBHOOK_URL` (opzionale `FACILIS_EMAIL_WEBHOOK_TOKEN`
  come Bearer). In `development`/`test`, se il webhook non è configurato, il link viene loggato e
  l'account verificato subito: demo e `ide:smoke` non richiedono una casella; la produzione senza
  webhook fallisce in modo visibile (log server-side) ma la risposta resta generica.
- **SSO (sostituisce D-151).** Il claim di un'identità verificata su un account PENDENTE rimuove la
  password segnaposto e marca l'account verificato prima di collegare l'identità (audit
  `auth:sso:link` con `claimed: "unverified_password"`); un account VERIFICATO si collega senza
  toccare la password. Il claim vale solo con la verifica email attiva: se è disabilitata
  l'identità non può distinguere un account pendente della vittima da uno reale del proprietario,
  quindi il linking è rifiutato con `sso_email_conflict` invece di azzerare una password in uso.
  `auth.sso.linkPasswordAccounts` viene rimosso: la verifica è la prova, non un interruttore.

**Rejected.** Registrazione "deferred" (creare l'utente solo dopo la verifica): eliminerebbe anche
l'ultimo canale di enumerazione, ma richiede una tabella di pending separata e cambia il contratto di
registrazione/bootstrap in un colpo solo; rimandato come possibile evoluzione. Link con HMAC stateless
(nessuna revoca/rotazione né single-use). Provider SMTP nel framework (segreti e deliverability sono
del deploy, come log e storage). Auto-verifica in produzione quando il webhook manca (fail-open).

**Consequences.** Un deploy che abilita la verifica deve impostare il webhook (documentato in README e
SPEC); la migrazione `0009` riempie `email_verified_at` per gli account esistenti, così un deploy già
in uso non si blocca. Resta un canale indiretto di enumerazione (registrazione → login: un account
verificato risponde `unauthorized`, uno pendente `email_unverified`), mitigato dal rate limit (D-152)
e chiudibile con la registrazione deferred. SSO.md, SPEC §5.1/§5.3/§8.4.4/§4.4 e i contratti Phase 1
sono aggiornati.

**Verification.** `email-verification.test.ts` (single-use, TTL, rotazione, token altrui, fallback
dev, scoped client), `identity-guard.test.ts` (claim che azzera la password e verifica, account
verificato che mantiene la password, claim non verificato rifiutato), `migrations.test.ts` (colonna,
tabella, RLS, indice), `starter-contract.test.ts` (route verify + primitive nel template), suite
auth/core/examples/analyze verdi.

### D-157 — `dbTables` è una dichiarazione di accesso applicata (tabelle e viste, statica + runtime)
**Status:** accepted (2026-11-11); the jobs carve-out is revoked by D-162 (the declaration covers job bodies too)

Il security review (audit SEC-02 e seguito) ha mostrato che `dbTables` è metadato autocertificato: una route
può interrogare qualsiasi tabella RLS, e dentro un'elevazione `facilis_system` bypassa la RLS mentre l'audit
registra solo le tabelle dichiarate. Le viste non sono fatti dell'analyzer (O-013), quindi oggi una route che
usa una vista dichiara le tabelle base. L'owner ha chiesto una dichiarazione applicata: ciò che una route
dichiara è ciò a cui può accedere, così è semplice capire quale route fa cosa.

**Decision.**

- **Cosa dichiara `dbTables`.** L'insieme completo delle relazioni che l'handler può toccare tramite
  `ctx.db`, `ctx.sudo` e `ctx.system`: **tabelle e viste**, con i nomi SQL. Una vista si dichiara con il
  proprio nome (D-097/D-098), invoker o definer: le tabelle base non si dichiarano, perché l'accesso alla
  vista non è un accesso diretto e per una definer il gate resta il permesso dichiarato nella `defineView`.
  Questo sostituisce la convenzione di O-013 ("dichiara le tabelle base").
- **Statico.** `@facilis.dev/analyze` impara `defineView` (`db/views/**`) in `ViewFact` (nome, tabelle,
  permesso, access). Un nuovo pass per route parte dall'handler, **segue le chiamate a funzioni del
  progetto** (stessi server module, con mappatura degli argomenti; profondità limitata, cicli chiusi; le
  chiamate nei pacchetti restano opache) e registra le relazioni lette/scritte: `select().from(...)` e join,
  `insert`/`update`/`delete(relazione)`, `db.query.<relazione>`. Confronto con `dbTables`:
  - usata e non dichiarata → **errore** `route-table-undeclared`;
  - dichiarata e non usata → **warning** `route-table-unused` (soppresso quando la route delega a helper
    opachi, dove il runtime resta l'autorità);
  - relazione non risolvibile o dinamica → **errore** `route-table-unresolved`;
  - `db.execute(sql)` senza flag → **errore** `route-raw-sql`;
  - dentro `ctx.sudo`/`ctx.system`, uso fuori da `options.tables` → **errore**
    `route-elevation-undeclared`.
  Il gate CI delle route (SEC-12, `routes-gate.test.ts`) esegue il pass su `examples/` e `starter/`; il
  validator AI riceve la nuova **regola 18 `route-table-declared`** per i patch.
- **`rawSql`.** Nuovo campo opzionale della config di route (`rawSql?: boolean`, default `false`),
  estratto staticamente come gli altri campi (manifest/OpenAPI `x-raw-sql`, release diff). Con
  `rawSql: true` la route può usare `db.execute`: l'SQL non è ispezionabile e la dichiarazione resta
  autorevole; senza, l'uso è un errore. È l'unica deroga, esplicita e visibile.
- **Runtime.** Il client passato come `ctx.db` e quello passato alle callback di elevazione sono
  **guarded**: ogni relazione toccata deve essere nel set dichiarato prima che la query parta; violazione →
  fail-closed `table_not_declared` (500); `db.execute` senza flag → `raw_sql_not_allowed` (500). Le
  violazioni producono un evento di audit (`route:table_access`, outcome failed) con route, request id e
  relazioni; il client non vede i nomi delle relazioni. L'elevazione continua a richiedere `tables` non
  vuoto e sottoinsieme di `dbTables`, ora verificato sull'accesso osservato; l'evento `succeeded`
  dell'audit aggiunge le tabelle **osservate** accanto a quelle dichiarate. I job in background,
  `ctx.jobs` e il loro store restano sul client non guarded (framework) e fuori scope.
- **Nessun interruttore globale.** L'enforcement è parte dell'invariante 2 ("dbTables presente e accurato"):
  nessuna modalità warn/off; l'unica deroga è `rawSql: true`. Le route del framework e dell'esempio vengono
  allineate, non escluse.

**Rejected.** Modalità warn/off (un invariante di sicurezza disattivabile non è strutturale). Inferire le
tabelle dall'SQL raw (fragile e aggirabile). Un ruolo Postgres per route (esplosione di ruoli, PGlite). Nodi
vista nel grafo (resta Phase 4 di O-013: qui le viste entrano in analyzer e validator, non ancora nel grafo).

**Consequences.** Cambiamento breaking per le route con `dbTables` incompleto: il gate CI blocca il merge e
il runtime fallisce chiuso; le route del framework e dell'esempio sono aggiornate. Una vista in `dbTables`
supera la regola 4; O-013 si aggiorna (fatti analyzer, validator e dichiarazione della vista; grafo ancora
no). SPEC 1.25 §7.4/§8.4/§9.3/§11.2, PHASE1-CONTRACTS e AGENTS.md (18 regole) seguono.

### D-158 — Il DDL dello schema nasce al rilascio dal diff dei tag, mai scritto a mano
**Status:** accepted (2026-11-10)

**Context.** Il DDL oggi si scrive a mano. Nell'esempio e' hand-written (0001_seed_roles,
0005_app_access, 0006_api_clients), nei progetti generati lo scrive l'AI (regola 14 del validator e
regola config-sync), e i documenti dichiarano drizzle-kit come generatore (SPEC §2, §8.3) anche se
il progetto generato non ha ne' drizzle-kit ne' db:generate. D-109 aveva stabilito che il framework
rende le migrazioni dai fatti dello schema, ma l'unico renderer (ide/src/ai/schema-migration.ts) e'
rimasto orfano: nessun import, nessun test. Chi cambia db/schema.ts deve quindi anche scrivere il
SQL, e quel SQL puo' essere incompleto, non riproducibile e diverso da un ambiente all'altro.

**Decision.** Per test e produzione il DDL e' un artefatto generato in pipeline, dal diff fra il tag
del rilascio precedente e il tag nuovo, senza accesso al database.

- **Dove nasce.** Il release pipeline fa checkout dei due tag, carica db/schema.ts e
  facilis.config.ts, costruisce i due snapshot dichiarati e chiama planSchema(from, to) in
  @facilis.dev/core: batch ordinati, classi di rischio, problemi. Un problema (dichiarazione
  irrappresentabile, sicurezza delle policy) fa fallire il rilascio, non degrada.
- **Nessun database al momento della generazione.** L'IDE e la CI non raggiungono test/prod: il
  confronto live e' impossibile per costruzione, quindi il tag e' l'unica sorgente. Il catalogo
  live resta una verifica del deploy e un attrezzo di adozione/riparazione (D-159).
- **Nessun AI e nessun utente scrivono DDL.** La regola 14 del validator e la regola config-sync
  smettono di chiedere un file .sql e diventano un blocco: un DDL scritto a mano in una patch viene
  rifiutato. db/migrations/ e meta/ escono dal template.
- **Eccezione dev.** In PGlite lo schema cambia senza tag: al boot il dev database si riconcilia
  live -> dichiarato con lo stesso planner, sui dati usa-e-getta. Non e' un percorso di rilascio.
- **Nessuna dipendenza runtime da drizzle-kit.** I percorsi programmatici sono verificati rotti o
  lossy (pushSchema perde i parametri, il pull non e' idempotente) e il progetto generato non lo
  installa: drizzle-kit resta un oracolo di test in CI, non una dipendenza.
- **D-109 si completa.** Il renderer orfano si sposta in @facilis.dev/core con i suoi test.

**Rejected.** drizzle-kit come generatore di produzione (rotto/lossy e assente dal progetto
generato), diff live come generatore (la pipeline non ha accesso al DB: e' la ragione del modello),
SQL scritto dall'AI (non riproducibile dai tag, non revisionabile), migrazioni scritte a mano per i
backfill in v1 (fuori scope, decisione 5 del piano).

**Consequences.** Una modifica di schema in un PR non contiene piu' .sql; rilanciare il pipeline
sugli stessi tag produce lo stesso piano. Da emendare: SPEC §2/§7.7/§8.3/§8.4.2/§9.4/§11.3/Appendix
D, PATTERNS §5 (generated, never authored), APP-UPDATES §5, POSTGRES §4, README dell'esempio. Il
piano operativo e' docs/MIGRATION-PLAN.md.

**Verification.** P0: nessuna riga di codice. P2: golden test del planner e confronto con
drizzle-kit generateDrizzleJson + generateMigration come oracolo; una dichiarazione non supportata
fallisce il rilascio. Gate finali: pnpm lint/typecheck/test/build.

### D-159 — Un rilascio e' un tag piu' un artefatto immutabile; il deploy applica artefatti con un ledger e un fingerprint
**Status:** accepted (2026-11-10)

**Context.** SPEC §2 dice che la pipeline esegue drizzle-kit migrate e POSTGRES §4 documenta uno
snippet una-tantum: applicano SQL senza sapere a che release e' il database, senza verificare che il
DB sia quello che si aspettano e senza un modo per rifiutare il drift. La prima versione del piano
(docs/MIGRATION-PLAN.md §1) calcolava il piano live -> dichiarato dentro il deploy: ma il deploy deve
partire da qualunque stato (vuoto, indietro di N release, ripristinato da backup, adottato) e il
confronto live non e' disponibile ne' dall'IDE ne' dalla CI.

**Decision.** Un rilascio e' un tag piu' un artefatto: il tag e' la release, l'artefatto e' il suo
schema diff immutabile, e il deploy applica artefatti con un ledger.

- **Artefatto.** Prodotto dal pipeline di D-158: release/from/to (tag + oid), fromDigest/toDigest,
  planHash (sha256 del corpo), risk, batch ordinati, destructive (gli id dei batch che perdono
  dati), approved? (autore, data, hash), problems. E' conservato come artifact CI chiave tag, non
  committato, e il deploy ne registra l'hash nel ledger.
- **Ledger.** _facilis_deploy_runs(release, plan_hash, from_digest, to_digest, status, statements,
  approval_ref, backup_ref, started_at, finished_at), una riga per artefatto applicato. Lo stato di
  un database e' cio' che dice il ledger: pending = artefatti fra la release del ledger e il target.
- **Deploy.** Preflight digest(live) == artifact.fromDigest (altrimenti rifiuto tipizzato),
  fingerprint post-check, lock consultivo, una transazione per artefatto, post-step (seed,
  ensureAppRole, ensureSystemRole, views). Nessun downgrade: si ripristina il backup o si spedisce
  un artefatto in avanti.
- **Il catalogo live e' verifica, non generatore.** facilis db adopt registra la baseline di un DB
  senza ledger; facilis db repair e' la riconciliazione esplicita live -> dichiarato, con backup,
  registrata come repair e mai come release. --allow-destructive esiste solo qui.
- **Approvazione e esecuzione sono atti separati.** L'approvazione e' un atto di rilascio legato al
  planHash e alla lista dei batch distruttivi; la policy dell'ambiente (destroy: deny | approval |
  allow) decide se il deploy puo' eseguirla; il deploy resta non presidiato. Il backup e'
  dell'ambiente di rilascio: il deploy richiede e registra un backup_ref, non lo produce.
- **Stesso artefatto in ogni ambiente.** Test/staging applicano per primi lo stesso SQL; la
  produzione applica lo stesso dopo l'approvazione, quindi non possono divergere in silenzio.
- **Release Preview.** L'IDE calcola lo stesso piano tag -> HEAD dal git tree, senza database, e
  fallisce chiuso dove l'analyzer non risolve una dichiarazione. Il preview mostra il piano che
  parte, non SQL inventato: cio' sostituisce la premessa di D-086 (che rifiutava di sintetizzare
  SQL nel preview) perche' la generazione ora e' deterministica dai tag e l'artefatto CI e'
  l'autorita'.
- **v1 non fa data batch.** Un piano che richiede righe esistenti modificate fallisce il rilascio
  con data_needed; i backfill scritti a mano restano fuori scope (decisione 5 del piano).

**Rejected.** applicare il diff live -> dichiarato al deploy (non deterministico, dipende dallo
stato e non e' revisionabile), SQL committato nel repo o manifest OCI (artefatti CI chiave tag:
decisione 1), drizzle-kit migrate come deploy step, flag umano a ogni deploy (l'approvazione e' un
atto di rilascio), backup eseguito dal framework (lo fa l'ambiente di rilascio), confronto live al
momento del rilascio (l'IDE/CI non hanno il DB).

**Consequences.** facilis db deploy/status/adopt/repair prende il posto dello snippet di POSTGRES
§4; SPEC §2/§7.7/§11.3 e APP-UPDATES §5 cambiano; da emendare anche D-086 (premessa schema-lens),
D-109 (completato da D-158), D-065/D-070 (step DB dell'upgrade), D-136 (RLS dentro gli artefatti),
D-052 (snapshot PGlite dev), D-078 (publish + tag). Matrice di stati e flussi:
docs/MIGRATION-PLAN.md §2.3-§2.5.

**Verification.** P1: digest canonico e round-trip dichiarato <-> live. P3: matrice di stati
(vuoto, indietro, ripristinato, adottato, drift, parziale, ruolo sbagliato), secondo run a 0
statement, deploy interrotto, rifiuti tipizzati, e2e PGlite + Postgres. P4: lo stesso piano in IDE e
pipeline per la stessa coppia di tag.

### D-160 — Le viste sono nodi del project graph, con le rotte che le usano
**Status:** accepted (2026-11-11)

**Context.** D-157 ha reso `dbTables` una dichiarazione applicata: una route elenca le relazioni che
può toccare, **tabelle e viste**, e per una vista dichiara il nome SQL della `defineView` (non le tabelle
base). Il grafo del progetto però mostrava solo pagine, route e tabelle: il "quale route fa cosa" era
visibile per le tabelle e invisibile per le viste, e O-013 lo teneva aperto. D-157 aveva rinviato
esplicitamente i nodi vista. L'owner ha chiesto di vedere le viste sul grafo e di capire quando le usano
le rotte.

**Decision.**

- **Fatti.** `@facilis.dev/analyze` aggiunge un nodo `view` al `ProjectGraph` per ogni `ViewFact`:
  id `view:<nome SQL>`, sorgente il file `db/views/**`, dati `ViewNodeData` (nome, tabelle base
  dichiarate, `permission`, `access` invoker/definer/ignoto, unknown). `analysis.views` resta la
  fonte dei fatti; il grafo ne è la proiezione.
- **Archi dalle rotte.** Una voce di `dbTables` che denota una vista produce un arco `route-view`
  (label `dbTables`, id `route-view:<route>:dbTables:<view>`), marcato `elevated` quando la vista è
  in `options.tables` di un'elevazione `ctx.sudo`/`ctx.system`, come già per le tabelle. La fonte è la
  **dichiarazione**, non l'uso osservato dal pass delle relazioni: D-157 rende la dichiarazione
  verificata e garantita a runtime, quindi dichiarazione e accesso non possono divergere senza un
  errore. I `dbColumns` restano solo delle tabelle (le viste non hanno fatti colonna).
- **Archi delle viste.** Le tabelle base dichiarate in `defineView.tables` (metadata informativa,
  D-097) producono archi `view-base` (id `view-base:<view>:<base>`), con target il nodo tabella o
  l'altra vista che esiste; una base non dichiarata staticamente non produce arco, e
  l'autoreferenza è ignorata.
- **IDE.** La vista è il quarto tipo di nodo e sta nella **colonna dello schema, sotto le tabelle**
  (non una colonna nuova: gli archi route→vista attraverserebbero la colonna delle tabelle). Il nodo
  mostra badge vista, modalità invoker/definer + permesso, tabelle base (collassabili) e "usata da N
  rotte"; l'inspector elenca le rotte che la usano; filtri/legenda/conteggi coprono i due nuovi tipi di
  arco. I nuovi tipi sono **in coda** a `GRAPH_EDGE_KINDS`, così l'ordine persistito di
  `hiddenEdges` non cambia per i layout esistenti (il formato file resta v3: un progetto senza viste
  produce un layout identico a prima).
- **Contratto.** `GraphNodeKind` guadagna `view` e `GraphEdgeKind` `route-view`/`view-base`:
  i consumer con switch esaustivi smettono di compilare, che è il comportamento voluto.

**Rejected.** Un flag "isView" sul nodo tabella (filtri, ricerca e inspector dovrebbero comunque
specializzarlo, e il contratto del grafo resterebbe ambiguo). Derivare route→vista dall'uso del pass AST
invece che da `dbTables` (seconda fonte di verità contro una dichiarazione già applicata). Una quarta
colonna di layout (gli archi route→vista passerebbero sopra le tabelle). Trattare le tabelle base di una
vista come accesso della route (D-157: sono metadata della vista, non accesso diretto).

**Consequences.** SPEC v1.28 §10.2/§11.2 e O-013 si aggiornano; il bullet "nodi vista" di D-157 resta
superato **solo per il grafo** (analyzer e validator invariati). Test: `graph.test.ts` (nodi e archi
vista) e i test del modello/layout del grafo IDE.

**Verification.** `pnpm --filter @facilis.dev/analyze test` (nodi, route-view, view-base, determinismo),
`pnpm --filter @facilis.dev/ide test` (dati, used-by-routes, posizionamento nella colonna schema, ricerca,
filtri), typecheck dei due pacchetti.

---

### D-161 — Workflow definitions are project-graph nodes; no Studio task inbox
**Status:** accepted (2026-11-10).

Owner request (2026-11-10): workflows should appear only in the project graph, with no new
"Attività" tab. The graph (D-092/D-134) is already the single static visualizer of the project,
built from `@facilis.dev/analyze` facts without booting the app. A tasks inbox in the Studio would
need a transport to the app's own authorized routes (session, page context, caching) and would
duplicate a surface the app owns; the tasks API deliberately has no framework HTTP endpoint
(D-135).

**Decision.** Add a `workflow` graph node kind. A pass reads each `server/workflows/**` default
export (a `defineWorkflow()` call from `@facilis.dev/core`): the name, the ordered steps with their
kind (`job`/`approval`), the job name or approval title key, the approval assignment permission and
the forward `onReject.step`. Unreadable fields stay explicit (`name: null` plus unknown facts),
and a file whose default export is not a `defineWorkflow` call is a `workflow-definition` warning,
never a crash. The graph renders the definitions in a fourth column with a per-step inspector;
there are no edges yet, because a workflow references jobs by name and jobs are not graph nodes.

**Consequences.** The graph is a definition view, not a run view: instance status and progress stay
in `facilis_workflows` and in the app's own UI. Static extraction covers literals and consts;
computed values show as unknown instead of guessing. Adding jobs as graph nodes later can add a
workflow→job edge without changing this node.

---

### D-162 — `dbTables` is an applied declaration for jobs too; a workflow's table surface is derived
**Status:** accepted (2026-11-11).

D-157 made `dbTables` an applied declaration for routes and stopped there: it kept background
jobs, `ctx.jobs` and their store on the unguarded client ('restano sul client non guarded
(framework) e fuori scope'). That carve-out was a hole of the same shape D-157 closed. A job's
`run(ctx)` receives the system-scoped transaction (D-107), so it can read and write every
table and view in the tenant, while the sudo audit recorded only the `tables` the definition
listed itself — the declaration was still self-certified. The workflow layer (D-135/D-161) adds
a derived surface on top: a workflow references jobs by name and declares nothing of its own, so
what it can reach is exactly the union of its steps' jobs' declarations.

**Decision.**

- **Contract (breaking).** `defineJob` requires `dbTables` (`readonly string[]`, tables and
  views by SQL name, `[]` = the job touches no relation) and accepts `rawSql?: boolean`
  (default `false`); the optional `tables` field is removed. `defineJob`/`isJobDefinition`
  validate the declaration shape and the registry skips an unreadable definition with its
  manifest warning.
- **Runtime.** The executor passes the declaration to `runAsSystem`, which wraps the elevated
  transaction in the same `guardDatabase` the route wrapper uses: every relation must be declared
  before its query runs. An undeclared relation fails closed with `table_not_declared`;
  `db.execute` without `rawSql: true` with `raw_sql_not_allowed`. The audit
  `started/succeeded/failed` entries record the declared set, the `succeeded` one adds the
  relations actually observed (`observedTables`), and the `failed` one carries the canonical
  code — never the relation name or the internal message.
- **Terminal failure.** A declaration violation is deterministic, so it is not retried: the
  attempt settles `failed` with the stable code even when `maxAttempts` would allow a retry.
- **Static side.** `@facilis.dev/analyze` gains `JobFact` (readable `dbTables`/`rawSql` or explicit
  unknown) and `JobRelationsFact` (relation usage in the `run` body, following project-local
  helper calls; views resolve like tables; package calls stay opaque). Diagnostics:
  `job-definition`/`job-definition-static` warnings, `job-table-undeclared`, `job-table-unresolved`
  and `job-raw-sql` errors, `job-table-unused` warning (suppressed when the usage is opaque or
  contains allowed raw SQL). `jobs-gate.test.ts` runs the pass over the shipped example and fails
  on the errors (the D-154 pattern); the AI validator gains rule 19 `job-table-declared` over the
  same facts, covering every effective job and not only the patched ones.
- **Workflow surface, derived.** A workflow declares no tables: `Analysis.workflowTables` is the
  sorted union of the `dbTables` of the jobs its job steps reference (approval steps contribute
  nothing). A missing referenced job is a `workflow-job-unknown` warning, and an unreadable job
  declaration (or step name) marks the surface as unknown instead of guessing. There is no
  workflow runtime change: a workflow job step runs through the job executor and inherits that
  job's guard.
- **Not graph nodes yet.** Jobs do not become project-graph nodes or edges in this change; a
  later step can add a job node and a workflow→job edge without changing this contract.

**Rejected.** A second, job-specific guard (the route guard already models the same declaration;
two guards drift). Retrying a declaration violation (the definition cannot change between
attempts). Inferring the declaration from observed usage instead of enforcing it (the static
pass is best-effort, package calls are opaque and raw SQL is invisible). Declaring workflow
tables separately (a second source of truth that drifts from the jobs; the union is derivable).
Project-graph job nodes in the same change (layout and edges need their own design; deferred).

**Consequences.** Breaking for handwritten jobs that used `tables` or omitted `dbTables`:
the CI gate and the runtime fail closed and the example/fixtures are updated. The D-157
carve-out is revoked for the job body: routes, elevations and jobs are all declaration-enforced,
with the same codes and the same observed audit; the framework's own queue store
(`ctx.jobs`, boot and ticks) remains framework code, not a project db surface. SPEC v1.31
§5.6/§7.9/§8.4.6/§9.3, JOBS.md §5/§7/§8, WORKFLOWS.md §6/§9 and AGENTS.md (invariant 2, 19
rules) follow. The AI validator is now 19 rules, not 18.

### D-163 — Two persisted filters remove the framework's feature surface from the project graph
**Status:** accepted (2026-11-11)

**Context.** The framework ships its own tables (auth users/sessions, jobs, workflows, files) and
feature routes (login, queue, workflow endpoints), and D-130 deliberately made the framework
tables reach the browser analyzer through the inlined package source. That closed the "missing
tables" gap but made the graph noisy: the project's own schema and routes are outnumbered by
surface the author did not write. Users need to declutter the drawn graph without losing the
integrity view (invalid and unknown facts must stay visible), and the choice has to be team state
like the rest of the graph layout (D-126).

**Decision.**

- **Two filters, off by default.** The graph toolbar gains a system-filters section
  (`projectGraph.systemFilters`) with **System routes** (`hideSystemRoutes`,
  `projectGraph.systemRoutes`) and **Unused system tables** (`hideSystemTables`,
  `projectGraph.systemTables`), each independently persisted and default `false`; the hint is
  `projectGraph.systemHint` and the removed-node count `projectGraph.hiddenNodes`.
- **System routes.** A route is *system* when its `sourceFile` starts with `node_modules/` OR —
  when the wrapper is known (`unknown === false`) — none of its declared `dbTables` names a
  project-declared relation (a non-framework table or any view). A route whose wrapper is
  unknown/invalid is never hidden, even when the filter is on.
- **Unused system tables.** A table is *system* when it carries the framework flag (declared by
  an installed `@facilis.dev` package, source under `node_modules/`, the `sistema` badge) and is not
  the target of a `route-table` or `route-view` edge whose source is a non-system route. A
  framework table the project's own routes use (e.g. `facilis_files` reached from the
  `/api/todos` routes) therefore stays visible.
- **Drawn view.** An enabled filter removes its hidden nodes and every edge touching them; the
  automatic layout is computed from the visible nodes while the saved positions of the remaining
  nodes are kept, and `ProjectGraphStats.hiddenNodes` reports how many nodes are gone.
- **Persistence.** `.facilis/graph/layout.json` (D-126) gains two additive booleans,
  `hideSystemRoutes`/`hideSystemTables`, default `false`; the file version stays 3 and a layout
  written without them reads as show-everything. "Reset layout" keeps these view preferences,
  exactly like `hiddenEdges`. `graph_state`/`graph_arrange` and the AI patch flow are unchanged
  besides the two additive fields.

**Consequences.** No analyzer change: the classification is derived in the IDE from facts that
already exist (`framework`, `sourceFile`, `dbTables`, the two route edges), so the manifest,
OpenAPI and validator are untouched. Old `layout.json` files and older IDE builds keep working —
the fields are additive and the version does not move. The route classification is a documented
heuristic: a project route that touches no DB relation is classified as system, so the filter
defaults off and can simply be left off; it is a declutter option, not an integrity boundary.
Hidden nodes are not deleted: their positions stay in the layout, so re-enabling a filter restores
the arrangement.

**Verification.** Unit tests in `ide/src/facilis` cover the classification and the view model
(both filters on/off, unknown routes always shown, a project-used framework table kept) and the
layout round-trip (fields default `false`, a file without them reads as off, reset keeps them).
`pnpm --filter @facilis.dev/ide typecheck` and `pnpm --filter @facilis.dev/ide test`.

### D-164 — The framework packages publish to npm under `@facilis.dev` on every deploy
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

**Consequences.** O-006 is resolved: the packages are installable by name, which unblocks the
`starter/` task D-027 deferred. **Amended by D-166:** generated projects no longer install vendored
tarballs; they install these published packages at the exact version the IDE build pins. The repo version is a floor, not the published version — the workflow
derives it — and a manual release uses the same script (`pnpm publish:dry-run`, then
`pnpm publish:packages` after `npm login`). The old `@facilis/*` names stop resolving.
**Amended by D-166:** the separate publish workflow is gone — publishing is the first job of
`.github/workflows/deploy-ide.yml`, which then builds the IDE against the version it just published.

### D-165 — The hosted IDE signs in with a GitHub App; its public client id lives in the deploy config
**Status:** accepted (2026-11-11)

**Context.** D-082 chose the GitHub device flow and left the registration as "an OAuth app, once
per deployment". The hosted IDE on `ide.facilis.dev` is a public product surface whose build is
in this repo: it must not hold a client secret, and it should ask for the narrowest permission
that still allows a clone and a push rather than the blanket `repo` scope.

**Decision.** The hosted deployment registers a **GitHub App** with device flow enabled:
repository permissions `Contents: Read and write` plus the mandatory `Metadata: Read-only`; no
webhook, no callback URL, no private key, no client secret. Its **client id** — public by design
— lives in `deploy/ide.facilis.dev.json`, which `.github/workflows/deploy-ide.yml` passes to the
build through `FACILIS_DEPLOY_CONFIG` (D-077). The device-flow code is unchanged: GitHub Apps
ignore OAuth scopes (permissions come from the app registration) and the same two proxied
endpoints return a user access token. The app must be **installed** on every account whose
repositories the token pushes to; a user access token only reaches accounts where the app is
installed.

**Consequences.** Consent shows a fine-grained app instead of the `repo` scope, and the token can
only write the contents of installed repositories. Installation is a step an OAuth app does not
have (one click, `Install App`, per account), and the app's user tokens expire after 8 hours
unless expiring tokens are disabled — the IDE keeps the token in tab memory and asks for a new
sign-in, which D-082 already accepts. The client id is committed, so the deployment is
reproducible; another deployment with its own app points `FACILIS_DEPLOY_CONFIG` at its own
config file. An OAuth app remains supported and documented for deployments that prefer it.

---

### D-166 — Generated projects install the published packages at the version the IDE build pins
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

---

### D-167 — Patch write scope follows the deployment profile: `open` allows the project minus the machine surfaces, `managed` keeps the six roots
**Status:** accepted (2026-11-11)

**Context.** Rule 11 `file-path-allowed` only allowed the six project roots plus
`facilis.config.ts` (D-084), so an AI patch could not add a Wrangler config, a `.github`
pipeline, root Vite/Nitro config or `index.html`; the IDE's own writers already had
`allowedRootFiles`, but AI patches never pass it by design. The deployment profile (D-063) is
the right axis: `managed` cannot review each patch, while `open` is the user's own project and
the user still reviews and applies every patch.

**Decision.**

- `validatePatch` gains `writePolicy: "open" | "managed"`, defaulting to `"managed"`
  (fail-closed for external/Node callers); rule 11 keeps its id and severity.
- `managed` is unchanged: the six roots plus `facilis.config.ts`, plus the IDE writer's explicit
  `allowedRootFiles` (AI patches never get it).
- `open` allows any project-relative path except a `node_modules`/`.git`/`.facilis`/`dist`/
  `.turbo`/`coverage` segment, the install surface (`package.json`, `package-lock.json`,
  `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `.npmrc`) and `AGENTS.md`.
- The IDE maps `aiWritePolicy` from its build profile (`ide/src/deploy/current.ts`) and passes
  it to apply/proposal/Apply validation and the PTC validate tool; `buildSystemPrompt` states the
  effective rule in a "## Writable paths" section. Node tooling keeps `managed`.

**Why.** `package.json`/lockfiles/`.npmrc` are the install surface (dependency injection;
AI-SKILLS §4 rule 5, O-009); `node_modules` is code that never went through an install;
`.git`/`.facilis`/`dist`/`.turbo`/`coverage` is VCS/IDE/build state the Explorer does not
review and the PTC read policy already hides; `AGENTS.md` persists instructions into later
sessions (D-084). A CI workflow can read repository secrets, which is why `managed` stays strict.

**Consequences.** Managed AI stays strict and never accepts a CI workflow, which is the point of
the split; `open` builds can create CI, Wrangler and root config. No rule id or count changes.
§5.5/§9.3 of the spec and MANAGED-DEPLOYMENT §1 follow.

---

## Open items (post-MVP)

Rows marked `done` are kept so their O-IDs stay resolvable; only the rows without a resolution are
live. The resolving ADR is in the row.

| ID | Question | Proposed default | Needed by |
|---|---|---|---|
| O-001 | i18n key format: flat (`todos.title`) vs nested (`todos.form.title`) | **resolved in Phase 1: flat keys** (`t()` in `@facilis.dev/core`, `locales/en.json`) | done |
| O-002 | Canonical API error-code registry | **resolved in Phase 1:** `FacilisErrorCode` union in `@facilis.dev/core` (`unauthorized`, `forbidden`, `invalid_input`, `conflict`, `db_unavailable`, `not_found`, `storage_unavailable`, `file_too_large`, `unsupported_media_type` — D-141, `too_many_requests` — D-143, `payload_too_large` — D-153, `email_unverified` — D-156, `internal_error`), serialized as `{ code, details? }` — no prose | done |
| O-003 | Tenancy: `users.tenantId` exists but no `tenants` table (spec §5.3 vs §8.4.2) | **resolved in Phase 1:** single-tenant deployment; tenant comes from `FACILIS_TENANT_ID` (`defaultTenantId` in the event context). A `tenants` table arrives only with multi-tenant | done |
| O-004 | Block discovery: `node_modules` scan vs explicit registration | **resolved by D-131:** no block supply chain — Phase 5 retired and `@facilis.dev/blocks` deleted; nothing to discover | done |
| O-005 | Starter repo count (one todo template vs several) | one `starter/` todo template for MVP | Phase 6 |
| O-006 | Publish target for `@facilis.dev/*` (public npm vs private registry) | **resolved by D-164:** public npm under the `facilis.dev` organization, published by the release job in `.github/workflows/deploy-ide.yml` on every deploy with a derived patch version (D-166) | done |
| O-007 | Recommended default AI model | **resolved with D-045:** no enforced default; each provider preset carries an editable model default | done |
| O-008 | Release-preview boot strategy (sequential boots vs `?at=<oid>`) | **resolved with D-086:** no boot — the Studio reads the refs from the git tree with isomorphic-git and diffs parsed snapshots | done |
| O-009 | Validator rule 11 path allowlist vs rule 16 | **resolved with D-084:** the allowlist is the six project roots plus `facilis.config.ts`; root `AGENTS.md` only through the IDE writer's explicit `rootFiles`; rule 16 handles role/config sync via a migration in the same patch. **Revisited by D-167:** the write scope follows the deployment profile — `open` allows the project minus the install surface, the VCS/IDE/build state and `AGENTS.md`, `managed` keeps the six roots — while `package.json`, lockfiles and `.npmrc` stay blocked in both | done |
| O-010 | Auth schema drift: Drizzle (`tenantId` notNull) vs SQL seed PK/NOT NULL | reconcile in `@facilis.dev/auth/db`; one source (Drizzle schema) generates the SQL | Phase 1 (auth) |
| O-011 | Data Explorer connection when the app runs in its own preview tab and in the isolated preview modes | **partly resolved by D-097:** the live transport is kernel-mediated (same-origin `/preview/<port>/…` through the Studio's SW), so a popped-out preview works in modes A/B. Still open: declared tables from `@facilis.dev/analyze` for a project that is not running, and preview mode C (wildcard origins register no same-origin SW) | Phase 3.5 follow-up |
| O-012 | Query console RLS mode: the console runs as the connecting superuser (developer preview), so it does not show what a user sees | add the SPEC §11.2 selector — run the statement as `facilis_app` with a chosen `app.*` scope, next to the developer mode | Phase 3.5 follow-up |
| O-013 | Views in analyzer facts, graph and reverse lookup | **resolved for the project graph by D-160:** `ViewFact` becomes a `view:<name>` node (invoker/definer, permission, base tables), a route that declares a view in `dbTables` gets a `route-view` edge and the declared base tables get `view-base` edges; `defineView` facts and the validator were D-157. Still open: the Entity Explorer's declared views and its reverse lookup | Phase 4 (Entity Explorer half) |
| O-014 | Log pipeline and retention beyond the local file | **resolved by D-119:** one JSONL pipeline, redaction/rotation/hash chain and env-owned sinks; WORM/external sinks remain O-019 | done |
| O-015 | Definer-view reads are permission-gated but not logged per query | keep reads unaudited (a view is a table-like resource); if read provenance is required, add an explicit route helper or a database-level statement audit (`pgaudit`/log-statement), not a per-query framework hook | Phase 4 |
| O-016 | Model B: replace preloaded context with a PTC tool runtime — the model writes one JavaScript program per step, the IDE executes it in a locked sandbox against a read-only tool registry (files, analyzer facts, manifest; MCP later). | **resolved with D-101:** PTC pure (`script` XOR `patches`), opaque-origin iframe + inner blob Worker (phase-0 spike 21/21), read-only tools plus a `validate` self-check, final §9.3 gate kept as the safety net. Design: [PTC.md](./PTC.md). | done |
| O-017 | Background jobs: a workflow/chaining construct, retention & pruning of `facilis_jobs`, exponential backoff, multi-instance/distributed workers, a dev-only inspection endpoint | **durable claim/attempt counters are the seam; a workflow is a separate construct** (docs/JOBS.md §10) — design approved in D-135 ([WORKFLOWS.md](./WORKFLOWS.md)); W1–W3 landed (SPEC §7.10); retention/pruning and the dev-only inspection endpoint remain | Phase 7+ |
| O-018 | AI chat UX: the IDE transcript should feel like the harness's session view — light and dense, one collapsed line per step (reasoning, model call, program) expanding on click instead of bordered cards — plus a "compact" mode and file attachments in the composer | recorded in [CHAT-UX.md](./CHAT-UX.md). Owner decision 2026-11-07: **"compact" means context compaction** (summarize older turns into one replayable message), not a density switch; the density/style work remains a later visual slice. Attachments: project files as path references read with the PTC tools first; OS files/images only once the multimodal message format exists — **pasted screenshots landed in D-113**; the lighter transcript landed in D-114. **Context compaction landed in D-133** (header action, `ChatState.summary`, replay swap, marker row). Remaining: the project-file picker | IDE chat polish, after the preview tools (D-111 landed) |
| O-019 | Log retention and tamper evidence beyond a local file: WORM storage, an HMAC-keyed chain, and external sinks (S3/Syslog/OTLP) | D-119 gives the file/stdout pipeline with a SHA-256 `seq`/`prevHash` chain and delegates WORM/retention to the deploy's log platform. Add an optional HMAC key per deployment (`FACILIS_LOG_HMAC_KEY`) and a `committed`/`rolled_back` entry for the request transaction before this is called tamper-proof | Phase 7+ |
| O-020 | SSO depth: IdP-initiated SAML, SCIM provisioning, refresh tokens/session sync, TOTP/WebAuthn as a second factor | keep SP-initiated SAML, JIT linking/provisioning and password+SSO only; each of the four is a separate contract (and 2FA needs a second credential table, not a provider flag) | Phase 7+ |

When an item is decided, add the resolving `D-0NN` and mark the row done; update
`docs/SPEC.md` if a contract changes.
