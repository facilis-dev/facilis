# D-136 — Every table is RLS-scoped or system-only: RLS is the app-role grant boundary
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
