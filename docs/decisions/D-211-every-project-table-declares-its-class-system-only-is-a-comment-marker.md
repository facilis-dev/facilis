# D-211 — Every project table declares its class: system-only is a comment marker
**Status:** accepted (2026-11-25)

D-136 made RLS the app-role grant boundary: a table without RLS gets no `facilis_app`
privilege, so it is system-only and its routes fail closed at runtime. But nothing required
the omission of RLS to be *deliberate*. Validator rule 10 only fires on tables with a
tenant/owner scope, so a project `pgTable` without RLS passed every static check and then
500'd on its first query; no CI gate covered the schema class at all.

**Decision.** Every project table declares its access class statically (invariant 4):
RLS-scoped (`.enableRLS()` plus a policy set) or explicitly system-only. The explicit
system-only marker is a comment — `// system-only` (optionally `: reason`) — on the line
immediately above the table declaration in `db/**`. A comment is the least-invasive marker:
it adds **zero runtime surface** (`ensureAppRole` and the grant boundary are untouched; the
catalog's `relrowsecurity` stays the only authority), it is AST-readable through the parser's
comment list, and it invents no DSL symbol, drizzle builder augmentation or config list. The
marker declares intent, never access: a marked table remains unreachable from `ctx.db`.
Framework tables stay exempt — they ship their own class and reach the schema by re-export.

**Mechanism.**

- The `Parser` contract gains optional `ParsedModule.comments`; `ProjectFile.comments` is
  `null` when the parser exposes none, so "marker unreadable" stays distinguishable from
  "no marker". Both oxc adapters (Node and browser) supply comments; the rolldown adapter
  does not, and that path is warn-only.
- `TableFact.systemOnly` carries the read marker; an unreadable marker on a no-RLS table
  carries a `schema-marker` unknown entry (warning), never a guess.
- The analyzer pass `schema-class.ts` reports `table-class-declared` (error) on a project
  table with neither class and `table-rls-no-policies` (warning) on RLS with zero policies.
  An unreadable marker downgrades `table-class-declared` to a warning. Only project `db/**`
  declarations are read; framework re-exports are exempt.
- Validator rule 20 `table-class-declared` consumes the effective post-patch Analysis
  (overlay facts, never re-parsed patch text), with rule 10's trigger: a patch touching
  `db/schema.ts` is a complete re-emission, so every project table in the result is audited,
  not only new ones. Framework re-exports are exempt through the same `db/schema.ts` source
  filter rules 10/15 use.
- `schema-gate.test.ts` runs the pass over `examples/` and `starter/` (D-154 pattern), so
  handwritten schemas fail `pnpm test` like handwritten routes do.

**Rejected.** A `.systemOnly()` chain method or a `systemOnly(pgTable(...))` wrapper: a new
runtime API for a purely static declaration, touching the builder surface the grant boundary
must stay independent of. Inferring system-only from "no RLS": the exact silent gap this
decision closes. A config allowlist of system-only tables: D-136 already rejected allowlists
(they fail open for the next table and can disagree with the catalog). A JSDoc tag or a
same-line trailing comment: adjacency on the line above keeps the marker attached to exactly
one declaration and readable with a line index alone.

**Consequences.** Additive: rule 10, `ensureAppRole` and the runtime grant boundary are
unchanged; rollback is removing the pass/rule/gate and the SPEC row. Dynamically composed or
unreadable schemas warn, never guess an error — the runtime boundary remains the authority.
The validator is now 20 rules; the SPEC §9.3 table, the guide and the prompt carry the count.

**Verification.** `packages/analyze/src/schema-gate.test.ts` (shipped examples green,
framework-only starter exempt, failing fixture: bare table error, marker accepted, zero-policy
warning, non-adjacent marker rejected, no-comments parser warn-only) and
`packages/ai/src/validator-table-class.test.ts` (rule 20 error/warning/exemption paths), plus
`pnpm lint`/`typecheck`/`test`/`build`.
