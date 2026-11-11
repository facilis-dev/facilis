# Migration generation in the release and deploy pipeline

**Status:** proposed, v2.3 (a plan, not a contract). 2026-11-10. Decisions 1-6 taken in §7 (7-8 open).
ADRs D-158/D-159 accepted; P0, P1 and P2 implemented (branches feat/schema-artifacts, feat/schema-plan).
**Goal:** schema DDL is never authored by the AI or the user. It is **generated from the release
tags** (in the release pipeline, no database access) and **applied as an immutable artifact** by the
deploy job. The live database is used for **verification**, and only exceptionally for adoption or
repair - never as the generator.

v2 changes the model after review: generation must not depend on the live database (the IDE and the
release pipeline cannot see prod/test), so the **tag -> tag diff is the primary path**, like a
classic migration but machine-generated. The live catalog remains a safety check (fingerprint) and
an explicit rescue tool.

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
  generated for test/prod.
- **Deploy = ledger + ordered artifacts + fingerprints.** The deploy job reads which release the
  database is at (ledger), applies the pending artifacts in order, and verifies before and after
  each one with a schema fingerprint. The same artifact is applied in every environment, so test
  and prod cannot silently diverge.
- **The IDE never touches a database.** Its Release Preview computes the same tag -> HEAD plan from
  the git tree (it already reads refs this way) and shows SQL + risk. The authoritative artifact
  comes from the release pipeline.
- **The live catalog is a check, not a generator.** It is read by the deploy job (which already has
  owner credentials to apply DDL) to verify that the database is where the ledger says it is. If it
  is not, the deploy refuses. facilis db adopt / facilis db repair are explicit one-time
  operations for databases with no ledger or with drift.
- **Approval is a release act, not a deploy flag.** A destructive artifact carries its destructive
  batch list and an approval bound to its hash; test/staging may run it (the release environment
  has a backup), production requires the approval. The deploy itself stays unattended. See §2.6.
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
clean "from". v2 handles that with the ledger (the database knows its release), fingerprints (the
deploy verifies it), and explicit adoption/repair (for the residual cases).

Evidence that the tag path is the right one is already in the repo: Release Preview reads git refs
without booting them (ide/src/facilis/release-git.ts, D-086/D-094), so the IDE can show the
tag -> HEAD plan with no DB. What does not exist yet is the tag -> tag generator and the deploy
applier.

Existing gaps that this plan removes (unchanged from v1):
- the runtime applies files but nothing creates them;
- rule 14 still tells the AI to author SQL (older than D-109), while the D-109 renderer is dead code
  with no ADR;
- the example's migration history is already inconsistent (journal 0004 without snapshot, 0005/0006
  hand-added), so drizzle-kit cannot even regenerate it;
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
**not committed**, and the deploy stores its hash in the ledger.

Generation needs no database: the pipeline checks out fromTag and toTag, imports each db/schema.ts
(Node build step, which already resolves the framework packages) plus facilis.config.ts, and emits
the snapshot pair. Where TypeScript loading is inconvenient, the build emits schema.json per tag and
the generator consumes the pair; P1 proves the loader.

### 2.2 Components

| Component | Where | Responsibility |
|---|---|---|
| Declared snapshot | @facilis/db adapter (+ browser-safe types in @facilis/core) | Extend snapshot.ts to the full DSL: table/composite PK, unique, FKs, indexes, enums, checks, identity, defaults normalized, policies with full SQL, RLS. |
| Live snapshot + digest | @facilis/db | Extend live-schema.ts with FKs/indexes/checks/enums/identity, and a canonical digest(snapshot) shared with the declared side. Used for the deploy fingerprint and adopt/repair only. |
| Generator / renderer | @facilis/core (pure, browser-safe) | planSchema(from, to) -> batches; deterministic ordering and quoting; the only place SQL text is produced. Moved from the orphaned D-109 renderer. |
| Release pipeline | CI step (Node) | For each new tag: resolve previous release tag, build both snapshots, generate the artifact, classify risk, fail on problems, require approval for destructive/breaking, publish the artifact. |
| Deploy applier | @facilis/db/bin | facilis db deploy/status/adopt/repair: ledger, ordered pending artifacts, fingerprint pre/post checks, lock, backup_ref gate, transaction per artifact, post-steps (seed, ensureAppRole, ensureSystemRole, views). |
| IDE Release Preview | ide/src/facilis/release-* | Tag -> HEAD generated plan, SQL + risk, no DB; fail closed where the analyzer cannot resolve a declaration. |
| Dev boot | packages/nitro/src/runtime | Live PGlite -> declared reconcile at boot (dev only), same pure planner; disposable data. |

### 2.3 Flows

**Release (CI, no DB).**
    tag v2 created -> resolve previous release tag v1
    snapshots: schema(v1), schema(v2)   (build artifacts or checkout+import)
    artifact = planSchema(v1, v2); if problems -> fail the release
    risk = classify(artifact batches); publish artifact keyed by v2; attach SQL + risk to the release

**Deploy (test or prod; owner connection; no generation).**
    facilis db deploy --release v2 --backup-ref <ref>
    ledger   = applied releases in _facilis_deploy_runs (restored with the DB backup)
    pending  = artifacts from ledger's release (exclusive) to v2, in tag order
    for each artifact:
        begin
        approval: destructive/breaking -> approved.hash == planHash AND environment policy allows
                  it, else refuse (no per-deploy human flag on the release path; see §2.6)
        preflight: digest(live) == artifact.fromDigest, else refuse (drift -> adopt/repair)
        requirements: row counts for NOT NULL/narrowing batches (missing data -> data_needed)
        backup: destructive artifacts need --backup-ref from the release env; refuse without it
        apply batches
        post-check: digest(live) == artifact.toDigest, else rollback and refuse
        insert ledger row (release, planHash, digests, statements, approval_ref, backup_ref)
        commit
        post-steps: seed from config, ensureAppRole, ensureSystemRole, views
    final: status report; exit non-zero on refusal

**Unknown / existing database (one-time).**
    facilis db adopt  --release vX   # verify digest(live) == declared(vX), record baseline, no DDL
    facilis db repair --release vX --backup-ref <ref> [--allow-destructive]
                                    # explicit live -> declared plan, like v1, with a backup_ref + report;
                                    # recorded as a repair run, never as a release artifact
    Both are human operations; --allow-destructive exists only here (break-glass), never on the
    release path.

**IDE dev (disposable).**
    boot: planSchema(live PGlite, declared schema) -> apply; snapshot before applying (D-052).
    The IDE never connects to test/prod.

### 2.4 State handling (the ledger is the state)

| State | How it is seen | Result |
|---|---|---|
| Empty DB | no ledger row | bootstrap: first artifact has fromDigest = empty digest, applied in order |
| At a release | ledger says vX; digest matches | apply vX+1..vN |
| Older (several releases behind) | ledger says vX; pending list computed from tags | apply in order, one transaction per artifact |
| Restored backup | the ledger travels with the backup | pending = artifacts after the restored ledger release; re-applied |
| Partially failed deploy | last artifact has no ledger row; digest of the failed artifact's from | transaction rolled back; pending recomputed; converges |
| Newer / rolled back | ledger says vN, target vM < vN | no downgrade by default; refuse and explain; restore the backup or ship a forward artifact |
| Drifted (manual DDL, extra objects) | digest(live) != artifact.fromDigest | **refuse** with a typed drift report; facilis db repair is the explicit way |
| Adopted (data, no ledger) | no ledger | facilis db adopt --release <current> verifies the digest and records the baseline |
| Wrong role / no owner rights | connection check | fail before any DDL |
| Concurrent deploy | advisory lock | second exits deploy_locked |
| Data needed (NOT NULL / narrowing) | artifact requires + row counts at preflight | refuse before DDL with data_needed; backfills are out of scope in v1 (decision 5) |

There is no silent destructive path: destructive batches exist only inside an artifact the release
pipeline produced, and the deploy only runs them when the environment policy allows it, the artifact
is approved, and a backup pointer is recorded.

### 2.5 Phased order inside an artifact

1. drop obsolete policies/constraints/indexes that must change (careful: they lose no data;
   removing or broadening a policy on a scoped table is a policy_unsafe problem instead);
2. create tables (columns, PK, defaults), add nullable columns, create enum types;
3. tighten columns (type, SET/DROP NOT NULL, defaults) - refused with data_needed when rows exist;
4. unique/check/FK constraints;
5. enable RLS + create/replace policies (a scoped table never exists without RLS, D-136);
6. indexes (non-concurrent; CONCURRENTLY is a non-goal for v1);
7. seed sync (roles/role_permissions projection from facilis.config.ts; @facilis/auth seedStatements);
8. destructive drops - last, gated.

### 2.6 Approval and environment policy

Approval and execution are separate acts. The release pipeline produces the artifact; a human
approves the **destructive part** of that artifact; the deploy executes it unattended, only when the
approval and the environment policy allow it.

- **Bound to the hash.** The approval names the planHash and the destructive batch ids, so it cannot
  be swapped for a different SQL later.
- **Who approves.** A destructive or breaking artifact requires an explicit approval gate in the
  release pipeline (a protected environment / manual approval step, or a signed approval stored on
  the release). Safe/careful artifacts need none.
- **What the deploy checks.** artifact.approved.hash == planHash, the environment policy allows
  destructive, and the artifact's destructive batch ids are exactly the approved ones. Any mismatch
  is a refusal, never a warning.
- **Environment policy**, declared in the deploy config: destroy: "deny" | "approval" | "allow".
  Recommended: test/staging = allow (so the same destructive SQL is exercised before prod, still
  with a backup), production = approval, deny where the company forbids data-losing DDL. A CI token
  can never raise the policy; it can only run what the policy already permits.
- **Backup belongs to the release environment.** The deploy never runs a backup: for a destructive
  artifact it requires a backup_ref (the release environment produces the backup before invoking
  the deploy) and records it in the ledger; without the pointer it refuses. The deploy documents
  the hook, it does not implement the backup.
- **Break-glass** (--allow-destructive) is only for adopt/repair, is a human action, and is recorded
  as such. The release path never needs a human at deploy time.

Consequence: the destructive migration is proven in test first (same artifact), then approved and
applied in production; the human act is the release approval, not a per-deploy flag.

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
- Risk classes reuse @facilis/core's safe | careful | destructive | breaking; breaking keeps the
  route dbTables cross-check.
- Policy safety: a plan that would disable RLS on a scoped table, remove a policy without a
  replacement, or broaden a current_setting('app.*') predicate is a release failure.

### 3.3 Ledger, lock, backup

- _facilis_deploy_runs(id, release, plan_hash, from_digest, to_digest, status, statements,
  approval_ref, backup_ref, started_at, finished_at); one row per applied artifact.
- Advisory lock on the deploy connection (Postgres); PGlite/IDE rely on the single connection plus
  the project Web Lock (D-033).
- Backup: the release environment runs its own backup hook and passes --backup-ref; the deploy
  verifies the pointer for destructive artifacts and stores it in the ledger. Dev PGlite needs
  none: the data is disposable.

### 3.4 Invariants preserved

- DDL only from the owner/admin connection at deploy time; production boot never runs DDL.
- Every table is exactly one access class (D-136); a scoped table cannot end a release without RLS.
- role_permissions stays a projection of facilis.config.ts, written only by the deploy/seed step.
- No raw Drizzle client outside @facilis/db; the Studio never reaches a database.
- Views are code (db/views/**), applied after the artifact like today.
- The AI validator stops requiring authored SQL and blocks AI-authored db/migrations DDL.

---

## 4. Work breakdown

A vertical slice (P0 + P1 + P2 + a minimal P3 on one fixture) de-risks before the rest.

### P0 - Contracts (docs only)
- ADRs: D-158 *generated migrations* (completes D-109) and D-159 *release artifacts + ledger, live
  catalog as verification only* (supersedes D-086's schema-lens premise); note rule-14/config-sync
  retirement.
- Amend SPEC §2/§7.7/§8.3/§8.4.2/§9.3/§11.3/Appendix D; PATTERNS §5; APP-UPDATES §5; POSTGRES §4;
  the example README.
- Done in this branch. SPEC states the target contract: P4 makes the preview lens and its types
  match it, P5 the validator rules and the runtime.
- Exit: docs reviewed; no code.

### P1 - Snapshots, digest, artifact format
- Extend declared/live snapshots; canonical serializer + digest; schema.json per tag (build or
  checkout import); artifact schema + validation.
- Tests: declared <-> live = same digest on the example (PGlite + Postgres harness); digest stability.
- Exit: one tag pair produces a valid artifact; the example's digest round-trips on both drivers.

### P2 - Generator (release side, pure)
- Done: @facilis/core planSchema(from, to) -> ordered batches (the §2.5 phases), per-batch risk,
  destructive ids, requires preconditions and machine problems; the D-109 renderer is ported
  here and the orphan deleted. The declared snapshot gained ordered PK, indexes, checks, unique
  constraints and enums (SPEC §7.3).
- Fail closed: enum value changes, identity/generated columns, advanced index shapes, PK
  changes, dangling FKs and policy broadening are problems with no batches, never silent SQL.
- Golden tests: empty -> target and add/drop/change for tables, columns, indexes, checks, FKs,
  policies, RLS and enums, plus a PGlite round-trip (plan SQL applied -> live digest == declared).
- Deferred to P4: the drizzle-kit oracle comparison (it needs the pipeline's Drizzle schema
  loader); digest v2 (FKs/indexes/checks/enums) lands with the P3 fingerprint. Renames are
  drop+create (destructive) in v1.
- Exit: deterministic artifacts; CI fails on unsupported declarations.

### P3 - Deploy applier + CLI
- Ledger, pending resolution, fingerprint pre/post check, requirements (row counts), lock, backup_ref gate,
  transaction per artifact, post-steps; facilis db deploy/status/adopt/repair.
- Tests: matrix of §2.4, idempotent re-run, interrupted deploy, drift refusal, adopt, repair,
  deploy_locked, PGlite + Postgres e2e (extend scripts/postgres-e2e.mjs).
- Exit: one command takes any §2.4 state to the target, or refuses with a typed report.

### P4 - Release pipeline integration
- facilis release plan --from <tag> --to <tag> in CI: publish the artifact, attach SQL + risk to
  the release; tag discipline documented (a deployable release is a tag with an artifact).
- Release Preview: replace the migration-file lens with the generated tag -> HEAD plan (no DB);
  fail closed where the analyzer cannot resolve a declaration; keep the code <-> live lens (dev).
- Exit: a tag produces a reviewed artifact; the IDE shows the same plan with no DB access.

### P5 - Dev/upgrade convergence and retirement of authored DDL
- Dev boot: live PGlite -> declared reconcile (dev only), replace migration replay; upgrade
  postflight uses the same call.
- examples/todo-app: remove the hand-written DDL (0000-0006), drop meta/ from the template, replace
  migrations.test.ts with "empty DB + artifacts == declared" and "preview plan == artifact"; add the
  CI gate.
- AI validator: rules 14/16 -> block authored DDL, require renderable schema.
- Exit: schema feature diffs contain no .sql; all gates green.

### P6 - Cleanup
- Remove runtime migration replay, the duplicated splitter, the POSTGRES §4 snippet, the template's
  drizzle.config.ts/db:generate (kept in the framework repo as CI oracle).

---

## 5. Verification

- **Artifact chain**: empty DB + all artifacts in order -> digest(live) == digest(declared HEAD);
  any tag -> next artifact converges; ledger restored with a backup resumes correctly.
- **Refusals**: drift, missing backfill, destructive without approval or outside policy, no backup,
  concurrent deploy, wrong role - nothing changes.
- **Approval**: unapproved destructive artifact refused; deny/approval/allow policies; approval
  bound to planHash (a swapped artifact fails).
- **Idempotency**: re-run a fully applied release = 0 statements.
- **Oracle**: artifact SQL vs drizzle-kit generateMigration on fixtures (normalized), Node CI only.
- **Release preview == artifact**: tag -> HEAD plan in the IDE matches the pipeline artifact for the
  same tags (modulo documented analyzer limits, which fail closed).
- **Gates**: pnpm lint, typecheck, test, build; IDE smoke; 300-line limit; extended Postgres e2e.

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Digest normalization false positives block deploys | Canonical serializer + tests on both drivers; mismatch is fail-closed with a typed report; adopt/repair exist. |
| Artifact store availability (CI artifacts) | The deploy can regenerate deterministically from the tag pair and verify the hash; the ledger keeps the hash either way. |
| Unapproved destructive SQL reaches production | Approval bound to planHash, environment policy, backup_ref gate; approval_ref and backup_ref recorded in the ledger. |
| Tag discipline (users who deploy without tags) | Deploy requires a release tag + artifact; publishing a release always tags (documented); no tag = no deploy. |
| Generator misses a manual DB change | Fingerprint preflight catches it; repair is explicit and backed up. |
| Postgres DDL locks | One short transaction per artifact, statement timeout, maintenance window; CONCURRENTLY out of scope. |
| Preview limitations in the browser | Fail closed on unresolved declarations; authoritative artifact from CI; no DB access needed. |
| Legacy projects | adopt (verify) or repair (explicit reconcile, backup), never silent replay. |
| Enum ALTER and identity columns | Fail closed with typed problems (unsupported_change / unsupported_declaration); v2 adds ALTER TYPE and identity rendering. |
| Renames | No rename detection in v1: a rename is drop+create, i.e. destructive and approval-gated. |

## 7. Decisions taken and still open

Taken (2026-11-10):
1. **Artifact storage**: CI artifacts keyed by tag. Not committed, not an OCI manifest.
2. **Destructive deploy**: approval at release time bound to planHash + environment policy
   (test/staging allow, production approval, backup required); --allow-destructive is break-glass
   for adopt/repair only, never the release path. See §2.6.
3. **Backup**: the release environment owns the backup hook and passes --backup-ref; the deploy
   requires and records the pointer for destructive artifacts and never runs a backup itself.
4. **Tag creation**: publishing a release creates the tag automatically.
5. **Data batches**: out of scope in v1; no db/data/ example ships. A plan that needs existing
   rows changed fails the release with data_needed (v1.1 reopens the question).
6. **Preview fidelity**: analyzer fail-closed in the IDE for v1; the CI artifact is authoritative.

Still open (owner defaults, not blocking P0-P2):
7. **Legacy DBs**: adopt-only (recommended) vs repair allowed by default.
8. **Role removal**: keep stale roles rows (recommended; permissions still synced) vs delete.

## 8. What happens to today's artifacts

| Artifact | Today | After |
|---|---|---|
| db/migrations/*.sql (DDL) | authored (AI/user), replayed | retired; replaced by generated release artifacts |
| db/migrations/meta/* | stale drift source | removed from the template |
| drizzle.config.ts / db:generate | dev command | framework repo only, as CI oracle |
| drizzle-kit | example dependency | not a runtime dependency; test oracle |
| AI validator rules 14/16 | require a migration file | block authored DDL; require renderable schema |
| Release Preview schema lens | lists authored migration files | shows the generated tag -> HEAD plan |
| Deploy step | documented one-liner | facilis db deploy (ledger + artifacts + fingerprints) |

## 9. ADRs and docs to change

- **D-158** (ADR A): *Schema DDL is generated at release time from the tag diff, never authored*
  (completes D-109; supersedes rule 14/config-sync; PATTERNS §5).
- **D-159** (ADR B): *A release is a tag plus an immutable artifact; deploys apply artifacts with a
  ledger and schema fingerprints; the live catalog is verification and repair only* (supersedes
  D-086's "show the SQL that ships" premise and the SPEC drizzle-kit migrate line).
- Amend D-109, D-086, D-065/D-070 (upgrade DB step), D-136 (RLS in artifacts), D-052 (PGlite
  snapshot), D-078 (publish + tags).
- Amend SPEC §2/§7.7/§8.3/§8.4.2/§9.3/§11.3/Appendix D; PATTERNS §5; APP-UPDATES §5; POSTGRES §4;
  the example README; DEV.md in P5, when the dev replay retires.

---

**Acceptance of the whole plan:** add a table/column by editing only db/schema.ts; the release
pipeline emits an SQL artifact with risk from the two tags, no DB involved; the deploy applies it to
an empty, behind, restored or adopted database and refuses on drift, with the same SQL in test and
prod; a second run reports zero statements; the IDE preview shows the same plan without touching any
database; and the AI validator blocks authored DDL.
