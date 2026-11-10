# Background jobs — design

**Status:** implemented (D-107). This document is the design reference behind SPEC §5.6,
§7.1 and §7.9: the contract, the runtime semantics and the rejected alternatives, including
the evaluation of Nitro's own task system requested before the feature was accepted.

## 1. What the feature must do

From the request:

1. A config setting defines the maximum number of jobs in parallel, retries, and the rest.
2. Project code can start a job and/or schedule it at an instant in the future.
3. A job receives serialized input data, always runs in a **system context**, and returns
   serialized data.
4. Creating a job returns an **id** usable to check it or force it to stop.
5. Jobs are launched and managed **only in a system context**.
6. Functions exist to read the running jobs, the queue, and the rest of the state.
7. Jobs are independent: chaining is a future "workflow" construct, out of scope.

## 2. Placement — no new package

The feature reuses the existing layer split instead of adding a `@facilis/jobs` tarball
(the generated project ships framework packages as vendored tarballs, so a new package would
also change the IDE template):

| Layer | Owns |
|---|---|
| `@facilis/core` | The public contract: `FacilisJobsConfig`, `defineJob`, `JobsApi`, `JobRecord`, `JobError`, serialization, route-context `ctx.jobs`. |
| `@facilis/db` | The `facilis_jobs` table (schema + RLS), re-exported by the project's `db/schema.ts` so migrations own it. |
| `@facilis/nitro` | The runtime: `#facilis/jobs` virtual module, definition registry, scheduler engine, stores, boot wiring, `ctx.jobs` injection. |

## 3. Nitro's task system — evaluated, not adopted

Nitro v3 ships an experimental task system: `server/tasks/**` scanned when
`experimental.tasks` is on, `defineTask`/`runTask` from `nitro/task`, and
`scheduledTasks` cron strings in the Nitro config. It was evaluated against the
requirements above and rejected as the job runtime. Evidence is the pinned
`nitro@3.0.260903-beta` source under `packages/nitro/node_modules/nitro/dist`:

- **Deduplicated by task name.** `runTask` keeps one in-flight promise per name and returns
  it to every caller (`runtime/internal/task.mjs`: `if (__runningTasks__[name]) return
  __runningTasks__[name]`). Two independent instances of the same job with different
  payloads cannot run, with themselves or in parallel — requirement 7.
- **No queue, id, status, retry, timeout or cancellation.** `runTask` invokes the handler
  and returns its result: no record is created, so there is nothing to list, inspect or stop
  — requirements 2, 4, 6.
- **Scheduling is static cron, not "at instant X".** `scheduledTasks` is a Nitro config map
  (`cron expression -> task names`) started by `startScheduleRunner` with `croner`;
  project code cannot schedule a one-shot run at a chosen future instant — requirement 2.
- **No serialization/validation contract.** `payload` is `Record<string, unknown>` and the
  result is `{ result?: RT }` with no schema, no JSON round-trip and no typed contract —
  requirement 3.
- **No system context, no audit.** A task is an arbitrary function; there is no
  `runAsSystem` wrapper, no `facilis_system` role and no sudo-audit entry, so a task that
  touches the DB runs as the connecting role — requirement 3/5.
- **A dev HTTP surface we must not expose.** The `nitro-dev` preset mounts
  `/_nitro/tasks/**` unconditionally (`_presets.mjs`; handler in
  `runtime/internal/routes/dev-tasks.mjs`): `GET/POST /_nitro/tasks/:name` executes a task
  with an arbitrary payload, unauthenticated, with no origin allowlist — against SPEC §8.5
  and invariant 6.
- **Experimental + process-local.** It is behind `experimental.tasks`, scans
  `server/tasks`, and `runTask` state is an in-process object; nothing persists or
  recovers across the Nitro worker reloads the IDE triggers on every project edit.

**Decision.** Do not enable `experimental.tasks` and do not import `nitro/task`. Keep the
one convention that fits this repo — **named, server-side definitions in a scanned folder, one
default export per file** — and implement the queue on framework primitives (Drizzle,
`runAsSystem`, Zod, config), which the requirements need anyway.

## 4. Config

`facilis.config.ts` gains a `jobs` section (`FacilisJobsConfig`); every key has a default:

| Key | Default | Meaning |
|---|---|---|
| `maxConcurrent` | `2` | Attempts executing at the same time. |
| `maxAttempts` | `1` | Total attempts including the first; `1` = no retry. |
| `retryDelayMs` | `5000` | Fixed delay before a retry (exponential backoff is an open question). |
| `timeoutMs` | `30000` | Wall-clock bound of one attempt. |
| `pollIntervalMs` | `1000` | Scheduler tick (also bounded by "enqueue wakes the tick"). |
| `persist` | `true` | Keep queue state in `facilis_jobs`; `false` uses the in-memory store. |

A definition may override `maxAttempts` and `timeoutMs`; otherwise the config applies.

## 5. Definition contract

```ts
// server/jobs/purge-completed-todos.ts — one default export per file.
import { z } from "zod";
import { defineJob } from "@facilis/core";
import { todos } from "~/db/schema";

export default defineJob({
  name: "purge-completed-todos",
  input: z.object({ olderThanDays: z.number().int().positive().default(7) }),
  output: z.object({ deleted: z.number().int() }),
  tables: ["todos"],        // sudo-audit tables; [] for a job that reads none
  maxAttempts: 3,           // optional override of jobs.maxAttempts
  timeoutMs: 10_000,        // optional override of jobs.timeoutMs
  async run({ data, db, signal, jobId, attempt }) {
    // db is the SYSTEM-scoped transaction (facilis_system, BYPASSRLS).
    return { deleted: 0 };
  },
});
```

- `name` is the enqueue key, unique across the registry.
- `input`/`output` are Zod schemas; both sides are parsed and must survive a JSON
  round-trip (`JobJson`). Invalid input at enqueue is a `JobError` with code
  `job_invalid_input`; an invalid output fails the attempt (`job_invalid_output`).
- Definitions live in `server/jobs/**/*.ts` (nested directories allowed; `.test.ts`
  ignored) and are loaded through the `#facilis/jobs` virtual module. An invalid or
  duplicate definition becomes a `job_definition_invalid` manifest warning and is skipped;
  it never breaks boot.
- Every definition runs through `runAsSystem(db, { actor: "system:job:<name>", operation:
  "jobs:<name>", reason, tables }, fn)`: its own transaction as `facilis_system`, audited
  started/succeeded/failed on the sudo-audit sink. `runAsSystem` accepts `tables: []`
  (the job counterpart of a route's `dbTables` subset); `ctx.sudo`/`ctx.system` keep
  requiring a non-empty subset.

## 6. Runtime API — server-only

`defineAuthorizedHandler` exposes `ctx.jobs` (`JobsApi`). There is **no HTTP endpoint**
to enqueue, list or cancel jobs: the API is reachable only from server code, which is what
"launched and managed in a system context" means at the boundary. A project that wants an
authenticated surface writes a normal `defineAuthorizedHandler` route with its own
permission + Zod body and calls `ctx.jobs` (the example app does exactly that).

```ts
interface JobsApi {
  enqueue(name: string, data: unknown, options?: { runAt?: string | Date; delayMs?: number }): Promise<{ id: string }>;
  get(id: string): Promise<JobRecord | null>;
  list(options?: { status?: JobStatus | JobStatus[]; name?: string; limit?: number }): Promise<JobRecord[]>;
  queue(): Promise<JobRecord[]>;     // status "queued", run_at ascending
  running(): Promise<JobRecord[]>;   // status "running"
  cancel(id: string): Promise<boolean>;
  stats(): Promise<JobQueueStats>;
  bindScope?(scope: PolicyScopedDatabase): JobsApi;   // framework plumbing, see §8
}
```

- A route always has `ctx.jobs`. If the runtime failed to boot (the `jobs_boot_failed` manifest
  warning), the context middleware omits `facilis.jobs` and `defineAuthorizedHandler` substitutes
  an unavailable API: every call rejects with `JobError` code `job_unavailable`. A route that
  does not touch jobs is unaffected by a broken queue; a route that calls `ctx.jobs` can catch
  the coded error and answer with its own failure code. The framework never turns a broken queue
  into a framework-wide 500. `unavailableJobs()` is internal — only the code is public through
  `JobError`.
- `ctx.jobs` is bound to the request's policy-scoped transaction (`bindScope`):
  queue calls join the transaction the handler already runs in, because PGlite has a single
  connection and a nested `BEGIN` would deadlock the request (see §8). This is framework
  plumbing, not an app-facing knob.
- `enqueue` returns `{ id }` immediately; `runAt` is an ISO instant or `Date`
  (`delayMs` is the relative form; the two are mutually exclusive).
- `cancel` removes a queued job (`cancelled`) or aborts a running one; the attempt's
  `AbortSignal` fires and the engine marks the job `cancelled` when it settles. Unknown or
  already-terminal ids return `false`.
- `JobRecord` carries the serialized input/output, attempts/maxAttempts, timeout, ISO
  timestamps, and the last error message (server-only). `list` defaults to 50 rows, max
  200.
- Statuses: `queued | running | succeeded | failed | cancelled`. Jobs are independent: the
  context of a job does not expose `jobs.enqueue`, so no chain is expressible (a workflow
  construct is O-017).

## 7. Execution semantics

- **Concurrency.** The engine starts at most `maxConcurrent` attempts; a slot frees when the
  attempt settles (success, failure, timeout, cancellation). Enqueue wakes the tick.
- **Retry.** A failed attempt with `attempts < maxAttempts` returns the job to `queued`
  with `runAt = now + retryDelayMs` and the last error retained. Attempts are at-least-once:
  a job that crashes the worker may be re-run after recovery.
- **Timeout.** One attempt is bounded by `timeoutMs`; the engine aborts the signal and
  records a `timeout after <n>ms` failure. JavaScript cannot force-kill a running function,
  so a job that ignores the signal keeps running while the engine has already moved on — the
  signal is the contract, not a kill.
- **System context.** The executor wraps the definition's `run` in `runAsSystem`; the
  job body never sees a policy-free client, only the system-scoped transaction.
- **Independence.** The engine has no dependency graph and no parent/child link.

## 8. Persistence and recovery

`facilis_jobs` (table in `@facilis/db`, tenant-scoped with `tenantIsolationPolicy`,
`enableRLS`) is re-exported by the project's `db/schema.ts` and therefore created by a
Drizzle migration like the auth tables. The queue's own reads/writes run as `facilis_app`
under the deployment tenant (`runWithPolicyScope`), so RLS applies and the sudo audit stays
for job bodies only.

The store is transaction-aware: `JobStore.scoped(requestTx)` returns a view whose operations
join that transaction. The route wrapper binds `ctx.jobs` to it through `JobsApi.bindScope`,
so enqueue/get/list/cancel issued from a handler are part of the request transaction instead of
a second `BEGIN` on the single PGlite connection (which deadlocks: the request waits for the
queue call, the queue call waits for the request transaction). Engine ticks, attempts and
recovery run outside any request and keep owning their transactions.

- With `persist: true` and an available table, queue state survives the dev-server worker
  reload / process restart (PGlite dev snapshot included).
- If the table is missing (project not migrated yet) the boot records a
  `jobs_table_missing` warning and degrades to the in-memory store: jobs still work, but a
  reload loses queued work. `persist: false` selects the memory store explicitly.
- Any other failure while building or starting the runtime is a `jobs_boot_failed` warning and
  `ctx.jobs` is absent; boot itself never fails because of jobs. A store/scheduler failure
  during a tick is reported once per context as a `jobs_runtime_error` warning.
- On boot, rows left `running` by a killed process are recovered: re-queued at `now` when
  `attempts < maxAttempts`, otherwise `failed` with an `interrupted` error. This is the
  at-least-once counterpart of a hard worker reload.

## 9. File layout

```
packages/core/src/jobs.ts           public types, defineJob, isJobDefinition, JobError, serializeJobData
packages/core/src/jobs-config.ts    FacilisJobsConfig schema + defaults
packages/db/src/jobs.ts             facilisJobs table (schema + RLS) + row types
packages/nitro/src/runtime/jobs/
  contracts.ts                      internal StoredJob/JobStore/JobExecutor/JobTimers
  engine.ts                         scheduler: concurrency, retry, timeout, cancel, stats
  engine-support.ts                 engine helpers/constants (split for the 300-line gate)
  memory-store.ts                   JobStore fallback
  definitions.ts                    registry from the virtual module (dedupe, warnings)
  db-store.ts                       Drizzle-backed JobStore over facilis_jobs
  row-mapping.ts                    facilis_jobs row <-> StoredJob mapping shared with db-store
  executor.ts                       runAsSystem-backed JobExecutor
  boot.ts                           registry + store choice + engine start, manifest warnings
  runtime.ts                        JobsApi adapter: enqueue validation + StoredJob -> ISO record
packages/nitro/src/module.ts        registers #facilis/jobs (server/jobs/**/*.ts)
packages/nitro/src/runtime/bootstrap.ts  starts the runtime, carries it in BootstrapState
packages/nitro/src/middleware/context.ts exposes event.context.facilis.jobs
```

## 10. Out of scope (O-017)

Workflows/chains, retention & pruning policies for `facilis_jobs`, exponential backoff,
multi-instance/distributed workers (the engine assumes one process per database), a dev-only
inspection endpoint, and serverless scheduling guarantees. The durable parts (a persisted
queue, an explicit claim/attempt counter) are the seam the workflow construct reuses. A
workflow is now designed in [WORKFLOWS.md](./WORKFLOWS.md) (D-135, design approved, not
implemented); this section remains the jobs' own scope.
