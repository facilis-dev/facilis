# D-195 — Dev reconcile converges indexes, foreign keys, checks and defaults on existing tables
**Status:** accepted (2026-11-19)

**Context.** D-193 materializes the declared schema at dev boot, but `planReconcile` only added
missing columns, RLS and policies to an existing table, and `liveSchemaSnapshot` read no indexes,
foreign keys or checks at all. With `db/migrations` retired (D-158), a schema change that adds an
index, foreign key, check or default to an existing table would never reach the dev database
(issue #49).

**Decision.** The live catalog read and the additive reconcile cover the remaining constructs.

- **Live reads.** `liveSchemaSnapshot` (`@facilis.dev/db`) now reads indexes from `pg_index`
  (excluding the indexes that back a PK/unique constraint — those are modeled as column flags and
  table constraints, not declaration indexes), including single-expression indexes via
  `pg_get_expr`; foreign keys from `pg_constraint` (`contype = 'f'`) with their columns, target
  and actions (an implicit PK target is resolved to the referenced key's columns); and checks
  (`contype = 'c'`) via `pg_get_constraintdef`. Defaults already rode on the column rows.
- **Additive + replacement.** `planReconcile` adds the constructs an existing table lacks and
  replaces the ones whose definition changed: a same-named index, check or foreign key with a
  different definition is dropped and immediately re-added — the release planner's own
  replacement semantics, which loses no data. Column defaults are set or dropped to match the
  declaration. Foreign keys are planned in a final pass, after every table's columns exist, since
  a key may reference a column another table gains in the same reconcile.
- **Normalized comparison.** The catalog deparser and PgDialect disagree on casts, parentheses,
  quotes and table qualification (`lower("documents"."title")` vs `lower(title)`), so defaults,
  checks and index expressions compare through `normalizeSchemaExpression` (the policy
  normalizer's cast/quote/paren/whitespace stripping, plus table-qualifier removal BEFORE
  parentheses, while the function name is still separable). Verbatim comparison would drop and
  recreate the same construct on every boot.
- **Drops stay consent-only.** A live-only index, foreign key or check is never dropped: D-193's
  approvals name tables and columns, and everything else is left alone, silently. An unsupported
  declared shape (D-158) is never rendered, and a live foreign key with a `SET DEFAULT` action is
  left alone because the declared snapshot cannot represent that action — replacing it would
  guess an intent the declaration never stated.

**Rejected alternatives.** *Verbatim SQL comparison*: deparser spelling differences would churn
(drop + recreate) on every boot. *Infer drops of live-only constructs*: violates D-193's consent
model. *New typed drift kinds for constructs in the same change*: the drift comparator keeps its
§11.1 scope (tables, columns, RLS, policies); convergence is asserted on the live snapshot itself,
and construct-level drift kinds remain a follow-up.

**Consequences.** The `/__facilis/dev/schema` live payload gains `indexes`, `foreignKeys` and
`checks` per table (additive fields). A replacement whose re-add fails leaves the usual
`schema_reconcile_failed` warning and the construct visibly missing from the live snapshot. The
#46 expression-index representation now converges on existing tables, not only on new ones.
