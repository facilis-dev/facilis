# AI code validation — a plain-language guide

Status: implemented (2026-11-20). This guide explains, in simple terms, the checks every
AI-written file must pass before it touches a Facilis project. The formal contract is
[SPEC.md §9.3](./SPEC.md) (23 rules); the code lives in `packages/ai/src/validator.ts` and
`packages/ai/src/rules/`. If this guide and the spec disagree, the spec wins.

## The idea in one paragraph

The AI never writes to your project directly. Every file it wants to create or change is a
**patch** (a path plus the full new content), and every patch goes through a **validator**
first: 23 numbered rules plus 2 structural checks. If even one **error** is found, *nothing
is written* — the findings go back to the model, which fixes them in the same turn.
**Warnings** never block a write; they are reported so you (or the model) can clean them up.
The goal is simple: the AI can move fast, but it cannot ship a route without authorization,
a table without row-level security, or a file outside the places it is allowed to touch.

## How a patch is judged

- **Errors block, warnings don't.** The result is `ok` only when there are zero errors.
  Warnings come from rules 5, 13 and 17, plus "declared but never used" notes from rules 18/19.
- **All files of a turn are checked together**, against the project *as it will look after
  the patch* — so a new table added in the same turn already counts as existing.
- **Removing things is checked too.** Deleting a table, column or permission that an
  *untouched* route still uses is an error, even though that route is not in the patch.
- **Destructive schema changes** (dropping a table or a column) are flagged and need
  confirmation. On the chat's write path the clean-git-tree checkpoint is that confirmation:
  the drop is reported in the summary (`destructive: true`), not silently applied.
- **Two write policies.** `managed` (the validator's fail-closed default, used by managed
  deployments) only allows the app folders listed in rule 11. `open` (open builds) allows
  any project file except a short protected list.
- **If the validator's own machinery is down** (e.g. the parser is unavailable), it fails
  closed: the turn ends as a validator outage and nothing is written. It never guesses.

## The checks at a glance

| # | Code | Protects against | Severity |
|---|---|---|---|
| — | `content-present` | empty file writes | error |
| — | `json-parse` | broken JSON files | error |
| 1 | `ts-parse` | syntax errors | error |
| 2 | `route-security` | API routes without authorization | error |
| 3 | `db-tables-present` | routes that don't declare their tables | error |
| 4 | `db-tables-valid` | declarations naming tables that don't exist | error |
| 5 | `db-columns-valid` | wrong column names in declarations | warning |
| 6 | `permission-valid` | permissions that were never declared | error |
| 7 | `block-import-valid` | unregistered block imports | error |
| 8 | `route-input-validated` | request bodies used without a Zod schema | error |
| 9 | `no-raw-db-access` | bypassing the framework's database client | error |
| 10 | `rls-on-scoped-table` | user-scoped tables without row-level security | error |
| 11 | `file-path-allowed` | writes outside the allowed places | error |
| 12 | `import-resolves` | imports of files/packages that don't exist | error |
| 13 | `i18n-keys-registered` | UI text with no translation key | warning |
| 14 | `migration-generated` | hand-written SQL migrations | error |
| 15 | `destructive-confirmed` | silent drops of tables/columns | error |
| 16 | `role-config-sync` | unreadable role/permission config | error |
| 17 | `route-description` | routes with no (or stale) description | warning |
| 18 | `route-table-declared` | routes using tables they didn't declare | error |
| 19 | `job-table-declared` | jobs using tables they didn't declare | error |
| 20 | `table-class-declared` | tables with no declared access class | error |
| 21 | `get-side-effect-free` | state-changing GET routes (CSRF via top-level navigation) | error |
| 22 | `raw-sql-system-table-write` | raw SQL writing a seed-only auth table | error |
| 23 | `reserved-route-prefix` | app routes shadowing a framework-owned path | error |

The examples below use the todo app (`examples/todo-app`): a `todos` table with a
`tenantId` column, a `todos:write` permission, and a `purge-completed-todos` job.

---

## 1. Is the file usable at all?

### `content-present` (structural) — a write must carry content

A create/update patch must include the full, non-empty file. Deletes are exempt.

- ✅ `{ path: "src/App.tsx", action: "update", content: "<the whole new file>" }`
- ❌ `{ path: "src/App.tsx", action: "create", content: "" }` — or `content` missing entirely.

### `json-parse` (structural) — JSON files must be valid JSON

Every `.json` file the AI writes must parse. This applies to **all** catalogues, not just
English: a broken `locales/it.json` would otherwise blow up later as an unreadable Vite
error (D-190).

- ✅ `{ "app.title": "Facilis todos" }`
- ❌ `{ "app.title": "Facilis todos", }` — trailing comma. Comments and single quotes fail too.

### Rule 1 `ts-parse` — the code must be syntactically valid

Every patched script file must parse as TypeScript/JavaScript. Note: this is **syntax
only** — type errors are the editor's job, not the validator's.

- ✅ `const total = items.length;`
- ❌ `const total = ;` — the error reports line, column and an excerpt.

### Rule 12 `import-resolves` — every import must point at something real

Relative imports must match a file that exists (after the patch); package imports must be
declared dependencies. `node:` builtins are fine. Aliases like `~/db/schema` resolve to the
project root.

- ✅ `import { todos } from "~/db/schema";` — the file exists.
- ❌ `import { helper } from "./utils/missing";` — no such file.
- ❌ `import pad from "left-pad";` — not in `package.json`. New dependencies need user
  approval; the AI cannot add them by itself.

### Rule 11 `file-path-allowed` — the AI can only write where it may

Paths must be project-relative (no leading `/`, no `..`). Then the write policy decides:

**`managed` (default):** only these folders, plus one root file:
`server/`, `src/`, `db/`, `lib/`, `components/`, `locales/`, and `facilis.config.ts`.

- ✅ `src/components/TodoList.tsx`, `server/routes/api/todos/index.get.ts`, `facilis.config.ts`
- ❌ `vite.config.ts`, `scripts/deploy.ts`, `package.json` — outside the allowed set.

**`open`:** any project path **except** `node_modules`, `.git`, `.facilis`, `dist`,
`.turbo`, `coverage` (at any depth), and `package.json`, lockfiles, `.npmrc`, `AGENTS.md`.

- ✅ `docs/NOTES.md`
- ❌ `package.json`, `src/../.git/config`

---

## 2. API routes: who may call them, and what they touch

A route file looks like this (the shape all route rules expect):

```ts
// server/routes/api/todos/index.post.ts
export default defineAuthorizedHandler(
  {
    permission: ["todos:write"],
    body: z.object({ title: z.string().min(1).max(200) }),
    dbTables: ["todos"],
    dbColumns: ["todos.title", "todos.tenantId"],
    description: "Create a todo for the current user.",
  },
  async (_event, { body, auth, db }) => {
    const [row] = await db.insert(todos).values({ title: body.title, ownerId: auth.userId });
    return { id: row.id };
  },
);
```

### Rule 2 `route-security` — every route is an authorized route

The default export must be a real `defineAuthorizedHandler` call. A plain Nitro handler —
or a comment that merely mentions the wrapper — does not count.

- ✅ `export default defineAuthorizedHandler({ ... }, async (...) => { ... })`
- ❌ `export default defineEventHandler(async (event) => { ... })` — no auth, no declarations.

### Rule 6 `permission-valid` — permissions must be declared first

Every permission a route requires must exist in `facilis.config.ts` (`auth.permissions`).
An empty list means a public route (login, register) and is valid.

- ✅ `permission: ["todos:write"]` — declared in the config. Or `permission: []`.
- ❌ `permission: ["todos:delete"]` when the config never declares it. Fix: declare it in
  `facilis.config.ts` in the same turn. Removing a permission that another route still
  requires is an error too.

### Rule 8 `route-input-validated` — no unvalidated input

If the handler reads the JSON body, the config must declare a Zod `body` schema; multipart
uploads need a `form` schema. Invalid input then becomes a `400` automatically.

- ✅ `body: z.object({ title: z.string().min(1) })` and the handler uses `body.title`.
- ❌ The handler reads `body.title` but the config has no `body` schema.

### Rule 3 `db-tables-present` — every route declares its tables

The `dbTables` field must be there. An empty array is fine ("this route touches no table");
a missing field is not.

- ✅ `dbTables: []` or `dbTables: ["todos"]`
- ❌ A config with `permission` and `body` but no `dbTables` key at all.

### Rule 4 `db-tables-valid` — declared tables must exist

Every entry must name a real table or view in the resulting schema (a table added by the
same patch counts). Names are SQL names (`"todo_files"`) or Drizzle bindings (`todoFiles`).

- ✅ `dbTables: ["todos", "todo_files", "facilis_files"]`
- ❌ `dbTables: ["todoz"]` — a typo. Also fails on an *untouched* route if the patch removes
  a table it still declares.

### Rule 5 `db-columns-valid` (warning) — column names must be right

`dbColumns` entries must be `table.column` using the **Drizzle property names**
(camelCase), and the column must exist. Unlike `dbTables` (SQL names), this is camelCase.

- ✅ `dbColumns: ["todos.title", "todos.dueDate", "todos.tenantId"]`
- ❌ `dbColumns: ["todos.due_date"]` (SQL name), `["todos.titel"]` (typo), `["title"]` (no table).

This is a **warning**: the write goes through, but the declaration should be fixed.

### Rule 18 `route-table-declared` — you must declare what you actually use

The declaration is not decorative: every table or view the route touches through
`db` / `sudo` / `system` must appear in `dbTables`. The check **follows local helper
calls** (a helper in `server/utils/` counts as part of the route) and runs over **all**
routes — editing a shared helper re-checks the routes that use it. The runtime enforces the
same contract, so an undeclared table fails closed in production too (D-157).

- ✅ The handler (or its helper) uses `todos` and `todoFiles`, and the config declares
  `dbTables: ["todos", "todo_files"]`.
- ❌ `db.select().from(todoFiles)` with `dbTables: ["todos"]` — `todo_files` is missing.
- ❌ ``db.execute(sql`...`)`` without `rawSql: true` in the config — raw SQL is the one
  exception, and it must be opted into explicitly.
- ❌ `db.select().from(tables[name])` — a dynamic table cannot be checked statically, so it
  is refused.
- ⚠️ Declaring a table the route never uses is a warning, not an error.

### Rule 21 `get-side-effect-free` — a GET route stays read-only

`SameSite=Lax` sends the session cookie on a cross-site top-level GET navigation, so a GET
that writes is CSRF-able even with the origin gate (which covers unsafe methods only). The
check **follows local helper calls** and runs over **all** effective GET routes (and
method-less routes, which serve GET too). The pinned exemptions are the framework SSO
GET/ACS write pair (D-120), the email-verification link GET (D-156) and the framework
read-only blueprint GETs; the runtime origin gate stays the security authority (D-212).

- ✅ `db.select().from(todos)` in a `.get.ts` handler — a read.
- ❌ `db.insert(todos)...` (or `update`/`delete`/`execute`) in a GET, directly or through a
  local helper — move the write to a POST/PUT/PATCH/DELETE route.
- ❌ `jobs.enqueue(...)` or `jobs.cancel(...)` in a GET — queue mutations are side effects.
- ⚠️ A handler body the analyzer cannot fully inspect (a package helper receives the client)
  is a warning, never a guessed error.

### Rule 22 `raw-sql-system-table-write` — auth tables are written only by the release seed

`role_permissions`, `roles`, `user_roles` and `sessions` are system-only: they are written
only by the release artifact's seed statements and the framework's audited auth paths
(invariant 8, D-158/D-204). A literal SQL statement passed to `db.execute` on `ctx.db`,
`ctx.sudo` or `ctx.system` that inserts, updates, deletes or runs DDL against one of them is
an error; `ctx.sudo` with `rawSql: true` does not make it legitimate. Only statements the
analyzer can read are judged — a dynamic or interpolated SQL expression is skipped and the
runtime audit remains the authority (D-214).

- ✅ `db.execute("SELECT * FROM role_permissions")` through `sudo` — a read.
- ❌ `db.execute("INSERT INTO role_permissions (role, permission) VALUES ('user', 'todos:read')")`.
- ❌ `system(..., (db) => db.execute("DELETE FROM sessions"))` — elevation is audited, not a
  licence to rewrite a seed-only table.
- ⚠️ Not a finding: dynamic SQL (`db.execute(statement)`, interpolated templates) and writes to
  an ordinary project table.

### Rule 23 `reserved-route-prefix` — app routes never shadow a framework path

The framework registers its own handlers for the control plane (`/__facilis/**`: manifest,
health, the dev consoles and telemetry), the OpenAPI documents (`/_openapi.json`,
`/_facilis/openapi.json`), the SSO namespace (`/api/auth/sso/**`) and the token endpoint
(`/api/auth/token`) in dev and production. An app route on one of those paths would shadow,
or be shadowed by, framework code (invariant 6, D-107/D-116/D-120). A route file under
`server/{routes,api}/__facilis/**` is rejected on its location too. `/api/files/**` and
`/api/jobs/**` are **not** reserved: the framework registers no handler there and the shipped
examples own them (D-215).

- ✅ `server/routes/api/auth/login.post.ts`, `server/routes/api/files/[id].get.ts`,
  `server/routes/api/jobs/index.post.ts`, `server/routes/health.get.ts`.
- ❌ `server/routes/__facilis/x.get.ts` — the file lives under the framework route directory.
- ❌ `server/routes/api/auth/token.post.ts`, `server/routes/api/auth/sso/callback.get.ts` —
  shadowed framework paths.
- ⚠️ Not a finding: a lookalike segment (`server/routes/__facilisx.get.ts`).

### Rule 17 `route-description` (warning) — every route explains itself

Each patched route needs a one-sentence English `description` (≤ 120 characters), and it
must be refreshed when the route's contract changes (permissions, inputs, tables).

- ✅ `description: "Create a todo for the current user."`
- ❌ No description; a 150-character one; or changing `permission`/`dbTables` while keeping
  the old description verbatim. Warning only — never blocks.

---

## 3. Database safety

### Rule 9 `no-raw-db-access` — the database is reached only through the framework

No raw driver or client imports in project code: `@electric-sql/pglite`, `pg`,
`postgres`, `drizzle-orm/node-postgres`, etc. The handler context already provides
`db`, `sudo` and `system` — use those.

- ✅ `import { eq, desc } from "drizzle-orm";` (query operators) and
  `drizzle-orm/pg-core` (the schema DSL) are allowed.
- ❌ `import { PGlite } from "@electric-sql/pglite";` in `server/utils/db.ts` — a private
  client would bypass RLS, declarations and audit.

### Rule 10 `rls-on-scoped-table` — user data is fenced by row-level security

When a patch touches `db/schema.ts`, **every** user-scoped table in the resulting schema
must have `.enableRLS()` **and** at least one policy. A table is "scoped" when it carries a
tenant/owner column (`tenantId`, `ownerId`, …). Framework tables re-exported from
`@facilis.dev/auth` / `@facilis.dev/db` ship their own RLS and are ignored.

- ✅ `pgTable("todos", { ..., tenantId: tenantColumn() }, () => [tenantIsolationPolicy(), ownerIsolationPolicy()]).enableRLS()`
- ❌ The same table without `.enableRLS()`, or with `() => []` (no policy). Dropping an
  existing policy fails too — the check audits all scoped tables, not just the new ones.

### Rule 20 `table-class-declared` — every table declares its class

When a patch touches `db/schema.ts`, **every** project table in the resulting schema must
declare its access class (D-136/D-211): `.enableRLS()` **and** a policy, or an explicit
`// system-only` comment on the line immediately above the declaration. Rule 10 only sees
tenant/owner-scoped tables; this rule also catches the plain table that would silently get no
app-role privilege and fail closed at runtime. Framework tables re-exported from
`@facilis.dev/auth` / `@facilis.dev/db` ship their own class and are ignored.

- ✅ `pgTable("todos", { ..., tenantId: tenantColumn() }, () => [tenantIsolationPolicy()]).enableRLS()`
- ✅ `// system-only: audit trail` on the line above `export const audit = pgTable("audit", ...)`
- ❌ A bare `pgTable(...)` with neither — error. `.enableRLS()` with `() => []` (no policy) is a
  warning: RLS is on but the app role reaches no row. A marker the parser cannot read warns too.

### Rule 14 `migration-generated` — nobody hand-writes SQL migrations

DDL is generated from `db/schema.ts` at release time (D-158). Any create/update under
`db/migrations/` is refused — the directory is retired.

- ✅ Add the table or column in `db/schema.ts`; the release pipeline renders the SQL.
- ❌ `{ path: "db/migrations/0003_add_notes.sql", action: "create", content: "ALTER TABLE ..." }`

### Rule 15 `destructive-confirmed` — drops are never silent

If the resulting schema **drops a table or a column** compared to before (a rename counts
as drop + add), the patch must carry `requiresConfirmation: true`. On the chat's write path
the clean-git-tree checkpoint provides that consent, so the drop is **flagged** in the
summary (`destructive: true`, with the list of drops) rather than blocked — you see exactly
what will disappear.

- ✅ An additive change (new table, new column). Or a deliberate drop with confirmation.
- ❌ Re-emitting `db/schema.ts` without the existing `dueDate` column and no confirmation.

### Rule 16 `role-config-sync` — the role config must stay readable

Roles and permissions live in `facilis.config.ts`; the `role_permissions` seed is generated
from it at release, never hand-written. The rule's check: if the patch edits
`facilis.config.ts`, its `auth` block must be statically readable — otherwise the sync
cannot be verified and the patch fails closed.

- ✅ `defineConfig({ auth: { permissions: { "todos:write": ... }, roles: { ... } } })` — plain
  object literals.
- ❌ `auth: buildAuth()` or a spread the analyzer cannot read.

---

## 4. Background jobs

### Rule 19 `job-table-declared` — jobs declare their tables too

A job's `run` always gets a system-scoped `db`, and the same declaration contract applies:
every table or view it touches (following local helpers) must be in the job's `dbTables`.
The check covers **all** jobs in the project, not only patched ones. Workflows declare
nothing themselves — their surface is derived from the jobs they reference (D-162).

```ts
// server/jobs/purge-completed-todos.ts
export default defineJob({
  name: "purge-completed-todos",
  dbTables: ["todos"],
  async run({ db }) {
    await db.delete(todos).where(eq(todos.completed, true));
  },
});
```

- ✅ The shape above: `run` uses `todos`, `dbTables: ["todos"]`.
- ❌ `run` also touches `facilisFiles` but `dbTables` only lists `"todos"`.
- ❌ `dbTables` missing or unreadable — fails closed.
- ❌ `db.execute` without `rawSql: true` on the definition.
- ⚠️ A declared-but-unused table is a warning.

---

## 5. Text and translations

### Rule 13 `i18n-keys-registered` (warning) — every string has a key

User-facing text goes through `t("key")`, and every static key must exist in
`locales/en.json`. (Broken JSON itself is a hard error — see `json-parse` above.)

- ✅ `t("common.loading")` with `"common.loading": "Loading…"` in `locales/en.json`.
- ❌ `t("todos.empty")` without registering the key. Warning only; dynamic keys
  (``t(`todos.${status}`)``) are not checked.

---

## 6. Blocks

### Rule 7 `block-import-valid` — no unregistered blocks

Block imports must match a registered block manifest. The block supply chain is retired
(D-131), so today **every** block import fails; the rule keeps the contract slot reserved.

- ✅ Normal framework imports: `import { ... } from "@facilis.dev/core";`
- ❌ `import { DataTable } from "@facilis.dev/blocks/data-table";`

---

## What happens when a check fails

1. The validator returns the findings (code, file, line, message) **as data**.
2. Nothing is written — the project on disk is exactly as it was.
3. The model receives the findings and repairs the patch in the same turn; the write tools
   also require a clean git tree, so every turn starts from a known checkpoint (D-181).
4. Warnings, if any, are reported alongside the successful write.

You don't need to memorize the rules: they encode the project's security invariants
(SPEC §8) so that "the AI wrote it" is never a reason to lower the bar.

## Where to read more

- [SPEC.md §9.3](./SPEC.md) — the formal 23-rule contract (the source of truth).
- [SPEC.md §8](./SPEC.md) — the security invariants the rules enforce.
- [DECISIONS.md](./DECISIONS.md) — the reasoning: D-084 (validator), D-092/D-093 (AST facts),
  D-157/D-162 (table declarations), D-158 (generated DDL), D-181 (clean-tree checkpoint),
  D-215 (framework-owned route paths).
- `packages/ai/src/validator.ts` and `packages/ai/src/rules/` — the implementation.
