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

### D-017 — Project site and canonical domain: facilis.dev
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

### D-017 — The Studio app and the vendored Vivari kernel are separate trees
**Status:** accepted (2026-10-25), supersedes the layout part of D-011

Vendoring the whole Vivari monorepo as `studio/` made the repository contain a second npm
workspace root: `studio/packages/studio` was the app, `studio/packages/*` was the kernel, and
`studio/{scripts,worker,examples,package-lock}` belonged to neither. Ambiguous ownership is a
real maintenance cost (which `package.json`/workspace/ignore applies where?), so the tree was
partitioned by *role*:

| Path | Contents | Owned by |
|---|---|---|
| `studio/` | upstream `packages/studio` only — the app we fork | Facilis (patch set documented) |
| `vendor/vivari/` | pinned upstream kernel: `packages/{core,kernel-host,runtime,protocol,vfs,codec,crypto,react,wasi-demo}`, `scripts/`, `worker/`, `examples/basic`, upstream root/legal files | upstream (read-only) |

No file is duplicated: each upstream file appears once, just partitioned. The app needs a small
patch set to see the kernel at its new path — the `@vivari/core` alias in `vite.config.ts` and
`tsconfig.app.json`, `fs.allow` widened to the repo root, and five deep imports in `studio/src/vv`
— documented in `studio/README.md` and `vendor/vivari/FACILIS.md` §5, which is also the recipe for
upstream syncs. This matches SPEC §4.1, which always described `studio/` as the app.

**Consequences:** `pnpm-workspace.yaml` stays `packages/*` + `examples/*`; `studio/` and
`vendor/` are excluded from lint/format/file-length/typecheck; the Studio installs separately
(`pnpm install --ignore-workspace`). Upstream sync = copy paths back into place, re-apply the
documented patch set, re-run the checks.
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
| O-007 | Recommended default AI model | none in code; document Claude Sonnet-class as tested default | Phase 4 |
| O-008 | Release-preview boot strategy (sequential boots vs `?at=<oid>`) | schema-only `?at=<oid>` first, sequential behind a flag | Phase 3.5 |
| O-009 | Validator rule 11 path allowlist vs rule 16 | extend allowlist with root config files (`facilis.config.ts`, `vite.config.ts`, `nitro.config.ts`, `package.json`, `locales/`, `lib/`, `components/`) and let rule 16 handle role-sync | Phase 4 (validator) |
| O-010 | Auth schema drift: Drizzle (`tenantId` notNull) vs SQL seed PK/NOT NULL | reconcile in `@facilis/auth/db`; one source (Drizzle schema) generates the SQL | Phase 1 (auth) |

When an item is decided, move it to **Accepted** with a `D-0NN` entry and update
`docs/SPEC.md` if a contract changes.
