# D-213 — Handwritten routes are gated for Zod input and raw-client imports
**Status:** accepted (2026-11-25)

Invariants 3 (Zod-validated input) and 5 (no raw Drizzle client imports outside
`@facilis.dev/db`) were enforced by AI validator rules 8 and 9 only. The shipped-example gates
covered invariants 1–2 (`routes-gate.test.ts`) and the table access class (D-211), and
`.oxlintrc.json` had no import restriction: a handwritten route that read `event.body` without a
schema, or that imported a driver, was invisible until runtime. The runtime wrapper remains the
security authority; this is an additive early-warning layer over the same AST facts the IDE and
the AI validator use.

**Decision.** Extend the SEC-12 route gate to the body/form and raw-client checks over every
shipped route tree (`examples/` and `starter/`), share the raw-client module list between the
analyzer, AI rule 9 and the gate, and ban those modules in oxlint outside `packages/db`.
`drizzle-orm` operators and `drizzle-orm/pg-core` table builders stay allowed: they are the
schema DSL, not a client.

**Mechanism.**

- `packages/analyze/src/raw-db-imports.ts` exports `isRawDbImport(specifier)`, the per-driver
  Drizzle entrypoints and bare drivers `@facilis.dev/db` wraps (PGlite, node-postgres, plus the
  other drizzle adapters the AI rule already refused). It is exported from the analyze main
  entry, consumed by `routes-gate.test.ts` and by AI validator rule 9, so a new driver cannot
  be added to one and forgotten in the other.
- `routes-gate.test.ts` reports `route-input-validated` when `handlerBodyRead` /
  `handlerFormRead` is true and the route config declares no `body` / `form` schema. `RouteFact.input`
  records schema *presence* even when the expression is not statically readable (D-053), so an
  opaque schema never becomes a guessed error, and a body-less GET is legitimately exempt.
- The same gate reports `no-raw-db-access` for every raw-client import of a route file; the
  check runs before the wrapper/dbTables checks so a broken wrapper cannot hide it.
- `.oxlintrc.json` adds `no-restricted-imports` (error) listing every raw-client entrypoint,
  with an override turning it off under `packages/db/**` — the one package allowed to wrap the
  drivers. This is the built-in oxlint rule: the epic's design rules reject custom JS plugins
  while they are alpha upstream (epic #168 rule 7).

**Rejected.** Banning `drizzle-orm` itself for lint: operators (`sql`, `eq`) are the supported
schema/query DSL and rule 9 keeps its narrower `drizzle()`-construction check. A second copy of
the driver list in the gate and in the lint config is still unavoidable (oxlint cannot import
TypeScript), but the analyzer copy is now the shared one and the decision pins the same modules.
Configuring the restriction only for `examples/`: the root lint run covers the whole workspace,
and invariant 5 is project-wide. Treating an unreadable body schema as a violation: the
unknown-fails-closed convention covers *unreadable* security state; here the schema is present,
only its shape is opaque.

**Consequences.** Additive: no runtime boundary changes; rollback is the config revert plus the
gate checks. The shipped examples already complied, so the new gate is green without route
edits. The oxlint error fires for AI-written and handwritten code alike once it lands on disk;
the AI validator fires earlier, at write time. A checker addition needs the module list updated
in `raw-db-imports.ts` and `.oxlintrc.json` together.

**Verification.** `packages/analyze/src/routes-gate.test.ts` (body read without schema, form
read without schema, schema present, body-less GET, raw-client import, pg-core/operators allowed,
plus the zero-violation assertion over the shipped apps); an oxlint run over a scratch file
outside and inside `packages/db` (error outside, clean inside, `pg-core` unaffected); rule 9's
suite still green through the shared predicate; `pnpm lint`, `pnpm typecheck`, `pnpm test`.
