# D-084 — The AI patch validator enforces the 16 rules, with rule 1 injected and the project context built by the caller
**Status:** accepted (2026-11-02)

D-046/D-047 left the validator at the structural checks (path + content present) and deferred the
16 rules of SPEC §9.3 to Phase 4; invariant 9 says a patch must pass the validator before it
touches disk. The rules need things the structural gate never had: a TypeScript parser, the
config (roles/permissions), the code schema plus the tables the patch adds, `locales/en.json`, the
block manifests, the existing routes and import resolution. `@facilis.dev/ai` is imported by the
IDE's browser bundle, so the main entry cannot import a compiler.

**Decision.** Keep `@facilis.dev/ai` browser-safe and synchronous, and push the two async inputs to
its edges.

- **Typed context.** `validatePatch(patches, { context, requiresConfirmation, allowedRootFiles })`
  stays synchronous and takes a `PatchContext` assembled by the caller with
  `buildProjectContext(files, sources, manifest)`: `facilis.config.ts` (source authoritative, the
  manifest as fallback), `db/schema.ts` (tables/columns/policies/RLS merged with the manifest's
  live schema), `locales/en.json` merged with the manifest catalogue, the block manifests and
  routes, and `package.json`/`tsconfig.json` paths for imports. The patch is overlaid on that
  context once (`overlay.ts`), so every rule reads the post-patch world, including the tables and
  permissions it removes.
- **Rule 1 is an injected seam.** `SyntaxChecker` is supplied by the caller: the IDE passes
  Monaco's TypeScript worker (`getSyntacticDiagnostics` on a disposable in-memory model — no
  project model is swapped, open buffers are never touched), and Node tooling imports the
  `@facilis.dev/ai/node` subpath, which uses rolldown/oxc's `parseSync` (the same parser as
  `@facilis.dev/nitro`'s AST pass; dev-only, never in the browser bundle). A missing or throwing
  checker fails the rule closed — a silent skip would defeat the gate.
- **Rule 11's allowlist** is the six project roots plus `facilis.config.ts` (rule 16 needs it).
  Root `AGENTS.md` is writable only by the IDE's own instructions writer through the explicit
  `rootFiles` list, never by an AI patch.
- **Three validation points.** Proposal time (`parseTurn`: no proposal exists if the rules
  error), Apply time (`applyAccepted` re-validates the accepted files with a fresh context), and
  `applyPatch()` itself re-validates before the first `vv-write`. Undo is deliberately not
  re-validated: restoring a before-image must not be blocked by the rules it rolls back.
  Rules 5, 13 and 14 stay warnings; the rest block.

**Rejected alternatives.** The TypeScript compiler API: the workspace pins TypeScript 7 (the
native port), which no longer exposes the JS compiler API; its only API wants an on-disk
snapshot and a native language service — too heavy and fragile for the rule-1 test. Semantic
type-checking in the browser by swapping Monaco's project models: risks open buffers/undo and
produces false `TS2307` for files a patch creates and imports itself; type errors stay the
editor's language service. A JS parser inside the main entry: breaks browser safety. Validating
only on Apply: the card would show proposals that cannot be applied. Allowing any root file:
lets a patch rewrite `package.json` or the README.

**Consequences.** The managed AI gate (AI-SKILLS §4) can rely on the blocking rules 1–4, 6–12,
15–16; secret scanning and a `package.json` policy remain future rules. The validator scans text
rather than a full AST, so pathological route files can evade metadata checks; i18n covers
static `t()` keys and the `en` catalogue only; migration detection is the presence of a created
`.sql`; destructive detection covers tables/columns; the cross-checks against existing routes
need a reachable manifest. Validator warnings are carried in the proposal state but not yet
rendered in the UI (follow-up). Rule 1 runs against the editor's TypeScript service, which the
editor tears down and re-creates when the project's dependency types finish loading: a request
that lands in that window never answers, so the checker bounds every attempt (2.5 s) and retries
across the restart, and a validation round bounds the manifest fetch (3 s) — a cold project can
delay a proposal for a few seconds but can never leave the turn streaming; a service that never
answers still fails closed. At publish time (O-006) the Node subpath will need rolldown as a
real dependency or an injected checker. The retry loop (§9.4) was not implemented at the time
— `parseTurn` and `fix_hint`/`excerpt` were its seam; it is implemented now (D-100). Cost: one
context read plus one manifest fetch per validation round, and three rounds per Apply.

**Verification.** 48 `@facilis.dev/ai` tests (a suite per rule group, a realistic fixture project,
rule 1 rejects invalid TS and accepts valid TS through rolldown) and 523 IDE tests with no
regressions; `pnpm typecheck`, `pnpm lint` and the file-length/theme checks are green. The real
browser path is green end to end on a fresh profile: `pnpm ide:smoke` drives the mock provider
through rule 1 (the actual Monaco worker), the proposal card, Apply, the VFS write and Undo.
