# Phase 1 — internal module contracts

Coordination file for Phase 1 (owner: **Lead**). `docs/SPEC.md` wins over this file; this
file only fixes **module boundaries** so four packages can be written in parallel without
import cycles or API drift.

> **Status:** implemented (2026-10-25) and verified by `examples/todo-app`.
> Three deltas landed during integration: (1) `#facilis/openapi-meta` is owned by the
> `facilis()` Vite plugin only — Nitro's virtual plugin resolves that id first and serves
> stale metadata; (2) relative imports inside `packages/*/src` carry `.ts` (AGENTS.md),
> which is what lets Node load a Vite config that imports the framework; (3) `facilis()`
> mounts Nitro and takes the project's Nitro options from `facilis.config.ts` (D-034), so
> projects never import `nitro/vite` and never keep a `nitro.config.ts`.

## 1. Ownership

| Area | Files you own | Teammate |
|---|---|---|
| Core contract | `packages/core/**` | core-impl |
| Data + auth | `packages/db/**`, `packages/auth/**` | data-auth |
| Framework runtime | `packages/nitro/**` | nitro-impl |
| IDE fork | `ide/**` (was `studio/` during the import) | studio-forker |
| Integration app, docs, root configs, git, PRs | everything else | Lead |

## 2. Ground rules

- Read `AGENTS.md`, `docs/SPEC.md` (sections cited per package) and `docs/DECISIONS.md` before coding.
- **Never** run `pnpm add`, `pnpm install`, `git commit`, `git checkout`, `git stash`, `git rebase` —
  the Lead owns dependencies and git. Ask the Lead for a new dependency.
- Do not edit files outside your scope (root configs, docs, other packages). Report needed changes.
- Constraints (enforced by root gates): no `any`, named exports only, kebab-case file names,
  **max 300 lines per file**, ESM, TypeScript strict, comments explain why.
- Every new module ships colocated `*.test.ts` tests (Vitest). Tests must be deterministic and
  fast; no network, no ports, no long sleeps.
- Per-package gates while working:
  `pnpm --filter <pkg> typecheck`, `pnpm --filter <pkg> test`, `pnpm --filter <pkg> lint`
  (also `pnpm exec prettier --check src` from the package directory).
- Report spec defects to the Lead in your final message — do not silently invent APIs.
- Installed versions (already in the workspace): zod 4.6.7, drizzle-orm 0.45.4, drizzle-kit
  0.31.11, @electric-sql/pglite 0.5.11, nitro 3.0.260903-beta, vite 8.3.5, rolldown 1.2.15.

## 3. Dependency graph (fixed — do not add cycles)

```
@facilis/db     -> drizzle-orm, @electric-sql/pglite        (leaf)
@facilis/auth   -> @facilis/db, drizzle-orm
@facilis/core   -> @facilis/auth, @facilis/db, zod
@facilis/nitro  -> @facilis/core, @facilis/auth, @facilis/db, nitro, vite, rolldown
```

`core`, `auth` and `db` must **never** import `nitro`, `vite` or `h3`. That is why they use the
structural event type below instead of `H3Event`.

## 4. Shared runtime conventions

### 4.1 Event context (owned by core, populated by nitro middleware)

```ts
// packages/core/src/event.ts
export interface FacilisRequestEvent {
  context: {
    auth?: AuthContext | null;
    facilis?: { db: FacilisDb; defaultTenantId?: string };
  };
  req: { headers: Headers };
  res?: { headers: Headers };
}
```

An `H3Event` satisfies this structurally. Middleware order inside Nitro: `facilis-context`
(boots db, sets `context.facilis`) then `facilis-session` (sets `context.auth`, may be `null`).

### 4.2 Postgres GUCs (exact names — policies depend on them)

| GUC | Value | Set by |
|---|---|---|
| `app.tenant_id` | uuid text | `runWithPolicyScope` |
| `app.user_id` | uuid text | `runWithPolicyScope` |
| `app.roles` | JSON array text, e.g. `["admin","manager"]` | `runWithPolicyScope` |

Every policy that reads a GUC **must** use `nullif(current_setting(<name>, true), '')` before
casting (see SPEC §8.4.5 and the Phase 0 finding: after `RESET` a GUC reads as `''`).

### 4.3 RLS composition (Phase 0 finding D-008)

- Tenant isolation: `AS RESTRICTIVE` (permissive clauses are OR-ed, restrictive are AND-ed).
- Owner and role clauses: permissive.
- `ENABLE ROW LEVEL SECURITY` on every scoped table; `getTableConfig().policies` must be non-empty.

### 4.4 Auth + errors

- Session cookie name: `facilis_session`; `HttpOnly`, `Path=/`, `SameSite=Lax`, `Secure` in prod.
- Set/clear the cookie on the event's response headers (`event.res.headers.set("set-cookie", …)`)
  and return a plain body: a `Set-Cookie` on a returned `Response` is dropped in the in-VM
  Nitro dev path (D-038).
- Error codes: `unauthorized` (401), `forbidden` (403), `invalid_input` (400), `conflict` (409),
  `db_unavailable` (500), `not_found` (404), `internal_error` (500). Export
  `fail(code, details?)` from core returning a web `Response`;
  body is `{ code: string, details?: unknown }` — codes only, no prose.
- Codes in Phase 1: `unauthorized` (401), `forbidden` (403), `invalid_input` (400, `details` =
  flatten of Zod issues), `db_unavailable` (500), `not_found` (404), `internal_error` (500).
- `defineAuthorizedHandler` returns a web `Response` for errors (no `h3` import); success values
  are returned as plain data.
- `permission: []` handlers may run without a session: their `ctx.auth` must be typed
  `AuthContext | null` (overloaded `defineAuthorizedHandler`), everything else gets the
  non-null `AuthContext`.
- Permission semantics: `permission: []` = public (no session required); non-empty array =
  session required **and** at least one permission must match; `*` in a role expands to all
  permissions from `config.auth.permissions`.
- Dev-only `/__facilis/*`: `404` when `NODE_ENV === "production"`; origin must match the request
  host (allow `http://localhost:*` and `http://127.0.0.1:*` / `[::1]`); `Cache-Control: no-cache`.

## 5. `@facilis/db` (data-auth)

```ts
export type DbDriver = "pglite" | "postgres";
export interface CreateDbOptions { driver?: DbDriver; url?: string; dataDir?: string; schema?: Readonly<Record<string, unknown>> }
export interface FacilisDb { readonly driver: DbDriver; readonly db: PgDatabaseLike; close(): Promise<void> }
export function createDb(options?: CreateDbOptions): Promise<FacilisDb>;

export interface PolicyScope { tenantId?: string; userId?: string; roles?: readonly string[] }
export type PolicyScopedDatabase = /* Drizzle pg database | transaction, generic, no any */;
export function runWithPolicyScope<T>(
  db: FacilisDb,
  scope: PolicyScope,
  fn: (tx: PolicyScopedDatabase) => Promise<T>,
): Promise<T>;

export interface RlsOptions { tenantColumn?: string; ownerColumn?: string; rolesColumn?: string }
export function tenantIsolationPolicy(column?: string): PgPolicy;   // AS RESTRICTIVE + nullif
export function ownerIsolationPolicy(column?: string): PgPolicy;    // permissive
export function rolePolicy(column: string, policyName?: string): PgPolicy; // permissive

export function applyStatements(db: FacilisDb, statements: readonly string[]): Promise<void>; // idempotent bootstrap/migration runner
export function ensureAppRole(db: FacilisDb): Promise<void>;  // role facilis_app + grants (dev RLS enforcement)

export interface SchemaSnapshot { tables: TableSnapshot[] }
export function schemaSnapshot(db: FacilisDb): Promise<SchemaSnapshot>; // drizzle getTableConfig
```

- `createDb()` must work with `@electric-sql/pglite` in-memory (tests) and honour `dataDir`.
- The `postgres` driver may throw a typed "not implemented in Phase 1" error; do not add `pg`.
- `runWithPolicyScope` opens a transaction, then in this order: `SET LOCAL ROLE facilis_app`
  (the non-superuser app role - PGlite connects as superuser and superusers bypass RLS even with
  FORCE, Phase 0 finding), then `SET LOCAL`/set_config the three GUCs, then runs the callback.
- `ensureAppRole(db)`: dev bootstrap that creates role `facilis_app` (NOSUPERUSER NOBYPASSRLS
  NOLOGIN) if missing and grants SELECT/INSERT/UPDATE/DELETE on all current tables in the public
  schema. Called by the Nitro module after migrations; without it RLS is not enforced in dev.
- `schemaSnapshot` derives tables/columns/FKs/policies from Drizzle `getTableConfig` (SPEC §7.3, §11.1).
- RLS generator output must match the Phase 0 verified SQL (see `spikes/phase0/tests/pglite-rls.test.ts`),
  including the superuser caveat: tests need a non-superuser role via `SET ROLE`.

## 6. `@facilis/auth` (data-auth)

```ts
export interface AuthContext { userId: string; tenantId: string; roles: readonly string[]; permissions: readonly string[] }
export interface AuthConfig { permissions: readonly string[]; roles: Readonly<Record<string, readonly string[]>>;
  defaultRole: string; sessionDurationMs: number }
export function expandRoles(roles: readonly string[], config: AuthConfig): string[];
export function hasPermission(subject: Pick<AuthContext, "permissions"> | null, permission: string | readonly string[]): boolean;
export const users, sessions, roles, rolePermissions, userRoles;  // Drizzle pgTable, SPEC §5.3
export function hashPassword(password: string): Promise<string>;    // PBKDF2-SHA256, WebCrypto
export function verifyPassword(hash: string, password: string): Promise<boolean>;
export function createSession(db: PolicyScopedDatabase, userId: string, opts?: { ttlMs?: number }): Promise<{ id: string; expiresAt: Date }>;
export function validateSession(db: PolicyScopedDatabase, sessionId: string): Promise<{ user: AuthUser; session: SessionRow } | null>;
export function destroySession(db: PolicyScopedDatabase, sessionId: string): Promise<void>;
export function seedFromConfig(config: AuthConfig): Array<{ role: string; permission: string }>;
export function registerInitialAdmin(db: PolicyScopedDatabase, userId: string): Promise<boolean>; // FACILIS_INITIAL_ADMIN
export function sessionMiddleware(...): SessionEvent => Promise<void>  // reads cookie, sets event.context.auth
```

- Tables must use `pgPolicy`/`enableRLS` where the spec requires it (tenancy on `users`).
- `seedFromConfig` is a **pure projection** of the config (SPEC §5.3): no runtime writes to
  `role_permissions`; the generated seed is consumed by the migration/seed step.
- `registerInitialAdmin` compares against `process.env.FACILIS_INITIAL_ADMIN` (email), grants `admin`.

## 7. `@facilis/core` (core-impl)

```ts
export function defineConfig(config: FacilisConfig): FacilisConfig; // validates via Zod, throws on invalid
export const facilisConfigSchema: z.ZodType<FacilisConfig>;          // SPEC §7.1 shape

export interface AuthorizedHandlerConfig<B = void, Q = void, P = void> {
  permission: string | readonly string[];
  body?: z.ZodType<B>; query?: z.ZodType<Q>; params?: z.ZodType<P>;
  dbTables: readonly string[];       // REQUIRED, may be empty
  dbColumns?: readonly string[];      // "table.column"
  description?: string;
}
export interface AuthorizedHandlerContext<B, Q, P> { auth: AuthContext; body: B; query: Q; params: P; db: PolicyScopedDatabase }
export function defineAuthorizedHandler<B, Q, P>(
  config: AuthorizedHandlerConfig<B, Q, P>,
  handler: (event: FacilisRequestEvent, ctx: AuthorizedHandlerContext<B, Q, P>) => Promise<unknown> | unknown,
): (event: FacilisRequestEvent) => Promise<unknown>;

export function buildManifest(input: BuildManifestInput): FacilisManifest;   // SPEC §7.3
export function summarizeManifest(manifest: FacilisManifest): ManifestSummary; // SPEC §6.1, <500 tokens
export function computeRevision(input: RevisionInput): Promise<string>;      // SHA-1, SPEC §6.5
export function t(key: string, params?: Record<string, string | number>): string; // i18n, flat keys
export function registerCatalog(locale: string, messages: Record<string, string>): void;
```

- `defineAuthorizedHandler` semantics: session → permission → Zod parse → scoped DB → handler.
  It must **not** call `defineRouteMeta` at runtime (it is a Nitro build macro; Phase 0 A16).
  Static metadata extraction is the AST pass in `@facilis/nitro`.
- Config validation must cross-check roles/permissions (unknown permission in a role → error),
  and `defaultRole` must exist (SPEC §8.4.1).
- Manifest types: re-export `SchemaSnapshot`/`TableSnapshot`/... from `@facilis/db` so the public
  surface stays `@facilis/core` (SPEC §5.1). `RouteMeta`, `FacilisManifest`, `ManifestWarning`,
  `ManifestSection`, `ManifestSummary` are declared in core.
- i18n: flat keys, `t("key")` returns the key and records a warning when missing; no throw.

## 8. `@facilis/nitro` (nitro-impl)

```ts
export function facilis(options?: FacilisOptions): FacilisPlugins; // [FacilisVitePlugin, ...Plugin[]]
export const facilisNitroModule: NitroModule;             // plain { name, setup(nitro) }, NOT defineNitroModule
export function scanRouteMetadata(options: ScanOptions): Promise<RouteMetadataMap>;
export function mergeOpenApiMetadata(spec: OpenApiDocument, meta: RouteMetadataMap): OpenApiDocument;
```

**Verified facts — do not re-litigate, verify only:**
- Nitro v3 has **no `nitro/kit` export and no `defineNitroModule`** (spec §5.6 is stale).
  The module is a plain object `{ name, setup(nitro) }`; type from `nitro/types`.
- `nitro()` from `nitro/vite` returns `Plugin[]`; a Vite `Plugin` may carry `nitro?: NitroModule`.
- `facilis()` **mounts Nitro**: it returns `[FacilisVitePlugin, ...nitro()]`, and the Facilis
  plugin (`enforce: "pre"`) has a `config` hook that loads `<root>/facilis.config.ts` natively
  and returns `{ nitro: mergeNitroOptions(config.nitro) }` — the framework defaults
  (`serverDir: "./server"`, `experimental.openAPI: true`) under the project's overrides.
  Because the hook runs before Nitro's, the order inside `plugins` does not matter.
- `@facilis/nitro` value-imports `nitro/vite`, so `nitro` is a **required** peer dependency;
  `vite` stays optional (only the `/vite` entry needs it). Projects never import `nitro/vite`
  or keep a `nitro.config.ts`; a legacy one is still read by Nitro's c12 loader but
  `facilis.config.ts` wins.
- Inside `setup`, `nitro.options.handlers` / `nitro.options.virtual` are available (see spec §5.6).
- Phase 0 prototype to reuse: `spikes/phase0/tools/facilis-openapi-ast-fallback.ts` and
  `spikes/phase0/server/openapi-facade.ts` (proven with `parseSync`/`transformSync` from
  `rolldown/utils`).
- The AST pass only sees **object literals**. When `dbTables`/`permission`/`description` are not
  statically resolvable, emit a `ManifestWarning` (`code: "meta-not-static"`) instead of guessing,
  and also surface it through `/_openapi.json` as an `x-facilis-warning`.
- Route-file edits must invalidate the virtual module (Vite `server.watcher` + `moduleGraph`),
  so HMR keeps the spec fresh (SPEC §6.9 consequence).

Integration wiring (confirmed with the Lead while writing the Phase 1 example app):
- virtual modules: `#facilis/config` (project `facilis.config.ts`), `#facilis/db-schema` (project
  `db/schema.ts` namespace), `#facilis/openapi-meta`.
- middleware `facilis-context`: lazily `createDb({ schema })` once per process, then (dev only)
  apply `<config.db.migrationsDir>/*.sql` sorted via `applyStatements` and seed
  `role_permissions` from `seedFromConfig(config.auth)`; expose `event.context.facilis.db`.
  A bootstrap failure is recorded as a manifest warning (manifest stays 200 partial); handlers
  then see no db and return `db_unavailable`.
- middleware `facilis-session` runs after it and calls `@facilis/auth`'s `sessionMiddleware`.

Routes served by the module (dev-only, SPEC §6.1-§6.4, §6.8): `/__facilis/manifest`,
`/__facilis/manifest/revision`, `/__facilis/health`; facade: `/_openapi.json`; Nitro native spec
stays on `/_facilis/openapi.json`. Virtual modules: `#facilis/config`, `#facilis/openapi-meta`.

## 9. Integration (Lead)

- `examples/todo-app` consumes only published package APIs + `@facilis/nitro/vite`; it is the
  Phase 1 acceptance app (SPEC §14.2). Do not create it — the Lead wires it.
- The Lead runs full gates and owns commits/PRs.
