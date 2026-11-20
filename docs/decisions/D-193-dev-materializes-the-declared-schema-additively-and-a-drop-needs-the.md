# D-193 — Dev materializes the declared schema additively, and a drop needs the user's confirmation
**Status:** accepted (2026-11-18)

**Context.** D-158 retired authored DDL: rule 14 now refuses any write under `db/migrations/` and
rule 16 no longer asks for a seed migration (implementation note there). But the dev database was
still built by replaying `db/migrations/*.sql`, so once the AI stopped authoring migrations an
added table simply did not exist at runtime: the schema compiled, the route was valid, and the
query failed with `relation does not exist`. The plan (docs/MIGRATION-PLAN.md P5) already says
the dev boot reconciles live -> declared; SPEC §7.3/§11 assumed it. Nothing implemented it, and
the destructive half (a drop) had no consent model in dev at all.

**Decision.** The dev boot builds the database from the declaration, and destructive DDL needs
the user.

- **Additive reconcile.** After the legacy migration replay (kept so projects that still ship SQL
  boot unchanged), `reconcileDeclaredSchema` (`packages/nitro/src/runtime/schema-reconcile.ts`)
  reads the declared snapshot (`schemaSnapshot(db)`, from `db/schema.ts`) and the live catalog
  (`liveSchemaSnapshot`), and renders the missing pieces with the release planner's own SQL
  (`createTableSql`, `addColumnSql`, `addForeignKeySql`, `createIndexSql`, `createPolicySql`,
  `enableRlsSql`; guarded `CREATE TYPE` for enums). Tables the declaration has and the database
  lacks are created whole — columns, PK/unique/check, then foreign keys, indexes, RLS and policies
  in later passes; existing tables get their missing columns, RLS and policies. A statement that
  cannot apply (a NOT NULL column with no default on a table with rows, an unsupported
  declaration) is a `schema_reconcile_failed` manifest warning, never a failed boot; the drift
  stays visible on `/__facilis/dev/schema`.
- **Destructive needs consent.** A write whose validated result drops a table or a column is
  **held**: the tool returns `{ ok: false, confirmation: { changes } }` with rule 15's own wording
  and writes nothing, and the turn pauses with a card. **Apply** re-validates the held patch
  against the project as it is now, writes it, and appends the drops to
  `<project>/.facilis/dev/schema-approvals.json` (shared contract: `SCHEMA_APPROVALS_PATH` /
  `parseSchemaApprovals` in `@facilis.dev/core`, writer in `ide/src/ai/schema-approval.ts`).
  **Cancel** ends the turn with nothing written. No other write lands while the card is open, so
  a turn cannot half-apply around the pause.
- **The boot applies only approved drops.** The reconcile drops a live-only table or column only
  when the approvals file names exactly that change (`drops table "x"`,
  `drops column "x.y"`); everything else is left alone, silently. Naming the change instead of
  hashing the schema file keeps an approval valid across later unrelated edits and makes a
  confirmation impossible to replay against another table.

**Rejected alternatives.** *Interrupt the boot when a drop is pending*: the preview never starts,
the user cannot inspect anything, and every boot asks again. *Apply destructive DDL automatically*
(dev data is disposable): a hand edit of `db/schema.ts` would silently delete columns, and the
confirmation is about intent, not about recovering bytes. *Ask from the runtime through an HTTP
endpoint*: the WebContainer process has no channel to the UI beyond routes and the manifest, so it
would need a second round trip and a pending-plan state for no extra safety. *Hash `db/schema.ts`
as the approval token*: any later schema edit invalidates an approval for a drop that was already
approved. *Block after the write* (revert on refusal): the model would already have seen a success.

**Consequences.** A confirmed drop runs at the next boot; an unconfirmed one leaves the column in
the dev database (visible as drift, harmless to the app). The gate's checkpoint commit uses the
Source Control identity and falls back to `Facilis IDE <ide@facilis.local>` when the user has not
set one yet, so a first-run project does not leave the assistant blocked behind a git config it
cannot set from the chat; the fallback is never persisted and the SCM panel still prompts for the
real identity. The AI cannot add a required column with
no default to a table with rows in dev: the boot warns and the column stays missing until the
database is reset or the schema gives it a default — the same preconditions the release planner
declares. The migration replay remains until P6, so a project's existing SQL still runs first and
the reconcile is then a no-op for it. `.facilis` state stays local (D-052); the approvals file is
never committed.

**Verification.** New suites: `packages/nitro/src/runtime/schema-reconcile.test.ts` (creates a
missing table, adds a missing column, never drops unapproved state, drops an approved table, warns
instead of failing the boot), `ide/src/ai/chat-writes.test.ts` (holds a destructive write, applies
it on confirmation and records the consent, refuses other writes while pending, applies an
additive schema change directly), `ide/src/ai/turn-writes.test.ts` (pause/apply/cancel/no-handler)
and `ide/src/ai/chat-schema-confirm.test.ts`. Full gates in this worktree: `pnpm lint` (0
errors), `pnpm typecheck` 21/21, `pnpm test` 21/21, `pnpm build` 13/13.
