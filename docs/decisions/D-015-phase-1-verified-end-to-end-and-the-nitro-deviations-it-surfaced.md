# D-015 — Phase 1 verified end-to-end (and the Nitro deviations it surfaced)
**Status:** accepted (2026-10-25)

`examples/todo-app` is the Phase 1 acceptance app and it runs headlessly: health, full and
summary manifest (547 chars), `/__facilis/manifest/revision`, ETag/304, invalid `sections`
400, cross-origin 403, `/_openapi.json` with `x-permission`/`x-db-tables`/`x-db-columns`,
registration with `FACILIS_INITIAL_ADMIN`, default-role assignment, login/session with
expanded permissions, todo CRUD, RLS isolation (second user sees nothing, cross-user DELETE
is a 404), invalid body/query 400s and anonymous 401. Reproduce with
`cd examples/todo-app && ./scripts/verify-headless.sh`.

Deviations accepted while getting there:

- `#facilis/openapi-meta` is owned **only** by the `facilis()` Vite plugin, not registered as a
  Nitro virtual module: inside the Nitro environment, Nitro's virtual plugin resolves that id
  before user plugins, which served stale metadata and broke HMR. `#facilis/config` and
  `#facilis/db-schema` stay Nitro virtuals.
- `?format=summary` returns `{ revision, generatedAt, sections, summary, warnings }`; the
  compact view is not a `Partial<FacilisManifest>` (spec §6.1 note added).
- The revision hash uses the AST metadata map (the Facilis-owned part of the spec) rather than
  the merged OpenAPI document, avoiding a self-fetch and staying deterministic without Nitro's
  generator.
- Dev boot applies migrations, seeds `role_permissions` and runs `ensureAppRole`; the
  production facade is only mounted when `openAPI.production` is enabled.
- Dev PGlite runs in-memory (the config `dataDir` is not wired yet): the dev database resets
  when the Nitro worker restarts. Tracked as later-phase work; tests and the example do not
  depend on persistence.
