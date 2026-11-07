# Facilis todo app (Phase 1 acceptance app)

Hand-written app whose framework, server and data layers use **only** the Facilis public
packages: `@facilis/core`, `@facilis/db`, `@facilis/auth`, `@facilis/nitro`; the UI is a
plain Tailwind CSS v4 + Base UI substrate. It is the Phase 1 exit criterion
(spec §12, §14.2): every route is written with `defineAuthorizedHandler`, RLS policies are
generated from the schema, auth tables and roles come from `facilis.config.ts`, and
`/_openapi.json` carries `x-db-tables` through the framework AST pass.

## Run

```bash
# from the repo root, once:
pnpm install
cd examples/todo-app
FACILIS_INITIAL_ADMIN=admin@example.com PORT=5199 pnpm dev
```

One process: Vite serves the client and mounts Nitro (spec §10.6). Open
`http://localhost:5199`.

> In the sandbox the browser can only reach the `facilis.home` HTTPS vhost, which forwards to
> **port 5173**. Start this example there when you want to try it through the proxy:
> `pnpm exec vite dev --host 0.0.0.0 --port 5173` — the example's `vite.config.ts` allows
> that Host header. The vhost is shared with the IDE dev server, so only one process can own
> 5173 at a time.

> Headless note (this sandbox): Nitro inherits `PORT` (8080 is occupied) and Vite's
> `localhost` binds IPv6 `::1` — probe `http://localhost:5199`, or pass
> `--host 127.0.0.1` to `vite dev` (D-009).

## What to look at

| URL | Shows |
|---|---|
| `/` | Todo UI (register/login, add/toggle/delete todos) |
| `/_openapi.json` | OpenAPI spec with `x-permission`, `x-db-tables`, `x-db-columns` |
| `/_facilis/openapi.json` | Nitro's own spec (internal, for comparison) |
| `/__facilis/manifest` | Full manifest (`?format=summary`, `?sections=...`) |
| `/__facilis/manifest/revision` | Cheap revision poll |
| `/__facilis/health` | Boot detector |

## Demo flow

1. Register `admin@example.com` (set `FACILIS_INITIAL_ADMIN` when starting) → the first
   registration matching that email is granted `admin`.
2. Register a second user → gets the `user` role from `facilis.config.ts`.
3. Each user only sees their own todos: tenant isolation is `AS RESTRICTIVE` and owner
   isolation is permissive, both driven by `app.tenant_id`/`app.user_id`/`app.roles`
   (D-008). Requests run as the non-superuser `facilis_app` role, so PGlite really
   enforces RLS (a superuser would bypass it). The tenant is the deployment's, never the
   session's, and the database fills it from `app.tenant_id` (D-040) — no route names it.

## Background jobs

`server/jobs/purge-completed-todos.ts` is a `defineJob` definition (D-102): Zod
`input`/`output`, the `tables` the sudo audit records, and a `run` body that receives the
**system-scoped** database (`facilis_system`: RLS bypassed, own transaction, audited) even
though the queue itself runs as `facilis_app`. Definitions are loaded through the
`#facilis/jobs` virtual module; an invalid or duplicate one becomes a `job_definition_invalid`
manifest warning and is skipped, never a boot failure. The design reference is
[docs/JOBS.md](../../docs/JOBS.md).

The framework exposes `ctx.jobs` to server code only, so this app puts its own authenticated
surface over it:

| Route | Does |
|---|---|
| `POST /api/jobs` | Enqueue `purge-completed-todos` (`olderThanDays`, optional `runAt` ISO instant) -> `{ id }` |
| `GET /api/jobs/:id` | The serialized `JobRecord` (status, input, attempts, timestamps) |
| `DELETE /api/jobs/:id` | Cancel a queued job or abort a running one -> `{ cancelled: true }` |

The `jobs` section of `facilis.config.ts` shows every key once: `maxConcurrent`,
`maxAttempts`, `retryDelayMs`, `timeoutMs`, `pollIntervalMs`, `persist`. With
`persist: true` the queue lives in `facilis_jobs`, which `db/schema.ts` re-exports from
`@facilis/db`, so `pnpm db:generate` owns its DDL (`0002`: the queue table + its RLS policy).
Queue state survives the dev-server worker reload; a missing table degrades to the in-memory
store with a `jobs_table_missing` manifest warning.

## Layout

```
db/schema.ts             todos + re-exported auth tables and facilis_jobs, RLS policies, enableRLS
db/migrations/           0000: DDL + policies; 0001: tenant defaults + role seed; 0002: facilis_jobs
server/jobs/             defineJob definitions loaded through #facilis/jobs (D-102)
server/routes/api/...    defineAuthorizedHandler only (todos, auth, jobs)
src/main.tsx             bootstrap: theme + i18n + router
src/app.tsx              one explicit route table + session provider + Toaster
src/pages/               one file per route (login, register, todos, not-found)
src/layouts/             project-owned shell (header/nav/session)
src/components/          app-specific controls (theme toggle, locale switch)
src/components/ui/       shadcn-style primitives copied into the project (Base UI)
src/lib/                 api fetch wrapper, session guards, theme, i18n, dates
src/lib/*.test.ts        unit tests for the pure helpers
src/styles.css           Tailwind v4 entry + role tokens (the only stylesheet)
locales/en.json, it.json flat i18n keys, exact parity
facilis.config.ts        roles/permissions/db/i18n (SPEC Appendix B)
scripts/verify-headless.sh   boots the app and asserts the whole Phase 1 contract
```

## Frontend organisation

The client is organized as `pages` (route components, data + view), `layouts` (shells
that know the router and the session), `components` (app-specific pieces) and `lib` (pure
logic: one fetch wrapper, session guards, theme, i18n, dates).

The UI layer is **Tailwind CSS v4 + Base UI**. The shadcn-style primitives live in
`src/components/ui/` and are copied into the project: the app owns them and edits them
directly, so there is no component package to install and no `components.json`. Theme role
tokens (`--background`, `--primary`, the radii, the font) live in `src/styles.css` and
components only name roles, so the `[data-theme="dark"]` block restyles everything.
There is no UI kit package: the components live in the project. Dates go
through `@facilis/time`, never `Date#toLocaleString`, and every user-facing string is a
`t()` key present in both catalogues. The full contract is
[`docs/FRONTEND.md`](../../docs/FRONTEND.md) (D-058).

The UI shows: register → auto-login → todos (create with optional due date, toggle, delete,
overdue badge, toasts), light/dark theme toggle, en/it language switch, empty/loading/error
states, and `/login` redirecting an authenticated session to `/todos`.

## Verify it headlessly

```bash
./scripts/verify-headless.sh     # FACILIS_VERIFY_PORT=5199 by default
```

It checks: health + revision, full manifest with no warnings, `?format=summary` budget
(<2000 chars), ETag/304, invalid `sections` 400, cross-origin 403, `/_openapi.json`
`x-db-tables`/`x-permission`, registration with `FACILIS_INITIAL_ADMIN` -> admin, default
role for a second user, login/session permissions, todo CRUD, RLS isolation (the second user
sees nothing, cross-user DELETE is 404), a future-scheduled job that is enqueued, inspected,
cancelled and observed as `cancelled` without racing the scheduler, input-validation 400s and
anonymous 401.

```bash
# regenerate the DDL after a schema change (db/schema.ts re-exports framework tables too;
# the seed migration 0001_seed_roles.sql is generated from the config):
pnpm db:generate
```
