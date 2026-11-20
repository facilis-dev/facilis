# D-097 — The Data Explorer gets a query console and declarative SQL views
**Status:** accepted (2026-11-06)

The Data Explorer could only read the live schema, and it reached that schema through the
preview iframe URL: a popped-out preview or an isolated preview origin left the panel
unreachable. The user asked to keep the table list on the left, and to add a central pane that
runs SQL, shows rows live, and turns a finished query into a reusable view in the code — with
views following the permissions of the underlying tables. D-095 left the connection in O-011.

**Decision.** Three parts, one contract.

- **Kernel-mediated transport.** Panels build requests from a same-origin
  `/preview/<port>/…` URL carrying the kernel token, which the Studio's Service Worker routes
  to the in-VM dev server, instead of the preview iframe's `src`. The token is preserved when a
  path is appended (it stays in the query string), so the same base serves the schema endpoint,
  the query endpoint and the manifest. Popped-out previews work; the embedded iframe is no
  longer required.
- **Query console.** `POST /__facilis/dev/query` runs one statement in a `READ ONLY` transaction
  with a 5 s `statement_timeout`; a prefix check (SELECT/WITH/VALUES/TABLE, one statement)
  gives the friendly error, the transaction is the boundary (a SELECT calling a writing function
  is rejected there), and the statement is wrapped in an outer LIMIT with a `truncated` flag.
  Rows are JSON-safe values (bigint/Date/bytea/jsonb normalised) and columns carry their
  Postgres type name from `pg_type`, which the Studio's code generator consumes.
- **Declarative views.** A view is code: `db/views/<name>.ts` declares it with
  `defineView({ name, columns, query })` from `@facilis.dev/db`, one file per view (no import
  merge). `#facilis/db-views` collects the modules, and the dev boot applies
  `CREATE OR REPLACE VIEW "name" WITH (security_invoker = true) AS <literal query>` after
  migrations and the app-role bootstrap, then grants SELECT to `facilis_app`. The Create-view
  button validates the SQL, creates the view live through `POST /__facilis/dev/view` (so it is
  usable immediately), and writes the file through the kernel's `vv-write` — the Studio never
  touches OPFS. `defineView` returns a Drizzle view, so a route selects from it like a table.
- **Permissions follow the base tables.** `security_invoker` makes the view execute as the
  invoking role, which is the policy-scoped `facilis_app` every route already runs as; the base
  tables' RLS and grants therefore are the view's permissions. The framework always emits the
  option and there is no flag to turn it off. `packages/db/src/views.test.ts` proves both
  directions: a plain superuser-owned view returns every row through the app role, the declared
  view returns only the caller's.
- **Console RLS.** The console itself runs as the connecting superuser (SPEC §11.2's "superuser
  (with warning)" mode), so a developer previews all rows; the UI says so. A per-user/role mode
  stays open as O-012.
- **Production.** Views are DDL: on a Postgres target the boot skips them with a
  `view_ddl_skipped` warning, exactly like migrations, and the deploy step provisions them from
  the same code.

**Rejected alternatives.** *PGlite snapshot in a Studio worker*: stale data, a second Wasm
instance and concurrent writers (already rejected in O-011). *Creating the view only in code
without applying it live*: the next query would not see it, so the button would lie. *Drizzle
`pgView(...).as(sql)` plus drizzle-kit output*: arbitrary result sets need declared column types
and a migration channel, and a view generated from a console query is not really a migration;
framework-time CREATE OR REPLACE keeps views derived from code with zero build. *A code-level
saved query instead of a database view*: permissions would be inherited trivially, but the user
asked for views in the code, and the security_invoker guarantee is the contract worth testing.
*Materialised views*: a refresh lifecycle is a separate design.

**Consequences.** `@facilis.dev/db` grows `views.ts`, `query-console.ts` and `read-only-sql.ts`;
`@facilis.dev/nitro` gains the `#facilis/db-views` virtual module and the two dev routes (three
dev endpoints total). A generated project may have a `db/views/` directory. The IDE gains a
`data-query` editor tab and the kernel-mediated base. Preview mode C has no same-origin SW, so
the transport is still undefined there, and the declared-from-AST table list is still planned
(O-011). The analyzer/manifest do not know views yet, so a route that selects from one declares
its base tables in `dbTables`; extending the facts, the graph and the reverse lookup is O-013.

**Verification.** `@facilis.dev/db` 14 files / 107 tests (views under RLS, read-only transaction, JSON-safe rows), `@facilis.dev/nitro` 19 files / 137 tests (both routes, guard/404, virtual module, view failure as a warning), IDE 83 files / 646 tests, IDE typecheck/lint (0 errors)/file-length/theme green (controller 2517 lines, under its 2518 ratchet). Root `lint` (0 errors, 212 warnings), `typecheck` (19 tasks), `test` (19 tasks) and `build` (12 tasks) green. The generated `defineView` file shape compiles inside `examples/todo-app`. Browser smoke re-run: 108 checks pass, including the Data Explorer table list and the whole query console flow (open, type, run, rows rendered); the 6 failures are all in the pre-existing chat flow (settings/provider picker, the proposal's file list, the patch reaching the VFS) plus the two global console/request checks it trips. Chat is known-broken and out of scope for this change; every non-chat check passes.
