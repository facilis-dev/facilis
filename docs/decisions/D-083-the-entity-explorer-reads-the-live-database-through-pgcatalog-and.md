# D-083 — The Entity Explorer reads the live database through pg_catalog and diffs it against `db/schema.ts`
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
