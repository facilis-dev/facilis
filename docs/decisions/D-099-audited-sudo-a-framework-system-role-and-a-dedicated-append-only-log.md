# D-099 — Audited sudo: a framework system role and a dedicated append-only log
**Status:** accepted (2026-11-07)

The user needs server-side operations with global DB permissions when the caller's permissions
must stay narrower (a user reads a resource, the API creates a derived record with a system
identity), and wants every such access traced with the user session. A database audit table was
explicitly rejected: it disappears exactly when the transaction rolls back, and the user does not
want audit rows in the DB. The log pipeline/retention was deliberately left for later ("an easy
`console.log` for now").

**Decision.** A framework Postgres role `facilis_system` (`NOLOGIN NOSUPERUSER BYPASSRLS`, DML
grants only, no DDL, never assigned to users, never referenced by a policy) is provisioned by the
dev boot (`ensureSystemRole`, after `ensureAppRole`) or the deploy step;
`GRANT facilis_system TO facilis_app` lets the production connection `SET ROLE`.
`ctx.sudo({ operation, reason, tables }, fn)` is on authorized handlers: it validates the call
(non-empty strings, `tables` a non-empty subset of the route's `dbTables`, no nesting, **a
session is required** — jobs use `runAsSystem`), appends a `started` audit entry (fail closed: an
unwritable sink refuses the escalation), runs `fn` inside a SAVEPOINT as `facilis_system` with
`app.sudo_id`, restores `SET LOCAL ROLE facilis_app` on success (never `RESET ROLE`, which would
return to the dev superuser), and appends `succeeded`/`failed` (`errorCode:
handler_failed`, never the internal message). `runAsSystem({ actor: "system:<job>", ... })` is
the job/CLI counterpart with its own transaction and the same sink.

The trail is a dedicated append-only log, not a table: one JSON line per event on stdout
(`facilis:sudo {…}`, the default sink, replaceable with `setSudoAuditSink`), carrying id,
timestamp, event, actor (`user:<id>`/`system:<job>`), actorUserId, sessionHash (SHA-256 of the
session id, never the raw cookie), roles, tenant, route/method, the route's declared permission,
operation, reason, tables, request id, outcome, error code and duration. `writeSudoAudit` has no
update/delete counterpart. The session hash comes from `sessionMiddleware` via WebCrypto (the
auth package stays runtime-agnostic).

**Rejected alternatives.** *A raw superuser client handed to handlers*: impossible in production
(the connection is `facilis_app`) and unauditable. *Impersonating the admin app role*
(`app.roles += 'admin'`): insufficient for owner/cross-tenant writes, leaves no trail, and
silently changes what "admin" means. *A `SECURITY DEFINER` function per operation*: more DDL, no
session/request metadata, the function body becomes the permission surface. *A `sudo_audit`
table*: the trail must survive the rollback it describes; also rejected by the user. *Per-row
provenance column*: not wanted now; the log id (and `app.sudo_id` inside the block) is enough.

**Consequences.** SPEC §8.4.5 gets one named exception to "no Postgres roles" (§5.2/§8.6 too).
Sudo requires a session; jobs use `runAsSystem`. The audit is started/outcome only: the
commit/rollback of the enclosing request transaction and a hash-chained file/WORM sink are not
implemented (O-014); definer-view reads are not logged per query (O-015). An analyzer fact for
sudo call sites and the validator rule are follow-ups, as is the AST check that `tables` is a
subset of `dbTables` (the runtime check exists today).

**Verification.** `@facilis.dev/db` 17 files / 127 tests (role attributes and membership, BYPASSRLS
read/write inside the block, role restored + GUC cleared, savepoint rollback on throw,
`runAsSystem` audit ids, fail-closed sink; Postgres-wire GUC assertions in the policy test).
`@facilis.dev/core` 13 files / 100 tests (`ctx.sudo` success/failure, audit transitions, validation,
no nesting, session required, subset of `dbTables`). `@facilis.dev/auth` 6 files / 41 tests
(`sessionHash`). `@facilis.dev/nitro` 20 files / 143 tests (system-role boot warning, dev-view
permission). IDE 83 files / 654 tests; root lint/typecheck/test/build, file-length and theme
green.

**Follow-up (2026-11-07): the request DB is bounded; public routes use `ctx.system`.** The
handler event is now `FacilisHandlerEvent`: `defineAuthorizedHandler` captures the root client
and passes a copy whose `facilis` carries only `defaultTenantId`, so `ctx.db` (policy-scoped)
is the only default DB surface and any further operation goes through `ctx.sudo`/`ctx.system`.
Public or bootstrap routes with no session (registration, initial admin) got
`ctx.system({ actor: "system:<job>", operation, reason, tables }, fn)`: the same
SAVEPOINT/role/audit flow, no session, system actor recorded (no user/session hash), a shared
nesting guard with sudo. The example's registration keeps the duplicate-email read on `ctx.db`
and performs the user/default-role/initial-admin writes inside one `ctx.system` call
(`system:auth`, `user:register`). The analyzer adds a `route-direct-db` warning when route code
reaches for the raw client (raw `facilis.db` or a `createDb` import), so the direct policy-free
path is visible in the manifest and explicitly "not recommended". Verification: `@facilis.dev/core`
14 files / **109 tests** (system elevation, shared nesting, handler event without `db`),
`@facilis.dev/analyze` 10 files / **71 tests** (direct-db warning), example 5 files / 33 tests,
template consumers typecheck; the full root gates stay green.
