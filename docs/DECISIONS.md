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

---

## Open (do not block Phase 0/1; resolve before the noted phase)

| ID | Question | Proposed default | Needed by |
|---|---|---|---|
| O-001 | i18n key format: flat (`todos.title`) vs nested (`todos.form.title`) | flat keys | Phase 1 (locales) |
| O-002 | Canonical API error-code registry | single `FacilisErrorCode` union in `@facilis/core`, serialized as `{ code, message?, details? }` | Phase 1 (routes) |
| O-003 | Tenancy: `users.tenantId` exists but no `tenants` table (spec §5.3 vs §8.4.2) | ship single-tenant; add `tenants` only when multi-tenant is in scope | Phase 1 (auth schema) |
| O-004 | Block discovery: `node_modules` scan vs explicit registration | scan `node_modules/*/manifest.*` (already assumed by revision hash) | Phase 5 |
| O-005 | Starter repo count (one todo template vs several) | one `starter/` todo template for MVP | Phase 6 |
| O-006 | Publish target for `@facilis/*` (public npm vs private registry) | start workspace-only; decide before first publish | Phase 6 |
| O-007 | Recommended default AI model | none in code; document Claude Sonnet-class as tested default | Phase 4 |
| O-008 | Release-preview boot strategy (sequential boots vs `?at=<oid>`) | schema-only `?at=<oid>` first, sequential behind a flag | Phase 3.5 |
| O-009 | Validator rule 11 path allowlist vs rule 16 | extend allowlist with root config files (`facilis.config.ts`, `vite.config.ts`, `nitro.config.ts`, `package.json`, `locales/`, `lib/`, `components/`) and let rule 16 handle role-sync | Phase 4 (validator) |
| O-010 | Auth schema drift: Drizzle (`tenantId` notNull) vs SQL seed PK/NOT NULL | reconcile in `@facilis/auth/db`; one source (Drizzle schema) generates the SQL | Phase 1 (auth) |

When an item is decided, move it to **Accepted** with a `D-0NN` entry and update
`docs/SPEC.md` if a contract changes.
