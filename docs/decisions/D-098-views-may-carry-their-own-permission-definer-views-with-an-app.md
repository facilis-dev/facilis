# D-098 — Views may carry their own permission: definer views with an `app.permissions` gate
**Status:** accepted (2026-11-07)

The user asked for views with dedicated permissions: most should follow the base tables (D-097),
but some must be reachable without access to the underlying rows (statistics, projections, a
"public" projection of a restricted table). D-097 made `security_invoker = true` mandatory, which
is the safe default but cannot express that, and the user accepted the trade-off: a view is a
table-like resource, the developer owns what its SQL exposes.

**Decision.** `permission` is an optional field of `defineView`. Absent: D-097 unchanged
(`security_invoker = true`, base tables' RLS/grants). Present: the framework creates the view
`WITH (security_invoker = false)` and wraps the query as `select * from (<query>) as "q" where
nullif(current_setting('app.permissions', true), '')::jsonb ? '<permission>'`; that permission
alone gates access and the base tables are not consulted. The permission must match the
identifier pattern and be declared in `facilis.config.ts`; `applyViews` reports an undeclared
one as a `view_failed` warning (boot stays up), the dev endpoint answers 400
`invalid_permission`, and `PolicyScope.permissions` travels in `app.permissions` beside the
other GUCs. Views remain full read-only SQL (the D-097 static single-statement rule), not a DSL.
The Create-view dialog offers the declared permissions (a selector) and the generated
`db/views/<name>.ts` keeps the choice; the console request is validated against the config
server-side.

**Why this shape.** A permission view behaves like a table with its own permission. The gate is
defense-in-depth (it survives a route that forgot its `permission`, or a context that never had
it) but not a boundary against deliberately hostile code: `app.permissions` is a custom GUC any
role can set. Primary authorization stays route RBAC; the definer ownership is what makes the
mode work, and the SQL is the developer's responsibility.

**Rejected alternatives.** *One Postgres role per app role/permission*: app roles are not
Postgres roles, policies read GUCs, and it multiplies roles (SPEC §8.4.5). *A restricted
aggregate/projection DSL*: less useful than full read-only SQL, and the user chose full SQL.
*Column-level grants*: the model grants whole tables and it does not solve cross-RLS aggregates.
*Keeping every view invoker-only*: cannot express statistics without the underlying data.
*Materialised views*: refresh lifecycle, a separate design.

**Consequences.** `ViewMetadata.permission/access` is exposed for the manifest; `createLiveView`
and `POST /__facilis/dev/view` take an optional permission; `applyViews(db, modules,
{ permissions })` validates it at boot. The analyzer's route↔view reverse lookup (O-013) will
check that a route using a permission view declares that permission; until then the DB gate is
the runtime check. Definer views bypass RLS by design: the release preview and the AI validator
should flag new ones (follow-up). Selector strings are i18n keys in the Studio.

**Verification.** `@facilis.dev/db` 17 files / 127 tests (8 permission-view tests: definer returns
cross-owner aggregates through `facilis_app`, zero rows without `app.permissions`, rows with it,
invoker unchanged, invalid/undeclared permission as data; the existing RLS leak/enforcement
tests stay green). `@facilis.dev/nitro` 20 files / 143 tests (endpoint accepts a declared permission,
400 `invalid_permission` otherwise, boot validation). IDE 83 files / 654 tests (selector,
codegen exact file with/without `permission`, client payload). Root `lint` (0 errors, 212
warnings), `typecheck` (19 tasks), `test` (19 tasks), `build` (12 tasks), file-length (674 files,
limit 300) and theme gates green.
