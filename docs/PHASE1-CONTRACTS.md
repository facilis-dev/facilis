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
@facilis/db      -> drizzle-orm, @electric-sql/pglite        (leaf)
@facilis/storage -> node:crypto, node:fs/promises            (leaf, D-053)
@facilis/auth    -> @facilis/db, drizzle-orm
@facilis/core    -> @facilis/auth, @facilis/db, zod
@facilis/nitro   -> @facilis/core, @facilis/auth, @facilis/db, @facilis/storage,
                    nitro, vite, rolldown
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
    facilis?: {
      db: FacilisDb;
      defaultTenantId?: string;
      jobs?: JobsApi; // started jobs runtime, D-107 (absent until/if boot succeeds)
      storage?: StorageApi; // started binary-storage runtime, D-116 (same degrade rule)
    };
  };
  req: { headers: Headers; json?(): Promise<unknown>; formData?(): Promise<FormData> };
  res?: { headers: Headers; status?: number; statusText?: string };
}

// The handler-visible event (D-099): the root client is NOT on it.
export interface FacilisHandlerEvent {
  context: {
    auth?: AuthContext | null;
    facilis?: { defaultTenantId?: string }; // no db
    params?: Record<string, string>;
  };
  req: FacilisRequestEvent["req"];
  res?: FacilisRequestEvent["res"];
}
```

An `H3Event` satisfies this structurally. Middleware order inside Nitro: `facilis-context`
(boots db, sets `context.facilis` — including the started jobs runtime as `facilis.jobs` when
D-107 boot succeeded and the storage runtime as `facilis.storage` when D-116 boot succeeded)
then `facilis-session` (sets `context.auth`, may be `null`).
`defineAuthorizedHandler` takes the full `FacilisRequestEvent`, captures the root client before
running the project handler, and passes a `FacilisHandlerEvent` whose `facilis` carries only
`defaultTenantId` (the job API is `ctx.jobs`, D-107, never the event). A handler therefore
reaches the DB only through `ctx.db` (policy-scoped) and `ctx.sudo`/`ctx.system` (audited
elevation), drives background jobs through `ctx.jobs` (bound to the request's policy
transaction as `bindScope`, D-107), and cannot obtain a policy-free client.
The analyzer warns `route-direct-db` for code that tries (raw `facilis.db`, `createDb`
import).

### 4.2 Postgres GUCs (exact names — policies depend on them)

| GUC | Value | Set by |
|---|---|---|
| `app.tenant_id` | uuid text | `runWithPolicyScope` |
| `app.user_id` | uuid text | `runWithPolicyScope` |
| `app.roles` | JSON array text, e.g. `["admin","manager"]` | `runWithPolicyScope` |
| `app.permissions` | JSON array text, the session's expanded permissions (D-098) | `runWithPolicyScope` |

Every policy that reads a GUC **must** use `nullif(current_setting(<name>, true), '')` before
casting (see SPEC §8.4.5 and the Phase 0 finding: after `RESET` a GUC reads as `''`).

`app.tenant_id` is the deployment's tenant (`FACILIS_TENANT_ID`, else the framework constant),
never the session's: `defineAuthorizedHandler` sets it for anonymous and authenticated requests
alike, `AuthContext` carries no tenant, and a session whose user row belongs to another tenant is
refused (D-040). The same value is the `DEFAULT` of every scoped table's tenant column, so an
insert does not name the tenant either.

### 4.3 RLS composition (Phase 0 finding D-008)

- Tenant isolation: `AS RESTRICTIVE` (permissive clauses are OR-ed, restrictive are AND-ed).
- Owner and role clauses: permissive.
- `ENABLE ROW LEVEL SECURITY` on every scoped table; `getTableConfig().policies` must be non-empty.

### 4.4 Auth + errors

- Session cookie name: `facilis_session`; `HttpOnly`, `Path=/`, `SameSite=Lax`, `Secure` in prod.
- Routes set/clear it with `setSessionCookie(event, sessionId, { ttlMs })` /
  `clearSessionCookie(event)` from `@facilis/nitro/session`, and read it with
  `sessionIdFromRequest(event)`. Those helpers call h3's `setCookie`/`deleteCookie`, which
  stage the header on the event's response — the only surface that survives the in-VM Nitro dev
  path; a `Set-Cookie` on a returned `Response` is dropped (D-038). Never hand-serialise it.
- Response surface inside a handler: response headers go on `event.res?.headers.set(...)`, which
  h3 merges into the final response (`set-cookie` is appended, every other name overrides), and
  `event.res?.status`/`statusText` (typed on the contract) apply when the handler returns plain
  data — a returned `Response` keeps its own status. For everything else h3 provides (redirects, streams, app cookies, `getQuery`, params, …) import it from
  `nitro/h3` in `server/**` code — the documented Nitro re-export, and every project declares
  `nitro` — then narrow the structural event once: `const h3 = event as unknown as H3Event`.
  That is the same single cast `@facilis/nitro/session` does: core's event contract stays
  h3-free (§4.1), so the h3 import lives in the route (or a `server/utils` module), never in
  `src/**` — `nitro/h3` is server-only.
- Error codes: `unauthorized` (401), `forbidden` (403), `invalid_input` (400), `conflict` (409),
  `db_unavailable` (500), `not_found` (404), `internal_error` (500). Export
  `fail(code, details?)` from core returning a web `Response`;
  body is `{ code: string, details?: unknown }` — codes only, no prose.
- Codes in Phase 1: `unauthorized` (401), `forbidden` (403), `invalid_input` (400, `details` =
  flatten of Zod issues), `conflict` (409), `db_unavailable` (500), `not_found` (404),
  `storage_unavailable` (503), `file_too_large` (413), `unsupported_media_type` (415, D-141),
  `too_many_requests` (429, D-143), `internal_error` (500).
- CSRF (D-141): on unsafe methods the wrapper rejects a cross-site request with `403 forbidden`
  before the permission check (`Sec-Fetch-Site` authoritative, `Origin`/`Host` fallback, a missing
  `Origin` means a non-browser client); `body` routes accept only `application/json` and `form`
  routes only `multipart/form-data` (`415 unsupported_media_type`); with `permission: []` a
  `crossSite` route is anonymous, with a permission it is reachable only with a Bearer token
  (D-142); `originCheck: "skip"` is the protocol-only exemption (SAML ACS).
- API clients (D-142): `POST /api/auth/token` is the framework-owned `client_credentials`
  endpoint (`application/json`, `{ grant_type, client_id, client_secret }`) and answers
  `{ access_token, token_type: "Bearer", expires_in }` with `cache-control: no-store`; there is no
  refresh token (renewal is a new grant). Tokens are opaque and stored as hashes; the session
  middleware resolves `Authorization: Bearer` before the cookie, and a service account
  (`users.is_service`) can never log in (`createSession` throws, `validateSession` refuses, SSO
  never links it). A `crossSite` route with a permission declares
  `security: [{ bearerAuth: [] }]` in OpenAPI.
- Token rate limit (D-143): the endpoint counts one exchange per `client_id` in a fixed window
  (`auth.apiClients.rateLimit`, default 60 s / 30 exchanges) before touching the database and
  answers `429 too_many_requests` with `retry-after` when the budget is spent; the blocked
  attempt is audited. The window is in-process and resets on restart. Revocation is per client
  (client + every token it issued, idempotent); there is no per-token revocation.
- `defineAuthorizedHandler` returns a web `Response` for errors (no `h3` import); success values
  are returned as plain data.
- `AuthContext` carries `via?: "session" | "bearer"` so a request can be correlated with the
  credential channel (D-142).
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
export interface CreateDbOptions { driver?: DbDriver; url?: string; dataDir?: string; poolMax?: number; schema?: Readonly<Record<string, unknown>> }
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

export function tenantColumn(name?: string): /* uuid NOT NULL DEFAULT app.tenant_id */; // D-040
export function tenantDefaultSql(): SQL;                        // the same expression, for raw DDL

export function applyStatements(db: FacilisDb, statements: readonly string[]): Promise<void>; // idempotent bootstrap/migration runner
export interface AppRoleProvisioning { readonly systemOnlyTables: readonly string[] }
export function ensureAppRole(db: FacilisDb): Promise<AppRoleProvisioning>; // role + RLS-derived grants (D-136)

export interface SchemaSnapshot { tables: TableSnapshot[] }
export function schemaSnapshot(db: FacilisDb): Promise<SchemaSnapshot>; // drizzle getTableConfig
```

- `createDb()` must work with `@electric-sql/pglite` in-memory (tests) and honour `dataDir`.
- PGlite is loaded from its **CJS build** via `createRequire`, never its ESM build (D-039): the
  ESM build locates `pglite.wasm`/`pglite.data` through `import.meta.url`, which the in-VM
  loader can synthesise from a relative module id — `file://home/…` parses `home` as a URL
  *host*, so the fs read lands in `/user/projects/…` and the database cannot boot. The CJS build
  resolves the same artifacts from `__filename`, an absolute VFS path.
- The runtime converts PGlite's own lookup back to the path it means (D-041): the CJS entry
  builds `new URL("file:" + __filename)` = `file:/home/…`, which **Chromium on Windows** parses
  with `home` as the **host** (`file://home/…`; the parser's WIN32 branch treats that as UNC).
  The pinned kernel's `fileURLToPath` recovers `"/" + host + pathname` instead of throwing
  (`e654919`, kele23/vivari#2), so `@facilis/db` passes PGlite only `dataDir` — no artifact
  hand-off, no shim.
- The `postgres` driver is implemented in Phase 2 (D-068): `pg` + `drizzle-orm/node-postgres`
  loaded lazily through `createRequire` (never a static import - the in-VM bundle must not pull
  `node:net`/`node:tls`), `poolMax` (default 10), TLS from `?sslmode=` in the connection
  string, and a `select 1` probe at open so a bad URL rejects as `db_connection_failed`
  instead of failing on the first request. `snapshot()` rejects with `snapshot_unavailable`.
  `pg` is an optional capability of the package: the deployment installs it.
- The environment chooses the target (D-068): `FACILIS_DATABASE_URL` else `DATABASE_URL` means
  postgres whatever `db.mode` says (blank counts as unset); pglite under `NODE_ENV=production`
  is refused. The runtime connects as the least-privileged `facilis_app` role, so the session
  middleware scopes its lookups with `runWithPolicyScope` and needs no privileged client.
- `runWithPolicyScope` opens a transaction, then in this order: `SET LOCAL ROLE facilis_app`
  (the non-superuser app role - PGlite connects as superuser and superusers bypass RLS even with
  FORCE, Phase 0 finding), then `SET LOCAL`/set_config the three GUCs, then runs the callback.
- `ensureAppRole(db)`: dev bootstrap that creates role `facilis_app` (NOSUPERUSER NOBYPASSRLS
  NOLOGIN NOINHERIT) if missing and reconciles its table privileges with the live schema (D-136):
  a table with RLS gets SELECT/INSERT/UPDATE/DELETE, a table without RLS is revoked (system-only)
  and no table default privilege is installed. Returns the system-only table names. Called by the
  Nitro module after migrations; without it RLS is not enforced in dev. The deploy step runs the
  same function after its migrations (POSTGRES §4).
- `schemaSnapshot` derives tables/columns/FKs/policies from Drizzle `getTableConfig` (SPEC §7.3, §11.1).
- RLS generator output must match the Phase 0 verified SQL (regression: `packages/db/src/rls.test.ts`),
  including the superuser caveat: tests need a non-superuser role via `SET ROLE`.
- `tenantColumn()` (D-040) is the tenant `uuid` column with `DEFAULT tenantDefaultSql()` —
  `nullif(current_setting('app.tenant_id', true), '')::uuid`, the expression the policies read.
  A scoped table declares `tenantId: tenantColumn()`: inserts never name the tenant (Drizzle makes
  a defaulted column optional in its insert type), and RLS still rejects another tenant's row.
  Existing tables get the default with `ALTER TABLE <t> ALTER COLUMN tenant_id SET DEFAULT …`.

## 6. `@facilis/auth` (data-auth)

```ts
export interface AuthContext { userId: string; roles: readonly string[]; permissions: readonly string[];
  sessionHash?: string } // SHA-256 of the session id for the sudo audit (D-099); no tenant (D-040)
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
- `sessionMiddleware` also takes the deployment `tenantId`; a session whose user row names another
  tenant is refused, and the auth context it writes carries no tenant (D-040).

## 7. `@facilis/core` (core-impl)

```ts
export function defineConfig(config: FacilisConfig): FacilisConfig; // validates via Zod, throws on invalid
export const facilisConfigSchema: z.ZodType<FacilisConfig>;          // SPEC §7.1 shape
export type { FacilisStorageConfig, StorageDriverKind } from "./config.ts"; // D-116, SPEC §5.10
export type { StorageApi, StoragePutResult } from "./storage.ts";           // D-116, SPEC §5.10

export interface AuthorizedHandlerConfig<B = void, Q = void, P = void, F = void> {
  permission: string | readonly string[];
  body?: z.ZodType<B>; form?: z.ZodType<F>; // form XOR body (D-116)
  query?: z.ZodType<Q>; params?: z.ZodType<P>;
  dbTables: readonly string[];       // REQUIRED, may be empty
  dbColumns?: readonly string[];      // "table.column"
  description?: string;
}
export interface SudoOptions { operation: string; reason: string; tables: readonly string[] }
export interface SystemOptions extends SudoOptions { actor: `system:${string}` }
export type SudoHandler = <T>(options: SudoOptions, fn: (systemDb: PolicyScopedDatabase) => Promise<T>) => Promise<T>;
export type SystemHandler = <T>(options: SystemOptions, fn: (systemDb: PolicyScopedDatabase) => Promise<T>) => Promise<T>;

export interface AuthorizedHandlerContext<B, Q, P, F = void> {
  auth: AuthContext;          // non-null on privileged routes; nullable with permission: []
  body: B; form: F; query: Q; params: P;
  db: PolicyScopedDatabase;       // policy-scoped, never raw
  sudo: SudoHandler;              // audited elevation, requires a session (D-099)
  system: SystemHandler;          // audited elevation for public/bootstrap routes (D-099)
  storage: StorageApi;            // binary storage, degrades to unavailable (D-116)
  log: FacilisLogger;             // request logger: app lines + audit events (D-119)
  requestId: string;              // correlation id, also on the access/error entries (D-119)
}
export function defineAuthorizedHandler<B, Q, P, F>(
  config: AuthorizedHandlerConfig<B, Q, P, F>,
  handler: (event: FacilisHandlerEvent, ctx: AuthorizedHandlerContext<B, Q, P, F>) => Promise<unknown> | unknown,
): (event: FacilisRequestEvent) => Promise<unknown>;

export function buildManifest(input: BuildManifestInput): FacilisManifest;   // SPEC §7.3
export function summarizeManifest(manifest: FacilisManifest): ManifestSummary; // SPEC §6.1, <500 tokens
export function computeRevision(input: RevisionInput): Promise<string>;      // SHA-1, SPEC §6.5
export function t(key: string, params?: Record<string, string | number>): string; // i18n, flat keys
export function registerCatalog(locale: string, messages: Record<string, string>): void;
```

- `defineAuthorizedHandler` semantics: session → permission → Zod parse → scoped DB → handler.
  It must **not** call `defineRouteMeta` at runtime (it is a Nitro build macro; Phase 0 A16).
  Static metadata extraction is the route-facts adapter over `@facilis/analyze` in `@facilis/nitro`.
- Config validation must cross-check roles/permissions (unknown permission in a role → error),
  and `defaultRole` must exist (SPEC §8.4.1).
- Logging (D-119): the wrapper records one access entry per request exit path and an error entry
  server-side; `ctx.log` adds app lines and audit events. The sink is environment-owned
  (`FACILIS_LOG_SINK`/DIR/MAX_BYTES/KEEP/LEVEL), never an HTTP endpoint; audit is fail-closed
  and the sudo trail is bridged in. `sso` (D-120): `auth.sso.providers` (oidc | oauth2 | saml,
  secrets by env var name only) plus `failureRedirect` and `stateTtlMs`, cross-checked by
  `defineConfig`; the framework owns `/api/auth/sso/**`.
- `storage` (D-116/D-117): every key defaults (`driver: "local"`, `maxUploadBytes` 10 MiB / cap
  100 MiB, `tokenTtlSeconds` 300 / max 24 h, `encryption.enabled` false) and `driver: "s3"`
  requires `bucket` + `region`; secrets stay in `FACILIS_S3_*` / `FACILIS_STORAGE_SECRET`,
  never in the config, and opt-in at-rest encryption reads
  `FACILIS_STORAGE_ENCRYPTION_KEY` / `_KEY_ID` / `_RETIRED_KEYS` (D-117). Byte handling
  streams end to end — `put` takes a byte source and `get` returns one — while the platform
  multipart parser still materializes the uploaded form once, bounded by `maxUploadBytes`.
- `defineAuthorizedHandler` rejects `body` and `form` together; a `form` schema receives the
  multipart fields as a record (`name` → `string | File`, repeated names as arrays) and the
  handler sees the parsed value as `ctx.form` (D-116).
- Manifest types: re-export `SchemaSnapshot`/`TableSnapshot`/... from `@facilis/db` so the public
  surface stays `@facilis/core` (SPEC §5.1). `RouteMeta`, `FacilisManifest`, `ManifestWarning`,
  `ManifestSection`, `ManifestSummary` are declared in core.
- i18n: flat keys, `t("key")` returns the key and records a warning when missing; no throw.

## 8. `@facilis/nitro` (nitro-impl)

```ts
export function facilis(): FacilisPlugins;          // [FacilisVitePlugin, ...Plugin[]]
export const facilisNitroModule: NitroModule;             // plain { name, setup(nitro) }, NOT defineNitroModule
export function scanRouteMetadata(options: ScanOptions): RouteMetadataMap; // sync, { rootDir, onWarning? }
export function mergeOpenApiMetadata(spec: OpenApiDocument, meta: RouteMetadataMap): OpenApiDocument;

// @facilis/nitro/storage (D-116, SPEC §5.10) — separate entry point: core declares the
// StorageApi contract without depending on the Node-only @facilis/storage package, which
// this server runtime implements.
export interface StoredFile { id: string; name: string; mime: string; size: number; url: string }
export function storeUpload(input: {
  event: FacilisHandlerEvent; db: PolicyScopedDatabase; storage: StorageApi;
  auth: AuthContext | null; file: File;
}): Promise<StoredFile | Response>;
export function sendStoredFile(input: {
  db: PolicyScopedDatabase; storage: StorageApi; fileId: string; token: string;
  tenantId?: string; responseName?: string;
}): Promise<Response>;
```

Both helpers stream (D-117): `storeUpload` receives the multipart file after the platform's
`formData()` has materialized the form once (bounded by `maxUploadBytes`) and writes it
through the driver; `sendStoredFile` returns the plaintext as a streamed response body with
`content-length` from the metadata row.

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
- The static pass is `@facilis/analyze`'s route facts (D-092/D-093), not a Nitro-local parser:
  `packages/nitro/src/route-metadata.ts` maps `RouteFact[]` and `packages/nitro/src/rolldown-parser.ts`
  injects `parseSync` from `rolldown/utils`. That adapter must not import
  `@facilis/analyze/node` (oxc-parser): the generated project's Vite config runs inside the
  WebContainer, where only the bundler's oxc is proven to load.
- The facts come from the interpreter, not object-literal regexes: same-file and one-hop
  imported consts resolve; wrapper-less route files are **listed** with `wrapper: invalid`;
  there is no `defineRouteMeta` fallback. A field the interpreter cannot determine stays
  `unresolved` (the facade omits it and adds an `x-facilis-warning`; the manifest warning keeps
  the analyzer's diagnostic code).
- Any project source edit (not just route files) must invalidate the virtual module (Vite
  `server.watcher` + `moduleGraph`): the analyzer reads config and imported consts too
  (SPEC §6.9).

Integration wiring (confirmed with the Lead while writing the Phase 1 example app):
- virtual modules: `#facilis/config` (project `facilis.config.ts`), `#facilis/db-schema` (project
  `db/schema.ts` namespace), `#facilis/openapi-meta`, `#facilis/jobs` (project
  `server/jobs/**/*.ts` as `JobModule[]`, D-107).
- middleware `facilis-context`: lazily `createDb({ schema })` once per process, then (dev only)
  apply `<config.db.migrationsDir>/*.sql` sorted via `applyStatements` and seed
  `role_permissions` from `seedFromConfig(config.auth)`. After the db roles/views setup it
  starts the jobs runtime (`bootJobs`: registry from `#facilis/jobs`, store choice, engine
  `start()`, D-107), carries it in `BootstrapState.jobs` and exposes both
  `event.context.facilis.db` and `event.context.facilis.jobs`. A bootstrap failure is recorded
  as a manifest warning (manifest stays 200 partial); handlers then see no db and return
  `db_unavailable`. Jobs boot degrades instead of failing: an invalid definition, a missing
  `facilis_jobs` table or a failed start is a manifest warning (`job_definition_invalid`,
  `jobs_table_missing`, `jobs_boot_failed`) and `state.jobs` is `null`.
  Storage (D-116/D-117) is resolved right after the config, independently of the database: with
  `config.storage` + the `FACILIS_S3_*`/`FACILIS_STORAGE_SECRET` env it boots the local or S3
  driver, carries a `StorageApi` in `BootstrapState.storage` and exposes
  `event.context.facilis.storage`. With `storage.encryption.enabled` the driver is wrapped by
  `createEncryptedStorage` and the `FACILIS_STORAGE_ENCRYPTION_*` keys are required
  (`storage_encryption_key_missing` / `storage_encryption_key_invalid`, D-117). A production
  local driver, missing S3 credentials, a missing production secret or a constructor failure
  is `storage_local_in_production` / `storage_s3_credentials_missing` /
  `storage_secret_missing` / `storage_boot_failed`, and `state.storage` is `null`, so only
  the file routes fail.
- middleware `facilis-session` runs after it and calls `@facilis/auth`'s `sessionMiddleware`.

Routes served by the module (dev-only, SPEC §6.1-§6.4, §6.8): `/__facilis/manifest`,
`/__facilis/manifest/revision`, `/__facilis/health`; facade: `/_openapi.json`; Nitro native spec
stays on `/_facilis/openapi.json`. Virtual modules: `#facilis/config`, `#facilis/openapi-meta`,
`#facilis/jobs`.

## 9. Integration (Lead)

- `examples/todo-app` consumes only published package APIs + `@facilis/nitro/vite`; it is the
  Phase 1 acceptance app (SPEC §14.2). Do not create it — the Lead wires it.
- The Lead runs full gates and owns commits/PRs.
