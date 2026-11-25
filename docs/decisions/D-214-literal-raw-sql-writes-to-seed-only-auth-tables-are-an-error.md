# D-214 — Literal raw-SQL writes to seed-only auth tables are an error
**Status:** accepted (2026-11-25)

Invariant 8 (D-158/D-204) makes `role_permissions` a seed-only projection: its rows are written
only by the release artifact's seed statements, applied by the operator. `roles`, `user_roles`
and `sessions` are the rest of the system-only auth set, written only by the framework's audited
auth paths. `ctx.sudo`/`ctx.system` plus `rawSql: true` can still reach them at runtime, and
the audit records it — but nothing flagged the statement before it reached disk. The runtime
wrapper and the audit stay the security authority; this is the additive early-warning layer
the epic asks for.

**Decision.** Read the literal SQL passed to `db.execute` and report analyzer diagnostic
`raw-sql-system-write` (error) plus AI validator rule 22 `raw-sql-system-table-write` (error)
when an INSERT/UPDATE/DELETE/DDL statement targets one of the four system-only auth tables.
Only statements the analyzer can read are judged: a dynamic or interpolated SQL expression is
skipped, and a SELECT through `sudo` is legitimate. Framework seed code is exempt because it is
shipped code, not project code. Additive: no runtime boundary changes.

**Mechanism.**

- The route-relations walk (D-157) now also records the *literal SQL text* of every
  `db.execute` argument as `rawSqlStatements` on the route and job relation facts. A string
  literal, a template literal without substitutions and the Drizzle `sql` tagged template
  qualify; an identifier, a call or a template with interpolations records nothing, so unreadable
  SQL stays unknown instead of becoming a guessed error. The existing `rawSql` site list is
  unchanged for D-212.
- `packages/analyze/src/raw-sql-system-tables.ts` is the shared contract: the four table names,
  the literal reader, and a conservative classifier that strips comments and single-quoted
  values, then matches the write/DDL verb immediately followed by the table (schema-qualified
  names reduce to their last segment). `rawSqlSystemWriteSites(usages)` deduplicates per
  statement and table and skips `node_modules/` sources.
- `packages/analyze/src/passes/raw-sql-system-write.ts` turns those sites into
  `raw-sql-system-write` errors over the route relation facts and every job's relation fact.
  Jobs are included because their `db` is system-scoped; only route/job handlers are scanned,
  so a standalone project seed file is never a finding either.
- AI rule 22 consumes the effective post-patch `Analysis` (`routes[].relations` and
  `jobRelations`), never a re-parse of the patch text, so a helper that changes its SQL is
  re-checked when the patch lands. It is wired in `packages/ai/src/validator.ts` and named in the
  SPEC §9.3 table.
- `routes-gate.test.ts` runs the new pass over the shipped examples and starter (zero findings
  today) and adds failing fixtures (literal INSERT, elevated sudo DELETE, a job DELETE) plus
  passing fixtures (SELECT via sudo, dynamic SQL, an ordinary table).

**Rejected.** Scanning every project file instead of the route/job facts: only a `ctx` db client
reaches the guarded surface, and facts must come from the effective analysis. A full SQL parser
dependency: verb+table matching is enough for an early warning, and the runtime audit remains the
authority. Reporting interpolated/dynamic SQL: the analyzer cannot prove the target, and the
epic's convention is to leave it unknown. Treating every `db.execute` against the auth tables as
an error: SELECT via `sudo` is a legitimate read. Extending the check to raw SQL issued through a
framework helper: that body is opaque to the walk and is the runtime audit's job.

**Consequences.** Additive; rollback is the removal of the pass, the rule and the SPEC rows. The
validator is now 22 rules and every current rule-count reference moves with it (historical
decision records keep the count of their time). The shipped examples already complied. The
classifier is deliberately conservative: a statement it does not recognize is not a finding, so a
future SQL spelling needs a classifier case, not a runtime change.

**Verification.** `packages/analyze/src/passes/raw-sql-system-write.test.ts` (literal
INSERT/UPDATE/DELETE/DDL, elevated sudo/system and tagged templates, SELECT via sudo, ordinary
table, dynamic and interpolated SQL, job write, standalone seed file);
`packages/ai/src/validator-raw-sql-system-tables.test.ts` (rule 22 over routes and jobs, dynamic
SQL, SELECT); `routes-gate.test.ts` (failing and passing fixtures plus the zero-violation
assertion over `examples/` and `starter/`); `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`.
