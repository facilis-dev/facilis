# Access escalation v2: permission views and audited sudo

**Status:** accepted and implemented (2026-11-07) as **D-098** (views) and **D-099** (sudo).
This document is the design record; §0 records the implementation deviations and the follow-ups
(O-014 audit pipeline, O-015 definer-view read auditing).

Decisions from the user:

- **Views.** `permission` is optional. A view **without** it keeps D-097's behaviour
  (`security_invoker = true`, base tables' permissions). A view **with** it treats that
  permission as the view's own permission: the underlying tables are not consulted
  (`security_invoker = false`). Views are full read-only SQL, not a restricted DSL. The
  developer owns the trade-off; a view is a resource like a table.
- **Sudo.** The audit trail is a **dedicated, append-only, immutable log**, not a database
  table. The goal is that any server-side DB access beyond the user's own permissions is
  recorded together with the user session that caused it.
- **Sudo API.** `ctx.sudo({ operation, reason, tables }, fn)`, explained in §3 and implemented
  as described there; a session is required (jobs use `runAsSystem`).

---

## 0. Implementation status (2026-11-07)

Implemented as specified, with four deliberate deviations:

- **Console selector instead of invoker-only.** The Create-view dialog offers the permissions
  declared in `facilis.config.ts`; the endpoint validates them (`invalid_permission`) and the
  generated file keeps `permission`.
- **Audit sink is `console.log`.** One JSON line per event (`facilis:sudo {…}`) on stdout, the
  default of an injectable sink (`setSudoAuditSink`). No file/env sink, hash chain or
  `verifyAuditLog` yet: the log pipeline/retention is **O-014**.
- **Started + succeeded/failed only.** The `committed`/`rolled_back` entries after the enclosing
  request transaction (design §3.3 step 6) are not implemented; they belong to O-014. The
  started entry is written before the role switch, so a crash or a rollback still leaves a trace.
- **Sudo requires a session; public routes use `ctx.system`.** Anonymous callers are refused
  with `401` before the audit/role switch. Public/bootstrap routes that legitimately have no
  session (registration, initial admin) use `ctx.system({ actor: "system:<job>", … })` — the same
  audited flow with the system actor recorded and no user/session hash; jobs and seeds use
  `runAsSystem`.
- **The handler DB is bounded.** The handler receives a `FacilisHandlerEvent` whose
  `facilis` carries only `defaultTenantId`: the root client is captured by the wrapper and is
  not reachable from the handler. `ctx.db` is policy-scoped; escalation is only
  `ctx.sudo`/`ctx.system`. The analyzer warns `route-direct-db` for code that tries the raw
  client (`facilis.db`, `createDb`), making the not-recommended path visible.

Also as implemented: `AuthContext.sessionHash` (SHA-256 hex, WebCrypto, never the cookie),
`app.sudo_id` set for the duration of the block, no DB audit table and no provenance column.
The example's registration does the duplicate read on `ctx.db` and the writes through
`ctx.system`. The view metadata exposes `permission`/`access` for the manifest; the analyzer
still has no view facts or sudo call-site facts (O-013/O-014 follow-ups), but it does emit the
`route-direct-db` warning.

---

## 1. Current guarantees

| Layer | Today | Where |
|---|---|---|
| Route RBAC | every route declares `permission`; checked before the handler | `packages/core/src/route.ts:143` |
| Policy scope | one transaction, `SET LOCAL ROLE facilis_app`, `app.tenant_id/user_id/roles` via `set_config` | `packages/db/src/policy.ts:69` |
| RLS | tenant isolation RESTRICTIVE; owner/role policies permissive | `packages/db/src/rls.ts` |
| Views | always `security_invoker = true`, granted to `facilis_app` | `packages/db/src/views.ts:160` |
| Roles | app roles are never Postgres roles; policies read `app.roles` | SPEC §8.4.5 |

Production connects as `facilis_app`; dev/PGlite connects as a superuser and still switches
to `facilis_app` for routes. The sudo design builds on exactly that difference.

---

## 2. Views with their own permission (D-098)

### 2.1 Two modes, one switch

```ts
// No permission: exactly D-097.
export const myTodos = defineView({
  name: "my_todos",
  columns: { id: uuid(), title: text() },
  query: sql`select id, title from todos`, // runs as facilis_app, RLS of todos applies
  tables: ["todos"],
});

// With permission: the view is a resource with its own permission.
export const todoStats = defineView({
  name: "todo_stats",
  columns: { total: integer() },
  query: sql`select count(*)::int as total from todos`,
  permission: "stats:read",
});
```

| `permission` | `security_invoker` | rows come from | granted to |
|---|---|---|---|
| absent | `true` | base tables' RLS, as `facilis_app` | `facilis_app` |
| present | `false` | view owner (bypasses base RLS) | `facilis_app`, gated by permission |

The second row is the user's decision: "those are the view's permissions, the underlying
tables are not checked". It is a definer view, so the permission predicate is the only
authorization the view itself enforces. The route's `permission` remains the primary check;
the view gate is defense in depth (and, stated honestly, only against mistakes — see §2.4).

### 2.2 SQL shape

`viewDefinitionStatement` emits the invoker form unchanged. For a permission view it emits:

```sql
create or replace view "todo_stats" with (security_invoker = false) as
select * from (select count(*)::int as total from todos) as "q"
where nullif(current_setting('app.permissions', true), '')::jsonb ? 'stats:read'
```

The outer wrapper is what makes the permission apply to any query shape. The permission name is
validated (`^[a-z][a-z0-9:_-]{0,63}$`) and must exist in `facilis.config.ts`'s
`auth.permissions`; a view with an undeclared permission is a boot warning
(`view_failed`), not a silent grant. `runWithPolicyScope` gains `permissions` in
`PolicyScope` and sets `app.permissions` beside the existing GUCs; a view without
`permission` never reads it.

The query itself is still validated by the D-097 rules: one static read-only statement
(SELECT/WITH/VALUES/TABLE), no interpolation, no semicolon tricks. "Full SQL" means full
read-only SQL, not "any DDL".

### 2.3 Creation and review

- **Code**: `db/views/<name>.ts`, one file per view, as today.
- **Console**: the Create-view dialog offers a selector with the permissions declared in
  `facilis.config.ts` (default: none, i.e. the D-097 invoker view). The endpoint validates the
  choice (`invalid_permission`) and the generated `db/views/<name>.ts` keeps `permission`; the
  decision is still in the diff because the file is project code written through the kernel.
- **Manifest/analyzer**: `ViewMetadata` gains `permission` and `access`; the manifest lists
  them, the release preview flags "adds a permission view", and the AI validator can require
  `permission` to be a declared literal. O-013 still owns the route↔view reverse lookup
  (route using a permission view must declare that permission); until then the DB gate is the
  runtime check that exists.
- **Production**: same deploy-time provisioning as D-097. The deploy role owns the view
  (needed for definer semantics); `GRANT SELECT ... TO facilis_app` unchanged.

### 2.4 What the permission gate is and is not

`app.permissions` is a custom GUC; any role can `set_config` it. So the gate catches:

- a route that forgot to declare the permission (zero rows instead of a silent leak),
- a view read from a context that never had the permission,
- a copy/paste of the view into a route without the corresponding declaration.

It does **not** stop code that deliberately forges the GUC. The boundary remains route RBAC,
the definer view's SQL, and code review. A permission view is a trade-off the user explicitly
accepted: it is a table-like resource, and the developer writing it is responsible for what it
exposes. The release preview/validator flag exists to make that responsibility visible.

No column verification for raw SQL: the declared `columns` are Drizzle type metadata, the
query decides the real result set. This matches D-097 and avoids pretending to parse SQL.

### 2.5 Rejected alternatives (unchanged)

- Postgres role per app role/permission (violates SPEC §8.4.5, policies read GUCs).
- Column-level grants (does not help cross-RLS aggregates; `ensureAppRole` grants whole tables).
- A restricted aggregate/projection DSL: less useful than full SQL for this project's taste.
- Materialised views: refresh lifecycle, separate design.

---

## 3. Sudo (D-099)

### 3.1 The model in one paragraph

A sudo call is **not** a second request, a separate connection, or a login as someone else. It
is a block of server code, inside the current request and the current transaction, during which
the same database transaction runs as `facilis_system` (a framework Postgres role with
`BYPASSRLS` and DML grants, no DDL, no login). The user session is the actor: the log records
`userId`, a hash of the session id, roles, route and permission, operation, reason, tables and
outcome. The log is written **before** the role switch (so an escalation cannot happen without
a trace) and updated **after** the block, to a dedicated append-only sink outside the database.
The route's own permission check is unchanged; sudo is for operations the business rule
requires but the user's permissions/RLS must not allow directly.

### 3.2 API and example

The handler context gains `sudo`. The callback receives the elevated DB client:

```ts
// server/routes/api/order-requests/index.post.ts
import { z } from "zod";
import { defineAuthorizedHandler } from "@facilis.dev/core";
import { orderRequests } from "~/db/schema";

export default defineAuthorizedHandler(
  {
    // The user's real permission: they may read orders, not write order_requests.
    permission: "orders:read",
    body: z.object({ orderId: z.uuid(), note: z.string().max(500).optional() }),
    dbTables: ["order_requests"],
    description: "A user asks the system to create an order request.",
  },
  async (_event, { auth, body, sudo }) => {
    return sudo(
      {
        operation: "order-request:create",
        reason: "Users may request an order but cannot write order_requests directly.",
        tables: ["order_requests"],
      },
      async (systemDb) => {
        const [row] = await systemDb
          .insert(orderRequests)
          .values({ orderId: body.orderId, requestedBy: auth.userId, note: body.note ?? null })
          .returning();
        return row;
      },
    );
  },
);
```

What the developer sees:

- `sudo(opts, fn)` returns exactly what `fn` returns (typed, awaited).
- `systemDb` is a Drizzle client for the **same transaction**, with the system identity. It is
  a distinct object, so the normal `ctx.db` cannot be used by mistake inside the block.
- Errors from `fn` propagate. The escalated block sits in a SAVEPOINT, so its writes roll
  back independently; the route may map the error (e.g. unique violation → 409) or let it
  bubble and roll the whole request back.
- The audit log is invisible to the handler: appending happens inside `sudo`; the developer
  cannot turn it off, edit it or write it by hand.
- Works the same in a job/CLI context through `runAsSystem({ actor: "system:<job>", ... })`,
  where the actor is the system label instead of a user session.

What it is not: not a way to run arbitrary SQL from user input (the callback is code), not a
read path for the UI (use a view), not a permission bypass (the route still needs its
`permission`), not DDL (the role has no schema grants).

### 3.3 Execution sequence

1. Validate the call: `operation` and `reason` are non-empty strings, `tables` non-empty and
   a subset of the route's `dbTables`, no nested sudo.
2. Append the **started** audit entry (actor, session hash, route, operation, reason, tables,
   request id, id). If the sink is unwritable, throw `sudo_audit_unavailable` and stop — no
   untraced escalation.
3. Open a nested transaction (SAVEPOINT), `SET LOCAL ROLE facilis_system`, set
   `app.sudo_id` to the audit id, run `fn`.
4. On success: `SET LOCAL ROLE facilis_app` (explicitly; `RESET ROLE` would return to the
   session user, a superuser in dev), append **succeeded**, release the savepoint, return.
5. On error: the savepoint rollback restores the role; append **failed** with the canonical
   error code, rethrow.
6. Deferred to O-014: after the request transaction resolves, append **committed** or
   **rolled_back** for the sudo ids seen, so the log distinguishes "executed" from "persisted".
   The current implementation logs `started` + `succeeded`/`failed` only.

The implemented audit entries have `id` (shared), `at`, `event`, `actor`
(`actorUserId`, `sessionHash`, `roles`, `tenantId`), `route`, `method`, `permission`,
`operation`, `reason`, `tables`, `requestId`, `outcome`, `errorCode`, `durationMs`. The raw
session cookie is never logged — only its SHA-256, so the log cannot be used to impersonate a
session but can still correlate a request with a session. A `seq`/`prev`/`hash` chain is part
of O-014.

### 3.4 The log: dedicated and append-only

- **Sink as implemented**: the default sink is one line per event on stdout,
  `console.log("facilis:sudo " + JSON.stringify(event))`, injectable through
  `setSudoAuditSink` (tests/tooling). A deploy can ship stdout to its log platform. No file,
  env-selected or WORM sink yet — that is O-014. (The earlier design proposed
  `.facilis/audit/sudo.jsonl` in dev and a hash chain; both are deferred with the pipeline.)
- **Append-only**: the framework has no update or delete operation for the trail; every call
  appends. The device-level immutability (hash chain, HMAC key, external WORM retention) is
  O-014; today the guarantee is "never rewritten by the framework", not "tamper-proof on the
  host".
- **Fail closed**: a sink that throws aborts the sudo before the role switch.
- **No DB audit table**, per the decision. No provenance column either; `app.sudo_id` is set
  inside the block if a future opt-in correlation is wanted.

### 3.5 Transaction semantics

The log is outside the transaction, so:

- a failed sudo is always logged (even though its data rolled back);
- a successful sudo whose enclosing transaction later aborts is logged as `succeeded` +
  `rolled_back`: the operation was executed, the data did not persist;
- a crash between the entries leaves an incomplete chain of `id`s, which is itself a signal.

This is the reason the log, and not a table, is the right primitive for "tracciare": the trail
must survive the rollback it describes.

### 3.6 Guardrails

- `operation`, `reason`: AST literal strings (analyzer/validator rule), never user input.
- `tables`: subset of the route's `dbTables` (runtime + analyzer); `dbTables` stays accurate.
- No nesting; a second `sudo` inside the callback throws.
- **A session is required**: an anonymous/public route gets `401` before any audit entry or
  role switch; jobs and seeds use `runAsSystem` instead.
- The system role is never assigned to users, never used in policies, and only reachable
  through the wrappers. SPEC §8.4.5's "no Postgres roles" rule gets one named exception.
- **Fail closed**: if the audit sink is not writable/configured, sudo refuses to run. A
  production boot without a sink logs a warning and every sudo call throws
  `sudo_audit_unavailable`.
- The role and the sink are provisioned by the deploy step (like migrations/views); the
  runtime may connect as `facilis_app` and cannot create roles.

### 3.7 Not covered by this change

- **Definer-view reads are not logged per query.** A permission view is a table-like resource:
  authorization is the permission, not an audit event. Logging every read would need a
  per-query hook the DB does not give us for free. If read provenance is required later, the
  options are an explicit `logViewAccess()` helper in the route or a Postgres
  `pgaudit`/log-statement policy — a separate decision.
- **No DB audit table**, as decided.
- **No user-facing sudo**: it exists in server code only; the audit log is an operator artifact.

---

## 4. Decisions resolved

1. **Console Create-view**: permission selector populated from the config, server-validated.
2. **Audit sink**: stdout `console.log` line for now; the env/file/WORM pipeline, hash chain
   and `committed`/`rolled_back` events are O-014.
3. **Sudo read scope**: allowed; the log covers the whole block.
4. **Provenance**: no `sudoStamp()` column; the log id and `app.sudo_id` are the handles.
5. **Jobs**: `runAsSystem` ships for cron/seed.
6. **Definer-view read auditing**: not implemented (O-015).

## 5. Verification (2026-11-07)

Views — `@facilis.dev/db` 17 files / **127 tests**, including the 8 permission-view tests: invoker
unchanged; a definer permission view returns cross-owner aggregates through `facilis_app`; zero
rows without `app.permissions`, rows with it; invalid and undeclared permissions fail as data;
the existing plain-view leak test still proves the invoker rule. `@facilis.dev/nitro` 20 files / 143
tests (endpoint accepts a declared permission, 400 `invalid_permission` otherwise, boot
validation). IDE 83 files / **654 tests** (selector, exact codegen with/without `permission`,
client payload).

Sudo — `@facilis.dev/db` 8 sudo tests + 4 audit tests; `@facilis.dev/core` 14 files / **109 tests**
(8 `ctx.sudo`, 8 `ctx.system`, handler-event safety): role attributes and app-role membership;
an insert the app role cannot perform succeeds inside the block; after the call the identity is
`facilis_app` again; savepoint rollback on throw undoes only the elevated block; audit
`started`→`succeeded`/`failed` with actor, session hash, roles, tenant, route, method,
permission, operation, reason, tables, request id; fail-closed when the sink throws; session
required for sudo (401, no audit, no role switch); `ctx.system` works with no session and
records the `system:<job>` actor; shared nesting guard across both; handler event carries no
`facilis.db` while `ctx.db` is the real request transaction; tables outside `dbTables`
rejected; `sessionHash` in the auth test; `runAsSystem` audit ids. `@facilis.dev/auth` 6 files /
41 tests. Example: 5 files / 33 tests (registration read on `ctx.db`, writes through
`ctx.system`), template contract assertions updated. Analyzer: 10 files / **71 tests**, including
the `route-direct-db` warning for raw `facilis.db`/`createDb` use.

Root gates: lint 0 errors (212 pre-existing warnings), typecheck 19/19 tasks, test 19/19, build
12/12, file-length 675 files, theme OK. Browser smoke was **not** re-run for this change: the
Studio diff is limited to the Create-view dialog/client/codegen (unit-tested) and the existing
D-097 smoke flow is unchanged; the next full `pnpm ide:smoke` covers it.
