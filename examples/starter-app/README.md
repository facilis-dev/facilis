# Facilis starter app

The empty full-stack template the Facilis IDE scaffolds: standard login management on
`@facilis.dev/core`, `@facilis.dev/db`, `@facilis.dev/auth` and `@facilis.dev/nitro`, with a plain
Tailwind CSS v4 + Base UI client. Everything else — routes, tables, features — is for the app
to add, so this example deliberately stays at the authentication surface.

## Run

```bash
# from the repo root, once:
pnpm install
cd examples/starter-app
pnpm dev
```

One process: Vite serves the client and mounts Nitro on the same origin (spec §10.6). Without
`FACILIS_DATABASE_URL`/`DATABASE_URL` the runtime uses in-memory PGlite and applies
`db/migrations` at boot.

## What it ships

| Surface | Detail |
|---|---|
| Routes | `/` (authenticated dashboard), `/login`, `/register`, catch-all 404 |
| API | `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/register`, `GET /api/auth/session` |
| Tables | `users`, `sessions`, `user_roles`, `roles`, `role_permissions` (RLS on the app-reachable ones) |
| Roles | `admin` (`*`) and `user` (the registration default), from `facilis.config.ts` |

Registration is public and does not start a session; the client logs in right after it.
The bootstrap admin (`FACILIS_INITIAL_ADMIN` + `FACILIS_INITIAL_ADMIN_TOKEN`) claims the
`admin` role through the optional `bootstrapToken` registration field (D-150).

## Structure

```
server/routes/api/auth/  login, logout, register, session handlers
db/schema.ts             the auth tables the project owns the DDL for
db/migrations/           committed SQL applied at boot; db:generate updates it from the schema
src/app.tsx              explicit route table + session provider + Toaster
src/pages/               one file per route (login, register, dashboard, not-found)
src/layouts/             project-owned shells (app header, split auth panel)
src/components/          theme toggle, locale switch, copied shadcn-style ui primitives
src/lib/                 api fetch wrapper, session guards, theme, i18n
locales/en.json, it.json flat i18n keys, exact parity
facilis.config.ts        roles/permissions/db/i18n/logging (SPEC Appendix B)
```

After editing `db/schema.ts`, run `pnpm db:generate` and review the SQL it appends to
`db/migrations` (drizzle-kit is a developer tool, never part of CI or of the runtime).

Add a feature by adding a table to `db/schema.ts`, its migration SQL, an authorized handler
under `server/routes/api/` (`defineAuthorizedHandler` with `dbTables` and Zod input), a page
in `src/pages/`, and its route in `src/app.tsx`. Every user-facing string goes through `t()`
with a key in both catalogues.
