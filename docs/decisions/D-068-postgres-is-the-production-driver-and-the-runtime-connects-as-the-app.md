# D-068 — Postgres is the production driver, and the runtime connects as the app role
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
