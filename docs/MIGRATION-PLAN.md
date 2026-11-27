# Migration generation in the release pipeline

**Status:** implemented in part: P0, P1 and P2 landed with D-158/D-159. The deploy applier
formerly planned as P3 was never built and is **withdrawn by D-204**. P5 landed on 2026-11-18
(D-193): rules 14/16 block authored DDL, and the dev boot reconciles the declared schema
additively (with confirmed drops only). P6 landed on 2026-11-19 (D-201): the dev migration
replay, the duplicated SQL splitter, the examples' SQL and `drizzle.config.ts`/`db:generate`
are gone, so a project ships only its declaration. The P4 preview slice landed on 2026-11-20
(#48): the Release Preview schema lens is the generated tag -> tag plan; the CI
`facilis release plan` step of P4 is still pending. §2–§3 are the design reference behind
SPEC §2/§7.7/§11.3; §8–§9 are historical checklists.

**Goal:** schema DDL is never authored by the AI or the user. It is **generated from the release
tags** (in the release pipeline, no database access) and shipped as an **immutable artifact**.
Applying that artifact to a database is the release environment's/operator's job (D-204); the
framework ships no applier. The live catalog is used by dev reconcile and Release Preview,
never as the generator.

> The deploy applier originally planned here (a CLI applying artifacts behind a ledger) was
> never built and is withdrawn by D-204; this plan now describes only the shipped release-artifact
> generation, Release Preview and dev reconcile. Applying an artifact to a production database
> is the operator's responsibility.

v2 changed the model after review: generation must not depend on the live database (the IDE and the
release pipeline cannot see prod/test), so the **tag -> tag diff is the primary path**, like a
classic migration but machine-generated. The live catalog is read only by dev reconcile and the
IDE's dev lens, never as the generator.

When accepted this plan supersedes:
- the D-086 schema-lens premise "the preview must show the SQL that ships, not invented SQL"
  (docs/DECISIONS.md) - the SQL is generated at release time and reviewed;
- the SPEC line "Migration execution: Studio previews only. Pipeline runs drizzle-kit migrate";
- PATTERNS §5 "generated, never hand-written" -> "generated, never authored";
- the migration-file expectations of AI-validator rule 14 and the config-sync rule
  (packages/ai/src/rules/database.ts, config-sync.ts);
- APP-UPDATES §5 and POSTGRES §4 (deploy step);
- the current dev-only apply path (runtime migrations replay) for release environments.

It completes D-109 (ADR entry missing, renderer orphaned).

---

## 0. One page

- **Release = a tag + an immutable migration artifact.** The release pipeline checks out the
  previous release tag and the new tag, reads both declared schemas (no DB), generates the SQL,
  classifies risk, and stores the artifact keyed by the new tag. This is the only place SQL is
  generated for test/prod. The same build writes `security-surface.json` (D-226) next to the
  server output; the release step must copy it alongside the migration artifact under the same tag, so the
  declared surface of a release is reviewable without rebuilding it.
- **Applying the artifact is the operator's job (D-204).** The framework ships no applier: the
  release environment applies the immutable artifact to its database. The same artifact is used
  in every environment, so test and prod cannot silently diverge.
- **The IDE never touches a database.** Its Release Preview computes the same tag -> HEAD plan from
  the git tree (it already reads refs this way) and shows SQL + risk. The authoritative artifact
  comes from the release pipeline.
- **The live catalog is a check, not a generator.** Dev boot reads the live PGlite schema and
  reconciles it to the declared schema (additive, with confirmed drops). The IDE never connects
  to test/prod.
- **Approval is a release act.** A destructive artifact carries its destructive batch list and an
  approval bound to its planHash. See §2.6.
- **Dev PGlite is the exception**: the IDE edits schema continuously without tags, so the dev
  database reconciles live -> declared at boot. It is disposable data, never a release path.
- **No hand-written data batches in v1** (decision 5): a plan that needs existing rows changed
  fails the release with a typed data_needed problem instead of inventing UPDATE SQL.
- **No runtime dependency on drizzle-kit.** Our generator (snapshot diff) runs in CI; drizzle-kit is
  a CI oracle only (its programmatic live path is verified broken, its CLI live path lossy).

---

## 1. Why the previous model was wrong (and your point)

The first version made the deploy compute a live -> target plan. That is wrong as the primary path:

- the IDE/release pipeline has no DB access (correct: the Studio must never reach a database), so the
  release cannot be reviewed against a live state;
- per-environment generation would produce *different SQL* for test and prod, defeating review and
  the "test what you deploy" property;
- the exact SQL applied to prod must exist and be approved *before* prod, not be invented on the
  prod host minutes before;
- audit: "what ran in prod" must be an artifact with a hash, not a recomputation.

What stays true from v1: the database may be in an unknown state, and no release should assume a
clean "from". The artifact records fromDigest/toDigest so whoever applies it can check the starting
state; applying it is the release environment's job (D-204).

Evidence that the tag path is the right one is already in the repo: Release Preview reads git refs
without booting them (ide/src/facilis/release-git.ts, D-086/D-094), so the IDE can show the
tag -> HEAD plan with no DB. The tag -> tag generator shipped with P2; the deploy applier was
never built and is withdrawn by D-204.

Existing gaps this plan addressed (retired by P5/P6):
- the runtime applied files but nothing created them;
- rule 14 told the AI to author SQL (older than D-109), while the D-109 renderer was dead code
  with no ADR;
- the example's migration history was already inconsistent (journal 0004 without snapshot, 0005/0006
  hand-added), so drizzle-kit could not even regenerate it;
- the generated project has no drizzle-kit and the model has no shell.

---

## 2. Target architecture

### 2.1 The release artifact

A release artifact is a deterministic, versioned bundle for a tag:

    { schemaVersion: 1,
      fromTag, toTag,
      fromDigest, toDigest,          // canonical declared-schema fingerprints
      planHash,                      // sha256 of the artifact body; approval is bound to this hash
      risk: "safe" | "careful" | "destructive" | "breaking",
      destructive: string[],         // ids of the batches that drop or lose data (the approval list)
      approved?: { by: string; at: string; hash: string },  // release-time approval, hash == planHash
      batches: [                     // ordered, one transaction per artifact
        { kind: "ddl"; id: string; sql: string; risk: RiskClass; requires?: string[] } ],
      problems: [],                  // anything the generator could not render -> release fails
      generatedBy, generatedAt }

Batches are ordered by the fixed phases of §2.5 and rendered by our generator from the two declared
snapshots. The artifact is stored by the release pipeline (CI artifact keyed by toTag); it is
**not committed**.

Generation needs no database: the pipeline checks out fromTag and toTag, imports each db/schema.ts
(Node build step, which already resolves the framework packages) plus facilis.config.ts, and emits
the snapshot pair. Where TypeScript loading is inconvenient, the build emits schema.json per tag and
the generator consumes the pair; P1 proves the loader.

### 2.2 Components

| Component | Where | Responsibility |
|---|---|---|
| Declared snapshot | @facilis.dev/db adapter (+ browser-safe types in @facilis.dev/core) | Extend snapshot.ts to the full DSL: table/composite PK, unique, FKs, indexes, enums, checks, identity, defaults normalized, policies with full SQL, RLS. |
| Live snapshot + digest | @facilis.dev/db | Extend live-schema.ts with FKs/indexes/checks/enums/identity, and a canonical digest(snapshot) shared with the declared side. The digest is used by Release Preview and dev reconcile. |
| Generator / renderer | @facilis.dev/core (pure, browser-safe) | planSchema(from, to) -> batches; deterministic ordering and quoting; the only place SQL text is produced. Moved from the orphaned D-109 renderer. |
| Release pipeline | CI step (Node) | For each new tag: resolve previous release tag, build both snapshots, generate the artifact, classify risk, fail on problems, require approval for destructive/breaking, publish the artifact. |
| IDE Release Preview | ide/src/facilis/release-* | Tag -> HEAD generated plan, SQL + risk, no DB; fail closed where the analyzer cannot resolve a declaration. |
| Dev boot | packages/nitro/src/runtime | Live PGlite -> declared reconcile at boot (dev only), same pure planner; disposable data. |

### 2.3 Flows

**Release (CI, no DB).**
    tag v2 created -> resolve previous release tag v1
    snapshots: schema(v1), schema(v2)   (build artifacts or checkout+import)
    artifact = planSchema(v1, v2); if problems -> fail the release
    risk = classify(artifact batches); publish artifact keyed by v2; attach SQL + risk to the release

**IDE dev (disposable).**
    boot: planSchema(live PGlite, declared schema) -> apply; snapshot before applying (D-052).
    The IDE never connects to test/prod.

Applying the artifact to a test/prod database is the release environment's/operator's job (D-204);
the framework ships no deploy flow.

### 2.5 Phased order inside an artifact

1. drop obsolete policies/constraints/indexes that must change (careful: they lose no data;
   removing or broadening a policy on a scoped table is a policy_unsafe problem instead);
2. create tables (columns, PK, defaults), add nullable columns, create enum types;
3. tighten columns (type, SET/DROP NOT NULL, defaults) - refused with data_needed when rows exist;
4. unique/check/FK constraints;
5. enable RLS + create/replace policies (a scoped table never exists without RLS, D-136);
6. indexes (non-concurrent; CONCURRENTLY is a non-goal for v1);
7. seed sync (roles/role_permissions projection from facilis.config.ts; @facilis.dev/auth seedStatements);
8. destructive drops - last, gated.

### 2.6 Approval (a release act)

Approval is a release act. The release pipeline produces the artifact; a human approves the
**destructive part** of that artifact, and the approval travels with it. Applying the artifact is
the release environment's/operator's job (D-204); the framework ships no deploy-side enforcement.

- **Bound to the hash.** The approval names the planHash and the destructive batch ids, so it cannot
  be swapped for a different SQL later.
- **Who approves.** A destructive or breaking artifact requires an explicit approval gate in the
  release pipeline (a protected environment / manual approval step, or a signed approval stored on
  the release). Safe/careful artifacts need none.
- **No silent destructive path.** Destructive batches exist only inside an artifact the release
  pipeline produced, listed by id and covered by the hash-bound approval.
- **Backups belong to the release environment.** The framework never runs a backup; taking one
  before applying a destructive artifact is the operator's responsibility.

Consequence: the same destructive artifact is exercised in test first, then approved and applied in
production by the release environment; the human act is the release approval.

---

## 3. Contracts

### 3.1 Canonical snapshot and digest

Extend declared (snapshot.ts) and live (live-schema.ts) to the same shape; a single canonical
serializer produces the digest both sides use. The live side must normalize what Postgres renders
(defaults, casts, quoting, composite PK order) - reuse schema-drift.ts canonicalization, add
normalizeDefault and tests for every DSL builder. The digest excludes _facilis_* bookkeeping tables
and non-public schemas. A digest mismatch is always fail-closed.

### 3.2 Artifact and gates

- problems are generated at release time: an unsupported declaration fails the release, never
  degrades silently.
- Risk classes reuse @facilis.dev/core's safe | careful | destructive | breaking; breaking keeps the
  route dbTables cross-check.
- Policy safety: a plan that would disable RLS on a scoped table, remove a policy without a
  replacement, or broaden a current_setting('app.*') predicate is a release failure.

### 3.4 Invariants preserved

- DDL is applied only from an owner/admin connection by the release environment/operator;
  production boot never runs DDL.
- Every table is exactly one access class (D-136); a scoped table cannot end a release without RLS.
- role_permissions stays a projection of facilis.config.ts, written only by provisioning/seed,
  never by authored SQL.
- No raw Drizzle client outside @facilis.dev/db; the Studio never reaches a database.
- Views are code (db/views/**), never authored migration files.
- The AI validator stops requiring authored SQL and blocks AI-authored db/migrations DDL.

---

## 4. Work breakdown

The vertical slice (P0 + P1 + P2 on one fixture) de-risked the generator before the rest.

### P0 - Contracts (docs only)
- ADRs: D-158 *generated migrations* (completes D-109) and D-159 *a release is a tag plus an
  immutable artifact* (supersedes D-086's schema-lens premise; its deploy-applier part was later
  withdrawn by D-204); note rule-14/config-sync retirement.
- Amend SPEC §2/§7.7/§8.3/§8.4.2/§9.3/§11.3/Appendix D; PATTERNS §5; APP-UPDATES §5; POSTGRES §4;
  the example README.
- Done in this branch. SPEC states the target contract: P4 makes the preview lens and its types
  match it (done 2026-11-20, #48), P5 the validator rules and the runtime.
- Exit: docs reviewed; no code.

### P1 - Snapshots, digest, artifact format
- Extend declared/live snapshots; canonical serializer + digest; schema.json per tag (build or
  checkout import); artifact schema + validation.
- Tests: declared <-> live = same digest on the example (PGlite + Postgres harness); digest stability.
- Exit: one tag pair produces a valid artifact; the example's digest round-trips on both drivers.

### P2 - Generator (release side, pure)
- Done: @facilis.dev/core planSchema(from, to) -> ordered batches (the §2.5 phases), per-batch risk,
  destructive ids, requires preconditions and machine problems; the D-109 renderer is ported
  here and the orphan deleted. The declared snapshot gained ordered PK, indexes, checks, unique
  constraints and enums (SPEC §7.3).
- Fail closed: enum value changes, identity/generated columns, partial/method-specific index
  shapes, PK changes, dangling FKs and policy broadening are problems with no batches, never
  silent SQL. A single expression index (`lower(email)`) is rendered verbatim; mixed or
  multi-expression shapes stay unsupported.
- Golden tests: empty -> target and add/drop/change for tables, columns, indexes, checks, FKs,
  policies, RLS and enums, plus a PGlite round-trip (plan SQL applied -> live digest == declared).
- Deferred to P4: the drizzle-kit oracle comparison (it needs the pipeline's Drizzle schema
  loader); digest v2 (FKs/indexes/checks/enums) was tied to the P3 fingerprint, which D-204
  withdraws. Renames are drop+create (destructive) in v1.
- Exit: deterministic artifacts; CI fails on unsupported declarations.

### P3 - Withdrawn (D-204)
Never built; withdrawn by D-204. Applying a release artifact to a production database is the
release environment's/operator's job.

### P4 - Release pipeline integration
- facilis release plan --from <tag> --to <tag> in CI: publish the artifact, attach SQL + risk to
  the release; tag discipline documented (a deployable release is a tag with an artifact).
- Release Preview: replace the migration-file lens with the generated tag -> HEAD plan (no DB);
  fail closed where the analyzer cannot resolve a declaration; keep the code <-> live lens (dev).
  *Landed 2026-11-20 (#48): the lens is `planSchema` over the two declared snapshots; the panel
  renders batches, per-batch and plan risk, destructive ids and fail-closed problems; the
  migration-file lens, the SQL splitter and the statement classifier are gone.*
- Exit: a tag produces a reviewed artifact; the IDE shows the same plan with no DB access.

### P5 - Dev/upgrade convergence and retirement of authored DDL
- Dev boot: live PGlite -> declared reconcile (dev only), replace migration replay; upgrade
  postflight uses the same call. *Additive slice landed (D-193): `schema-reconcile.ts` creates
  missing tables/columns/policies and applies a drop only when the user confirmed it. The replay
  that preceded it was removed in P6 (D-201).*
- examples/todo-app: remove the hand-written DDL (0000-0006), drop meta/ from the template, replace
  migrations.test.ts with "empty DB + artifacts == declared" and "preview plan == artifact"; add the
  CI gate.
- AI validator: rules 14/16 -> block authored DDL, require renderable schema.
- Exit: schema feature diffs contain no .sql; all gates green.

### P6 - Cleanup
- Landed 2026-11-19 (D-201): the runtime migration replay, the duplicated splitter and the
  template's drizzle.config.ts/db:generate are gone (drizzle-kit stays in the framework repo as
  the CI oracle).

---

## 5. Verification

- **Artifact chain**: empty DB + all artifacts in order -> digest(live) == digest(declared HEAD);
  any tag -> next artifact converges.
- **Refusals**: unsupported declarations and policy-unsafe plans fail the release with typed
  problems; nothing degrades silently.
- **Approval**: the approval is bound to planHash (a swapped artifact fails the binding); the
  destructive batch ids are listed explicitly in the artifact.
- **Idempotency**: a plan between identical snapshots produces 0 statements.
- **Oracle**: artifact SQL vs drizzle-kit generateMigration on fixtures (normalized), Node CI only.
- **Release preview == artifact**: tag -> HEAD plan in the IDE matches the pipeline artifact for the
  same tags (modulo documented analyzer limits, which fail closed).
- **Gates**: pnpm lint, typecheck, test, build; IDE smoke; 300-line limit; extended Postgres e2e.

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Digest normalization false positives | Canonical serializer + tests on both drivers; mismatch is fail-closed with a typed report. |
| Artifact store availability (CI artifacts) | The artifact can be regenerated deterministically from the tag pair and verified by its planHash. |
| Unapproved destructive SQL reaches production | Destructive batches are listed in the artifact and the approval is bound to planHash; applying the artifact is the operator's gated act (D-204). |
| Tag discipline (releases without tags) | Publishing a release always tags (documented); the artifact is keyed by tag, so no tag = no artifact. |
| Generator misses a manual DB change | The plan is tag -> tag by design; live drift is visible through the live snapshot/digest (dev reconcile), and applying artifacts is operator-owned (D-204). |
| Postgres DDL locks | The artifact is designed for one short transaction per artifact; statement timeouts and maintenance windows are the operator's concern; CONCURRENTLY out of scope. |
| Preview limitations in the browser | Fail closed on unresolved declarations; authoritative artifact from CI; no DB access needed. |
| Enum ALTER and identity columns | Fail closed with typed problems (unsupported_change / unsupported_declaration). |
| Renames | No rename detection in v1: a rename is drop+create, i.e. destructive and approval-gated. |

## 7. Decisions taken and still open

Taken (2026-11-10):
1. **Artifact storage**: CI artifacts keyed by tag. Not committed, not an OCI manifest.
2. **Destructive releases**: approval at release time bound to planHash; the destructive batch ids
   are listed in the artifact. See §2.6.
3. **Backup**: the release environment owns backups; the framework never runs one (D-204).
4. **Tag creation**: publishing a release creates the tag automatically.
5. **Data batches**: out of scope in v1; no db/data/ example ships. A plan that needs existing
   rows changed fails the release with data_needed (v1.1 reopens the question).
6. **Preview fidelity**: analyzer fail-closed in the IDE for v1; the CI artifact is authoritative.

Still open (owner defaults, not blocking P0-P2):
7. **Role removal**: keep stale roles rows (recommended; permissions still synced) vs delete.

## 8. What happens to today's artifacts

| Artifact | Today | After |
|---|---|---|
| db/migrations/*.sql (DDL) | authored (AI/user), replayed | retired; replaced by generated release artifacts |
| db/migrations/meta/* | stale drift source | removed from the template |
| drizzle.config.ts / db:generate | dev command | framework repo only, as CI oracle |
| drizzle-kit | example dependency | not a runtime dependency; test oracle |
| AI validator rules 14/16 | require a migration file | block authored DDL; require renderable schema |
| Release Preview schema lens | lists authored migration files | shows the generated tag -> HEAD plan |

## 9. ADRs and docs to change

- **D-158** (ADR A): *Schema DDL is generated at release time from the tag diff, never authored*
  (completes D-109; supersedes rule 14/config-sync; PATTERNS §5).
- **D-159** (ADR B): *A release is a tag plus an immutable artifact* (supersedes D-086's "show the
  SQL that ships" premise and the SPEC drizzle-kit migrate line). Its deploy-applier part (ledger,
  fingerprints, adopt/repair) was never built and is withdrawn by D-204.
- **D-204**: *The deploy applier is withdrawn; a release stays a tag plus an immutable artifact*
  (supersedes the deploy-applier part of D-159; applying an artifact is the release
  environment's/operator's job).
- Amend D-109, D-086, D-065/D-070 (upgrade DB step), D-136 (RLS in artifacts), D-052 (PGlite
  snapshot), D-078 (publish + tags).
- Amend SPEC §2/§7.7/§8.3/§8.4.2/§9.3/§11.3/Appendix D; PATTERNS §5; APP-UPDATES §5; POSTGRES §4;
  the example README; DEV.md in P5, when the dev replay retires.

---

**Acceptance of the shipped plan:** add a table/column by editing only db/schema.ts; the release
pipeline emits an SQL artifact with risk from the two tags, no DB involved; the IDE preview shows
the same plan without touching any database; dev boot reconciles the live PGlite schema to the
declaration; and the AI validator blocks authored DDL. Applying the artifact to a production
database is the release environment's/operator's job (D-204).
