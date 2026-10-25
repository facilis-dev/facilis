# Facilis todo app (Phase 1 acceptance app)

Hand-written app that uses **only** the Facilis public packages: `@facilis/core`,
`@facilis/db`, `@facilis/auth`, `@facilis/nitro`. It is the Phase 1 exit criterion
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
   enforces RLS (a superuser would bypass it).

## Layout

```
db/schema.ts             todos + re-exported auth tables, RLS policies, enableRLS
db/migrations/           0000: drizzle-kit DDL + policies; 0001: role seed from the config
server/routes/api/...    defineAuthorizedHandler only
server/utils/            cookie + tenant helpers
src/                     React client
locales/en.json          flat i18n keys
facilis.config.ts        roles/permissions/db/i18n (SPEC Appendix B)
scripts/verify-headless.sh   boots the app and asserts the whole Phase 1 contract
```

## Verify it headlessly

```bash
./scripts/verify-headless.sh     # FACILIS_VERIFY_PORT=5199 by default
```

It checks: health + revision, full manifest with no warnings, `?format=summary` budget
(<2000 chars), ETag/304, invalid `sections` 400, cross-origin 403, `/_openapi.json`
`x-db-tables`/`x-permission`, registration with `FACILIS_INITIAL_ADMIN` -> admin, default
role for a second user, login/session permissions, todo CRUD, RLS isolation (the second user
sees nothing, cross-user DELETE is 404), input-validation 400s and anonymous 401.

```bash
# regenerate the DDL after a schema change (the seed migration is generated from the config):
pnpm db:generate
```
