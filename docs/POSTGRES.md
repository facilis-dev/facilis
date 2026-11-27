# Running a Facilis app on Postgres

**Status:** implemented (2026-11-01); the release-artifact model follows D-158 (D-204 withdraws the unimplemented D-159 deploy applier).
Decision: **D-068**. Contract: SPEC §5.2, §7.1; [PHASE1-CONTRACTS.md](./archive/PHASE1-CONTRACTS.md) §5;
RLS composition: SPEC §8.4.5 and D-008.

An app runs on **PGlite** (WASM Postgres) inside the browser VM in development and on a **real
Postgres** everywhere else. Both are the same client API, the same Drizzle schema, the same
release artifacts and the same RLS policies — the driver is the only difference.

## 1. Two drivers, one API

    createDb({ driver: "pglite" })                       // dev: in-memory, snapshotted (D-052)
    createDb({ driver: "postgres", url })                // production: pg.Pool

`FacilisDb.db` is a Drizzle pg-core client in both cases, so routes, `runWithPolicyScope`,
`schemaSnapshot` are driver-agnostic. What is **not** shared is the cluster
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
  runtime: { databaseMode: "pglite" }, // "pglite" | "postgres"; "json" is reserved and not implemented
  ...
});
```

Secrets never live in the config. The runtime resolves the target at boot:

| Source | Wins over | Meaning |
|---|---|---|
| `FACILIS_DATABASE_URL` | `runtime.databaseMode` | connect to this Postgres |
| `runtime.databaseMode` | — | `pglite` or `postgres` |

The host's conventional `DATABASE_URL` is **not** read (D-224): a platform that injects it maps
it to `FACILIS_DATABASE_URL` once. One key, one variable.

A URL in the environment always means "this deployment has a real database". A blank value
counts as unset: a hosting panel that defines the variable and leaves it empty must not become
a broken connection string. Two situations are refused instead of degraded:

- **`databaseMode: "pglite"` with `NODE_ENV=production` and no URL** → warning
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

## 4. One-time provisioning

The schema, the role seed and the `facilis_app` grants are applied over the **owner/admin**
connection — never by the runtime, and never on every boot. The release pipeline generates the
immutable schema-diff artifact for each release tag from the declared schema, with no database
access (D-158, `packages/core/src/schema-plan/`); `packages/db/src/schema-digest.ts` computes the
canonical digest of a snapshot. Applying that artifact to a production database is the release
environment's/operator's job: the framework ships no deploy applier — D-204 withdraws the
unimplemented D-159 CLI and ledger. In dev, boot reconciles the live PGlite schema to the declared
one with the same planner on disposable data (D-193/D-201).

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
FACILIS_DATABASE_URL='postgres://facilis_app:<secret>@host:5432/db?sslmode=require' NODE_ENV=production node .output/server/index.mjs
```

TLS comes from the connection string (`sslmode=require`); there is no separate TLS switch to
keep in sync. The pool defaults to 10 connections — `createDb({ poolMax })` overrides it for
a plan with a lower limit.

`pg` is **not** a dependency of `@facilis.dev/db`: it is an optional capability loaded at runtime
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
FACILIS_DATABASE_URL='postgres://facilis_app:...@127.0.0.1:5432/facilis' pnpm dev
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

The whole path is scripted: `pnpm pg:e2e` builds `@facilis.dev/db` and the example for
production, provisions that endpoint through the owner connection, runs
`node .output/server/index.mjs` with `NODE_ENV=production` and `FACILIS_DATABASE_URL`, and asserts
register/login/session/todo over HTTP plus the row landing in the cluster — with no database
server installed.

### 6.1 What one run costs, and how it cleans up

`pnpm pg:e2e` is not a unit test. One run builds four packages (`db`, `core`, `auth`, the
example), boots a PGlite Wasm cluster, a TCP wire server (up to 10 connections) and a
production Nitro server, and keeps them alive for the whole HTTP pass. Three concurrent runs
saturated a shared 16-core dev machine (loadavg 48/99/68, spike 142) and froze the maintainer's
desktop; the orphaned Nitro servers outlived the sessions that started them (issue #153).

The harness now bounds itself:

| Guarantee | Mechanism |
| --- | --- |
| One run per host | `scripts/e2e-lock.mjs`: an atomic `O_EXCL` slot at `$TMPDIR/facilis-pg-e2e.lock` recording the holder's pid, start time and cwd. A second run fails fast naming the holder; a slot whose pid is gone is reclaimed. |
| No orphans, even on SIGKILL | The server runs under `scripts/e2e-watchdog.mjs`, spawned detached so it leads a process group holding the server and every descendant. The harness holds a stdin pipe it never writes to: EOF means the harness died, and the watchdog reaps the group. |
| Signals clean up | `scripts/e2e-process.mjs` handles SIGTERM/SIGINT/SIGHUP: stop the group (SIGTERM, then SIGKILL after a grace period), close the admin pool, the wire server and the cluster, release the slot. `process.on("exit")` still kills the group synchronously. |
| Every phase fails fast | Builds, provisioning, boot, each HTTP request and teardown have their own budget; a timeout kills the whole process group and names the phase. A run deadline backstops the lot. |

Budgets are deliberately above the longest legitimate phase, so a slow machine is not mistaken
for a hang; a timeout is a diagnostic, never a silent pass. Overrides (milliseconds):
`FACILIS_PG_E2E_BUILD_TIMEOUT_MS` (600000 per package), `FACILIS_PG_E2E_PROVISION_TIMEOUT_MS`
(180000), `FACILIS_PG_E2E_BOOT_TIMEOUT_MS` (90000), `FACILIS_PG_E2E_REQUEST_TIMEOUT_MS` (30000),
`FACILIS_PG_E2E_TEARDOWN_TIMEOUT_MS` (20000), `FACILIS_PG_E2E_TIMEOUT_MS` (1500000 overall),
and `FACILIS_E2E_WATCHDOG_GRACE_MS` (10000, the watchdog's SIGTERM-to-SIGKILL grace, kept above
the server's own 5 s graceful close).

Residual edge: SIGKILL of the watchdog *itself* still orphans its server — no in-process
mechanism survives that. The host slot bounds how many such trees can exist; reap them with
the recipe below.

Known gap (pre-existing, unrelated to the lifecycle): the example enables email verification
(D-156) and the harness runs it with `NODE_ENV=production` and no `FACILIS_EMAIL_WEBHOOK_URL`,
so login answers `403 email_unverified` and the last five assertions fail. `origin/main`
behaves identically; fixing it means deciding how an e2e verifies an address in production
mode, which is a separate change.

### 6.2 Safe recipe on a shared machine

```bash
cat /proc/loadavg          # a 16-core box is busy well before 16; pick a quiet moment
pnpm pg:e2e                # one run at a time; the slot refuses a second concurrent run

# Queue for the slot instead of failing (scripts, retries):
FACILIS_PG_E2E_LOCK_WAIT_MS=600000 pnpm pg:e2e
```

Never run `pg:e2e` alongside `pnpm ide:smoke` / `pnpm ide:smoke:multitab`: the browser gates
boot Chromium plus a WebContainer kernel per tab, and the two together are what saturate a
shared host. Run them one after the other.

A SIGKILLed run leaves its slot file behind; the next run reclaims it automatically once the
holder pid is gone. To reap survivors of a killed run (this image may have no `ps`):

```bash
for f in /proc/[0-9]*/cmdline; do
  if tr '\0' ' ' < "$f" 2>/dev/null | grep -q 'output/server/index\.mjs\|e2e-watchdog\.mjs'; then
    pid=${f#/proc/}; pid=${pid%/cmdline}
    echo "reaping $pid"; kill -9 "$pid" 2>/dev/null
  fi
done
```

## 7. Limits

- `snapshot()`/`loadSnapshot` are PGlite-only (dev persistence, D-052).
- `db.mode: "json"` remains a declared-but-unimplemented mode.
- The generated starter's dependency list does not include `pg` yet, so a deployment adds it
  (`pnpm add pg`) until the IDE template ships it (D-062).
