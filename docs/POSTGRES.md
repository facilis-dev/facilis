# Running a Facilis app on Postgres

**Status:** implemented (2026-11-01); the deploy step follows the accepted D-158/D-159 model.
Decision: **D-068**. Contract: SPEC §5.2, §7.1; [PHASE1-CONTRACTS.md](./PHASE1-CONTRACTS.md) §5;
RLS composition: SPEC §8.4.5 and D-008.

An app runs on **PGlite** (WASM Postgres) inside the browser VM in development and on a **real
Postgres** everywhere else. Both are the same client API, the same Drizzle schema, the same
release artifacts and the same RLS policies — the driver is the only difference.

## 1. Two drivers, one API

    createDb({ driver: "pglite" })                       // dev: in-memory, snapshotted (D-052)
    createDb({ driver: "postgres", url: DATABASE_URL })  // production: pg.Pool

`FacilisDb.db` is a Drizzle pg-core client in both cases, so routes, `runWithPolicyScope`,
the deploy applier and `schemaSnapshot` are driver-agnostic. What is **not** shared is the cluster
dump: `snapshot()` is a PGlite capability and the postgres driver throws
`SnapshotUnavailableError`; the dev snapshotter is only ever installed for PGlite.

The postgres driver loads **`pg` and `drizzle-orm/node-postgres` lazily**
(`createRequire`, the same pattern as PGlite in D-039). The generated project runs server code
inside the WebContainer, where `node:net`/`node:tls` are meaningless: a static import would
pull them into the in-VM bundle for a branch that can never run there.

## 2. Configuration

```ts
// facilis.config.ts
export default defineConfig({
  db: { mode: "pglite" }, // "pglite" | "postgres"; "json" is reserved and not implemented
  ...
});
```

Secrets never live in the config. The runtime resolves the target at boot:

| Source | Wins over | Meaning |
|---|---|---|
| `FACILIS_DATABASE_URL` | `DATABASE_URL`, `db.mode` | connect to this Postgres |
| `DATABASE_URL` | `db.mode` | the host's conventional name (Railway/Render/Neon/Heroku inject it) |
| `db.mode` | — | `pglite` (default) or `postgres` |

A URL in the environment always means "this deployment has a real database". A blank value
counts as unset: a hosting panel that defines the variable and leaves it empty must not become
a broken connection string. Two situations are refused instead of degraded:

- **`db.mode: "pglite"` with `NODE_ENV=production` and no URL** → warning
  `db_pglite_in_production`, no database. Writing a production app to an in-memory cluster
  would look healthy and lose every row on restart.
- **postgres mode without a URL** → warning `db_url_missing`, no database.

The affected requests answer `db_unavailable` (500) and the manifest carries the warning;
boot never crashes (the framework's contract).

## 3. Least privilege: the runtime connects as `facilis_app`

In production the app connects with the **application role** `facilis_app` — `NOSUPERUSER`,
`NOBYPASSRLS` — not as the database owner. Managed Postgres (Neon, Supabase, RDS) cannot even
create a `BYPASSRLS` role, so a privileged runtime would not be portable; and with an
unprivileged connection every query the app makes is RLS-enforced, including the ones written
by mistake.

`runWithPolicyScope` still does `SET LOCAL ROLE facilis_app` before setting
`app.tenant_id`/`app.user_id`/`app.roles`. When the session is already that role the
statement is a no-op; in PGlite (dev) it is what makes the superuser enforce RLS. The session
middleware validates the session **inside a tenant-scoped transaction**, so it no longer needs
a privileged connection to read `users`/`user_roles`.

## 4. One-time provisioning and the deploy step

The schema, the role seed and the `facilis_app` grants are applied by the deploy job, over the
**owner/admin** connection — never by the runtime, and never on every boot. The deploy does not
generate DDL (D-158): it applies the immutable artifacts the release pipeline produced for the
release tags, in order, behind a ledger (D-159). From the project root, with the package installed:

```bash
FACILIS_MIGRATION_DATABASE_URL='postgres://owner:...@host:5432/db?sslmode=require' \
facilis db deploy --release <tag> --backup-ref <ref>
```

- **Ledger.** `_facilis_deploy_runs(release, plan_hash, from_digest, to_digest, status, statements,
  approval_ref, backup_ref, started_at, finished_at)` has one row per applied artifact. The
  database's release is what the ledger says; the pending artifacts are the release tags between
  it and `--release`.
- **Fingerprint preflight.** Before each artifact the deploy checks
  `digest(live) == artifact.fromDigest`; a mismatch is a typed refusal (drift), never a silent
  repair — `facilis db adopt`/`repair` are the explicit one-time operations.
- **Approval and backup.** A destructive artifact needs an approval bound to its `planHash` and an
  environment policy that permits destructive DDL (`destroy: "deny" | "approval" | "allow"`); the
  deploy requires and records `--backup-ref` and **never runs a backup itself**: the backup is the
  release environment's/operator's job, passed as a pointer (D-159).
- **Atomicity and lock.** One transaction per artifact, an advisory lock on the deploy connection
  (a concurrent deploy exits `deploy_locked`), and a post-check `digest(live) == artifact.toDigest`
  that rolls back on mismatch.
- **Post-steps.** After the artifacts: the role seed from `facilis.config.ts`,
  `ensureAppRole(db)`, `ensureSystemRole(db)` and the `db/views/**` definitions. They run in the
  deploy, never in the runtime.
- **No downgrade.** A database ahead of `--release` is refused; restore the backup or ship a
  forward artifact.

**Unknown/legacy database (no ledger, one-time).**

```bash
# Verify digest(live) == declared(v2.0.0) and record the baseline; no DDL.
facilis db adopt --release v2.0.0
# Explicit live -> declared plan with the backup pointer; break-glass only.
facilis db repair --release v2.0.0 --backup-ref <ref> [--allow-destructive]
```

Both are human operations; `--allow-destructive` exists only here (break-glass, never on the
release path) and a repair is recorded as a repair run, never as a release artifact.

`ensureAppRole` **classifies every table by its live RLS state** (D-136): an RLS table gets DML for
the app role, a table without RLS gets none and is system-only, so the runtime can never read it.
The grant list is derived from the catalog, so a table an artifact creates stays closed to the
runtime until its RLS is enabled and the post-step runs. It also removes the table default
privilege, so there is no window in which the table an artifact just created is app-readable.

`ensureSystemRole` creates `facilis_system` (`NOLOGIN NOSUPERUSER BYPASSRLS`) and makes
`facilis_app` a member of it. `CREATE ROLE … BYPASSRLS` is a superuser operation, so this step
needs the owner/superuser connection; a managed host that cannot provision such a role (§3) must
skip it, and the runtime then has no elevation path — `ctx.sudo`/`ctx.system`/`runAsSystem` fail
closed. The membership is what the `NOINHERIT` note below is about.

The role is `NOINHERIT` on purpose: it is a member of `facilis_system` only so the runtime can
`SET ROLE` for the audited sudo (D-099), and membership must not hand the system grants to the
request identity.

Then give the role a login and let the runtime use it:

```sql
ALTER ROLE facilis_app LOGIN PASSWORD '<secret>';
```

```bash
DATABASE_URL='postgres://facilis_app:<secret>@host:5432/db?sslmode=require' NODE_ENV=production node .output/server/index.mjs
```

TLS comes from the connection string (`sslmode=require`); there is no separate TLS switch to
keep in sync. The pool defaults to 10 connections — `createDb({ poolMax })` overrides it for
a plan with a lower limit.

`pg` is **not** a dependency of `@facilis/db`: it is an optional capability loaded at runtime
through `createRequire`, which is what keeps `node:net`/`node:tls` out of the in-VM bundle.
The project that deploys installs it once (`pnpm add pg`). The generated starter does not list
it yet — that is the IDE template's dependency list (D-062), not the driver's job.

A production boot does **not** run DDL or the dev bootstrap. It reports
`db_migrations_skipped` instead, so a forgotten deploy step surfaces as a manifest warning
next to a schema error, not as DDL racing the first request.

## 5. Local development against a real Postgres

Inside the IDE the app always uses PGlite (there is no TCP in the VM). To exercise the
postgres driver in Node:

```bash
DATABASE_URL='postgres://facilis_app:...@127.0.0.1:5432/facilis' pnpm dev
```

The URL wins over `db.mode: "pglite"`, so the same committed config runs in both places. There
is no dev snapshotter or `ensureAppRole` bootstrap for this target — provision it with §4.

## 6. How this is verified

`packages/db/test-fixtures/postgres-server.ts` boots PGlite and exposes it over **TCP with
the real Postgres wire protocol** (`@electric-sql/pglite-socket`), so the tests connect with
`pg` itself and exercise the real driver: pooling, transactions, `SET LOCAL ROLE`, the three
GUCs, restrictive/owner policy composition and the typed connection error.

What that harness cannot prove: password authentication, TLS and the network path — the socket
server ignores the connecting user (every session is `postgres`) and is loopback-only. Those
belong to the hosting provider; the wire behaviour and the SQL semantics are real.

The whole path is scripted: `pnpm pg:e2e` builds `@facilis/db` and the example for
production, provisions that endpoint through the owner connection, runs
`node .output/server/index.mjs` with `NODE_ENV=production` and `DATABASE_URL`, and asserts
register/login/session/todo over HTTP plus the row landing in the cluster — with no database
server installed.

## 7. Limits

- `snapshot()`/`loadSnapshot` are PGlite-only (dev persistence, D-052).
- `db.mode: "json"` remains a declared-but-unimplemented mode.
- The deploy CLI (`facilis db deploy/status/adopt/repair`) is specified in
  [MIGRATION-PLAN.md](./MIGRATION-PLAN.md) §2.3-§2.4; drizzle-kit migrates nothing at deploy time
  (D-159).
- The generated starter's dependency list does not include `pg` yet, so a deployment adds it
  (`pnpm add pg`) until the IDE template ships it (D-062).
