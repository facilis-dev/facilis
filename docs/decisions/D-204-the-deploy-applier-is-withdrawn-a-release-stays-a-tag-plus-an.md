# D-204 — The deploy applier is withdrawn; a release stays a tag plus an immutable artifact
**Status:** accepted (2026-11-24)

**Context.** D-159 (2026-11-10) specified two things: a release is a tag plus an immutable
schema-diff artifact, and a deploy applier applies those artifacts behind a ledger. Only the
first was built. The release-time planner ships in `packages/core/src/schema-plan/`, the
canonical digest in `packages/db/src/schema-digest.ts` (the implemented part of D-158), the IDE
Release Preview renders the tag -> HEAD plan without a database, and dev boot reconciles the
live PGlite schema to the declared one. The applier was never built: `packages/db` has no
`bin`/CLI and no `_facilis_deploy_runs` table exists.

**Decision.** Withdraw the unimplemented deploy-applier surface: the `facilis db
deploy/status/adopt/repair` CLI, the `_facilis_deploy_runs` ledger, the deploy-time fingerprint
preflight/post-check, and the adopt/repair operations. The documentation describes only what
ships — the release-time DDL artifact and schema digest (D-158), Release Preview, and dev-boot
reconcile. This supersedes the deploy-applier part of D-159; the release-artifact part stays in
force. D-159's file is kept unchanged (decisions are append-only).

**Consequences.** POSTGRES.md §4/§7, PATTERNS.md §5, STATUS.md and MIGRATION-PLAN.md §2.2 no
longer present the applier as runnable. Applying a release artifact to a production database is
the release environment's/operator's job: the artifact is immutable CI output keyed by tag, and
nothing in the framework executes it at deploy time today. If a deploy applier is wanted later,
file a feature-request issue and a new decision — never an edit of D-159.
