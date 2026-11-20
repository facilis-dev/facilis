# D-107 — Background jobs: a durable queue on framework primitives, not Nitro's tasks
**Status:** accepted (2026-11-07); the job table declaration is amended by D-162

The user asked for background jobs: a configurable concurrency/retry/timeout budget; project code
that starts a job and optionally schedules it for a future instant; serialized input and output;
every run in a system context with the sudo audit; an id that `enqueue` returns so the caller can
read or cancel that instance; and read access to the running jobs and the queue. Jobs are
independent — chaining is a future "workflow" construct, not this feature. The project keeps its
own HTTP surface; the framework adds no route of its own.

**Decision.** No new package: the existing layer split owns the feature. `@facilis.dev/core` holds
the contract (`FacilisJobsConfig`, `defineJob`, `isJobDefinition`, `serializeJobData`,
`JobError`, `JobsApi`/`JobRecord`/`JobStatus`/`JobQueueStats`, the six-key `jobs` config
section), `@facilis.dev/db` the `facilis_jobs` table, `@facilis.dev/nitro` the runtime (virtual
module, registry, engine, stores, boot wiring, `ctx.jobs`). A new package would be another
tarball the IDE template must vendor and another version to pin.

- `facilis.config.ts` gains `jobs` with defaults `maxConcurrent: 2`, `maxAttempts: 1`,
  `retryDelayMs: 5000`, `timeoutMs: 30000`, `pollIntervalMs: 1000`, `persist: true`; a
  definition may override `maxAttempts`/`timeoutMs`. `maxAttempts: 1` keeps retry an opt-in:
  at-least-once delivery already makes a retry a business decision.
- Definitions are one default export per `server/jobs/**/*.ts`, scanned into the
  `#facilis/jobs` virtual module; an invalid or duplicate definition is a
  `job_definition_invalid` manifest warning and is skipped, never a boot failure.
- `input`/`output` are Zod schemas and both sides cross a JSON round-trip: invalid input at
  enqueue is `JobError("job_invalid_input")`, an invalid result fails the attempt
  (`job_invalid_output`). `enqueue` persists first and returns `{ id }` immediately.
- The queue is `facilis_jobs` (tenant-scoped RLS, re-exported by the project's `db/schema.ts`,
  created by a Drizzle migration). With `persist: true` it survives a worker reload or process
  restart; `start()` recovers rows left `running` — re-queued while attempts remain, else
  `failed` with an `interrupted` error. Without the table the engine degrades to the in-memory
  store plus a `jobs_table_missing` warning; a runtime that cannot start is a
  `jobs_boot_failed` warning. Boot never fails because of jobs.
- Every attempt runs through `runAsSystem` in its own transaction as `facilis_system`, with
  actor `system:job:<name>`, operation `jobs:<name>`, the definition's `tables` and the same
  audit sink as `ctx.sudo` (D-099). `runAsSystem` is relaxed to accept `tables: []` when a job
  declares no audit tables; `ctx.sudo`/`ctx.system` keep the non-empty subset rule.
- `JobsApi` is exposed only as `ctx.jobs` on an authorized handler (and on the request event
  for framework middleware): enqueue/get/list/queue/running/cancel/stats. There is no HTTP
  surface behind it; a project writes its own `defineAuthorizedHandler` route with a permission,
  a body schema and `dbTables`, exactly as the example app does.
- A route always has `ctx.jobs`. If the runtime failed to boot, the middleware omits
  `facilis.jobs` and the wrapper substitutes an unavailable API: every call rejects with
  `JobError("job_unavailable")` (added to `JOB_ERROR_CODES`). The route keeps serving — a route
  that never touches jobs is unaffected, and one that calls the API handles the coded failure
  rather than a framework-wide 500. `unavailableJobs()` stays internal; only the code is public
  through `JobError`, and the boot failure is the `jobs_boot_failed` manifest warning.
- Jobs are independent: the job context exposes no `enqueue`, so no chain is expressible and no
  workflow engine is added.

**Rejected alternatives.** *Nitro's own task system* — the primary alternative, evaluated before
the decision; `docs/JOBS.md` §3 records the pinned `nitro@3.0.260903-beta` evidence in full and
is not duplicated here. In short: `runTask` dedupes by task name and returns the same in-flight
promise, so two independent instances cannot exist; no row/id/status/retry/timeout/cancellation
exists, so there is nothing to inspect or stop; `scheduledTasks` is a static cron map, not "run at
this instant"; `payload` and result are untyped with no schema; a task is an arbitrary function
with no system role, transaction or audit; the `nitro-dev` preset mounts an unauthenticated
`/_nitro/tasks/**` execution route with no origin allowlist (against §8.5/invariant 6); and
`experimental.tasks` is process-local, so nothing survives the worker reloads the IDE triggers on
every project edit. *A new `@facilis.dev/jobs` package*: more tarball/template churn for a seam the
three existing packages already expose. *An in-memory-only queue*: loses scheduled work on every
worker reload, which is exactly when a queue matters. *Workflow/chaining inside the engine*: a job
graph is a different product surface (O-017); the durable claim/attempt counters are the seam a
later construct reuses.

**Consequences.** Delivery is at-least-once: a worker crash or timeout can run an attempt again,
so job bodies must be idempotent. A timeout aborts the attempt's `AbortSignal`; JavaScript cannot
kill a function, so the signal is the contract — a job that ignores it keeps running after the
engine has moved on. The engine assumes one long-lived server process per database (no
multi-instance claim, no serverless scheduling guarantee). PGlite is single-connection, so a
handler's `ctx.jobs` is bound to the request's policy transaction (`JobsApi.bindScope` /
`JobStore.scoped`); queue calls join that transaction instead of opening a nested one, which
would deadlock the request. The generated app's schema gains
`facilis_jobs`, so previously created projects need a migration. A broken queue degrades to
`job_unavailable` on `ctx.jobs` calls, not to a failing route. New manifest warnings:
`job_definition_invalid` (bad/duplicate definition), `jobs_table_missing` (persistence
requested, table absent), `jobs_boot_failed` (runtime could not start) and
`jobs_runtime_error` (scheduler/store failure during a tick, reported once per context).

**Verification.** `@facilis.dev/nitro` suites `src/runtime/jobs/engine.test.ts` (concurrency cap,
retry delay, timeout via an injected `JobTimers`, queued/running cancellation, schedule, stats,
stop/requeue, output-schema failure), `memory-store.test.ts`, `definitions.test.ts`
(dedupe/warnings), `db-store.test.ts` + `db-store-recovery.test.ts` (PGlite + RLS claim
round-trips, interrupted recovery, counts),
`executor.test.ts` (system role reads a row RLS hides from `facilis_app`, audit actor/tables),
`runtime.test.ts` (`runAt`/`delayMs` mapping, ISO records, `maxConcurrent` in stats,
`bindScope` delegation), `engine-scoped.test.ts` (the scoped view shares scheduler state),
`boot.test.ts` (store choice and warnings) plus `module.test.ts` (`#facilis/jobs`
registration); `db-store.test.ts` also pins the request-transaction join (the nested-`BEGIN`
deadlock regression); `@facilis.dev/db/src/sudo.test.ts` accepts `tables: []` for `runAsSystem` and
still rejects an empty string. The example app exercises it end-to-end in
`examples/todo-app/scripts/verify-headless.sh`: enqueue with a future `runAt`, read it back
`queued`, cancel it, read it back `cancelled`. The Lead's final root gates
(`lint`/`typecheck`/`test`/`build`) are the release check.
