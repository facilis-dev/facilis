# D-014 — RLS enforcement identity, auth lookups and role policies
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
