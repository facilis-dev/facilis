# D-201 — `db/migrations` is retired everywhere; the 0009 backfill is data, not schema
**Status:** accepted (2026-11-19)

**Context.** D-158 made DDL generated at release time and D-193 made the dev boot materialize the
declaration, but the runtime still replayed `db/migrations/*.sql` first, both examples still shipped
`db/migrations/**` (and `meta/`), and they kept `drizzle.config.ts`, `db:generate` and the
`drizzle-kit` devDependency. SPEC §4/§7.3 already described the folder as absent. The one piece that
did not fit "just delete the SQL" was `0009_email_verification.sql`, whose
`UPDATE "users" SET "email_verified_at" = now() WHERE ... IS NULL` is a **data backfill** (D-156),
not DDL.

**Decision.** The folder leaves the project, the templates and the runtime.

- **No replay.** `readMigrationStatements`, `readMigrationsDir`, `DEFAULT_MIGRATIONS_DIR` and the
  runtime's private SQL splitter are removed; `reconcileDeclaredSchema` (D-193) is the only schema
  step of the dev boot, applied before the role seed.
- **No config knob.** `db.migrationsDir` is gone from `FacilisConfig`, from the analyzer's
  `ConfigFacts` and from the AI `EffectiveState`. Rule 14 keeps a fixed `db/migrations` constant so
  a legacy folder in an existing project still refuses AI-authored DDL (D-158).
- **No SQL in projects.** Both examples drop `db/migrations/`, `meta/`, `db/migrations.test.ts`,
  `drizzle.config.ts`, `db:generate` and the `drizzle-kit` devDependency, so no workspace package
  installs it; the IDE templates inline `db/schema.ts` only. The deferred P4 oracle comparison
  (MIGRATION-PLAN §8) adds drizzle-kit to the framework repo's CI tooling, never to a project.
- **The 0009 backfill is data.** v1 has no data batches and no data ledger, so the backfill is not
  representable in a release plan and is not resurrected as committed SQL in a project. A fresh
  project has no rows to backfill. An existing deployment upgrading from a pre-D-156 release and
  enabling `auth.verification` runs once, outside the framework:
  `UPDATE users SET email_verified_at = now() WHERE email_verified_at IS NULL;`
  The release ledger/artifact work (P3/P4) is where a first-class data step would live.
- **Legacy preview stays until P4.** The IDE Release Preview migration-file lens still reads the
  *target project's* `db/migrations` history; #48 replaces it with the tag -> tag plan. That path is
  a preview of legacy history, never a source of DDL for a generated project.
- **The e2e provisions from the plan.** `scripts/postgres-e2e.mjs` builds the example schema from
  `planSchema(empty, declared)` — the same batches a deploy applies — instead of a SQL directory.

**Exposed gaps, fixed here.** Removing the replay made the declaration the only creator, which
surfaced two latent bugs: `schemaSnapshot` rendered Drizzle's json/jsonb defaults as a bare
`{}`/`[]` (invalid DDL) instead of a quoted literal with its cast, and `examples/todo-app/db/schema.ts`
never re-exported `auth_email_verifications`, so the register route's verification write targeted a
table no migration had created on a fresh project.

**Consequences.** A schema change is one file (`db/schema.ts`) for dev, preview and release. The
example's declaration-level guarantees are covered by `examples/todo-app/db/schema.test.ts` (RLS,
policies, tenant default, re-exports) plus `schema-reconcile.test.ts`; the boot itself is covered by
`pnpm ide:smoke`.

**Renumbered.** Filed as D-197 on 2026-11-19, a number already taken by the commit-box generator
(D-197); it became D-201 when the log split into one file per decision (2026-11-20).
