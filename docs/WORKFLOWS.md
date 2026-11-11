# Workflows and manual tasks — design

**Status:** accepted — design approved (D-135, 2026-11-10). W1 (manual tasks), W2
(workflows) and W3 (reject branches, task assignment by permission, an example workflow with its
start route, SPEC §7.10) are implemented. Workflows are shown in the project graph as definition
nodes with their steps (D-161, `@facilis.dev/analyze` pass); there is deliberately **no Studio task
inbox tab** — the task inbox/decide routes are app UI and the graph is the only new IDE surface.
SPEC §5.6/§7.9 describe the jobs surface (D-107) and §7.10 the workflow/task surface (SPEC v1.31);
O-017 stays open for retention/pruning and the dev-only inspection endpoint. A workflow declares
no tables: its table surface is derived from the `dbTables` of the jobs its steps reference
(D-162, §9). This document is the
design reference behind the approved direction: contract, runtime semantics, tables, rejected
alternatives and the phased plan.

## 1. What the feature must do

Owner request (2026-11-10): a workflow is a chain of jobs, and a manual step (typically an
approval) should be the simplest possible mechanism — the chain stays suspended until a row
flag changes. Derived requirements:

1. A workflow is a named, ordered chain of steps; a step is either an atomic job instance or a
   manual task.
2. A manual step suspends durably: the human decision is a row write and the runtime observes
   it; no in-memory wait, no open transaction, no timer held in a job body.
3. State survives the dev-server worker reload / process restart (PGlite snapshot) and never
   blocks the single PGlite connection.
4. The runtime writes as `facilis_app` under the tenant (like the queue); step bodies run as
   `facilis_system` through the jobs executor. Both tables are RLS-scoped (D-136), so there are
   no system-only tables and no elevation cascade; the app-owned routes enforce the session
   permissions (`tasks:read`/`tasks:decide`) on every decision.
5. Minimal surface: two tables, one runtime tick, no new package, no HTTP endpoint owned by the
   framework.

## 2. The constraint that shapes the design: a job cannot wait

- A job body runs through `runAsSystem` inside its own transaction (JOBS.md §5, §7), on the
  single PGlite connection (JOBS.md §8). A suspended attempt would hold that connection and
  deadlock the app.
- The browser host has no cross-process wake-up (no `LISTEN/NOTIFY` in PGlite) and the Nitro
  worker reloads on every project edit, so no in-memory orchestrator survives.
- The wait is therefore **data**: a `facilis_tasks` row whose `status` moves from `pending` to
  `decided`. The workflow row stays `waiting` on it and the next tick re-reads it — the jobs
  model (`queued`/`run_at`/`attempts`) applied to a human event.

## 3. Placement — no new package (the D-107 split)

| Layer | Owns |
|---|---|
| `@facilis.dev/core` | Public contract: `defineWorkflow`, `WorkflowDefinition`, `WorkflowRecord`, `TaskRecord`, `WorkflowsApi`, `TasksApi`, statuses, error codes, serialization reuse. |
| `@facilis.dev/db` | `facilis_workflows` and `facilis_tasks` (schema + RLS), re-exported by the project's `db/schema.ts` so a Drizzle migration owns them. |
| `@facilis.dev/nitro` | Runtime: `#facilis/workflows` virtual module, definition registry, workflow store, runner tick, recovery, `ctx.workflows`/`ctx.tasks` injection. |

## 4. Rejected alternatives

- **A workflow as a root job** (`parent_job_id` + a `waiting` status on `facilis_jobs`). O-017
  already decided the workflow is a separate construct; it would pollute `JobRecord` and retry
  semantics (job retry vs step retry), scatter chain state across job rows, and lose
  workflow-level status and cancellation. The chain is data; the job stays atomic.
- **No orchestration tables** — a job body enqueuing the next job (`ctx.jobs` in a job). This is
  the app-owned variant, rejected for the same reasons plus recovery and observability living
  in app code.
- **Advance only from the decision route (no tick)** — the decision write would advance the
  workflow synchronously. Rejected as the *only* mechanism: boot recovery still needs
  reconciliation, expiry needs a clock, and the advance would share the request transaction
  (single connection), coupling route latency to the workflow. Kept as an optimisation: a
  decision write wakes the tick.
- **Suspend points inside step functions** (durable execution). Not v1: `await` inside a job
  body cannot release its transaction, and a resumable runtime is out of proportion here.

## 5. Tables

### `facilis_workflows` — one workflow instance

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk default random | |
| `name` | text not null | definition key |
| `status` | text not null | `running`, `waiting`, `succeeded`, `failed`, `cancelled` — text like `facilis_jobs`, so a new state is a code change, not a migration |
| `input` | jsonb not null | validated by the definition's input schema |
| `progress` | jsonb not null default `'[]'` | completed steps: `{ index, kind, jobId?, taskId?, output?, decision? }` |
| `plan` | jsonb not null default `'[]'` | step identities captured at start: `{ index, kind, name }`; resume compares them (§6) |
| `current_step` | integer not null default 0 | index into the definition's steps |
| `current_job_id` | uuid null | the in-flight job step |
| `waiting_task_id` | uuid null | the pending manual step |
| `attempts` | integer not null default 0 | consecutive dispatches of the current step; reset on advance; boot recovery stops at `jobs.maxAttempts` |
| `output` | jsonb null | last step's output on success |
| `error` | text null | coded failure or last error message (server-only) |
| `started_at` / `created_at` | timestamptz not null default now | |
| `finished_at` | timestamptz null | set on every terminal transition |
| `tenant_id` | uuid not null | `tenantColumn()` |

Indexes: `(status, created_at)` for the tick scan, `(name)` for listing. The tick reads only
`status IN ('running', 'waiting')`.

### `facilis_tasks` — one manual task

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk default random | |
| `workflow_id` | uuid null | null for the W1 standalone task slice |
| `step_index` | integer null | |
| `kind` | text not null | `approval` in v1; `input` reserved |
| `status` | text not null | `pending`, `decided`, `expired`, `cancelled` |
| `decision` | text null | `approve`, `reject` — set only with `status = 'decided'` |
| `title_key` / `title_params` | text not null / jsonb not null default `'{}'` | i18n: the UI calls `t()` |
| `payload` | jsonb null | data shown to the decider (order snapshot, …) |
| `requested_by` | text null | actor (`system:workflow:<name>` or a user id) |
| `assigned_permission` | text null | assignment: the permission a decider needs (W3); the app route enforces it |
| `expires_at` | timestamptz null | |
| `decided_by` / `decided_at` | text null / timestamptz null | from the authenticated context, never caller-provided |
| `comment` | text null | optional, capped (1 000 chars) |
| `created_at` | timestamptz not null default now | |
| `tenant_id` | uuid not null | `tenantColumn()` |

Indexes: `(status, created_at)` for the inbox, `(workflow_id)` for the runner,
`(assigned_permission, status)` for an approver's filtered inbox.

Both tables use the `facilis_jobs` pattern: `tenantIsolationPolicy()` + `enableRLS()` (the D-008
rationale), and the framework's own writes run as `facilis_app` under the deployment tenant
(`runWithPolicyScope`), exactly like the queue: every row is RLS-scoped (D-136), so neither table
is system-only and no elevation is involved. The task permissions (`tasks:read`/`tasks:decide`)
live in the session, so the app-owned routes enforce them and the tables add only the tenant
policy. Statuses stay `text`; there are no foreign keys
between framework tables (the queue has none), so retention/pruning cannot be blocked by an
orphan reference — pruning is out of scope anyway.

## 6. Definition contract

`server/workflows/**/*.ts` — one default export per file, scanned through `#facilis/workflows`
the way `server/jobs/**` reaches `#facilis/jobs`:

    import { z } from "zod";
    import { defineWorkflow } from "@facilis.dev/core";

    export default defineWorkflow({
      name: "order-approval",
      input: z.object({ orderId: z.string().uuid() }),
      steps: [
        { job: "reserve-stock" },
        { job: "charge-card", input: ({ steps }) => ({ amount: steps[0].output.amount }) },
        {
          approval: {
            titleKey: "workflow.order.approve",
            params: ({ input }) => ({ orderId: input.orderId }),
            ttlMs: 86_400_000,
            permission: "orders:approve",
          },
        },
        { job: "ship-order" },
      ],
    });

- `name` is the start key, unique across the registry; `input` is a Zod schema parsed and
  JSON-round-tripped (reuse `serializeJobData`); a workflow whose output is needed takes an
  `output` schema too (the last step's output is validated before `succeeded`).
- Step kinds in v1: `{ job: "<name>", input?: resolver }` and `{ approval: { titleKey, params?,
  ttlMs?, permission?, onReject? } }`. The job name must exist in the jobs registry; a dangling
  name is a `workflow_definition_invalid` manifest warning, never a boot failure (jobs
  behaviour). `permission` stores the permission a decider needs on the task row (assignment,
  §7). `onReject: { step }` must be a later step index: a rejection jumps forward past the
  skipped steps instead of failing; omitted, the rejection fails the run with
  `workflow_task_rejected`.
- A job step's optional `input` resolver runs in the runner's system context when the step is
  reached, receiving `{ input, steps }` where `steps[i]` is the output of a completed step. The
  resolved value is validated by `enqueue` (existing `job_invalid_input` → workflow
  `workflow_step_failed`).
- A job step without an `input` resolver receives the chain input unchanged (the common
  first-step case); a resolver is only needed when a step reads a previous output.
- **Plan snapshot.** At start the runner stores the step identities `(index, kind, name)` in
  `plan`; a step's resolved input/output is materialised before its side effect. On resume the
  current step's identity is compared with the definition: a mismatch fails the workflow with
  `workflow_definition_changed` instead of guessing after a project edit.
- Invalid or duplicate definitions become manifest warnings and are skipped (jobs behaviour).


**Table surface (D-162).** A workflow declares no `dbTables`: the union of the `dbTables` of the
jobs its job steps reference is its surface (derived in the analyzer, §9) and the runtime
inherits each step job's own guard. There is deliberately no workflow-level declaration that
could drift from the jobs it runs.

## 7. Runtime API — server-only

    interface WorkflowsApi {
      start(name: string, input: unknown): Promise<{ id: string }>;
      get(id: string): Promise<WorkflowRecord | null>;
      list(options?: {
        status?: WorkflowStatus | WorkflowStatus[];
        name?: string;
        limit?: number;
      }): Promise<WorkflowRecord[]>;
      cancel(id: string): Promise<boolean>;
    }

    interface TasksApi {
      request(input: {
        titleKey: string;
        titleParams?: Record<string, string | number>;
        payload?: unknown;
        expiresAt?: string | Date;
        assignedPermission?: string;
      }): Promise<TaskRecord>;
      list(options?: {
        status?: TaskStatus | TaskStatus[];
        workflowId?: string;
        assignedPermission?: string;
        limit?: number;
      }): Promise<TaskRecord[]>;
      get(id: string): Promise<TaskRecord | null>;
      decide(
        id: string,
        decision: { kind: "approve" | "reject"; comment?: string },
      ): Promise<TaskRecord>;
      cancel(id: string): Promise<boolean>;
    }

- `ctx.workflows` and `ctx.tasks` sit on `defineAuthorizedHandler` next to `ctx.jobs` and are
  bound to the request's policy-scoped transaction (`bindScope`), for the same single-connection
  reason (JOBS.md §6, §8).
- `decide` is a compare-and-set: `UPDATE … WHERE id = $1 AND status = 'pending'`; it returns the
  updated `TaskRecord` or rejects with `task_not_found`, `task_already_decided` or
  `task_expired`. It records the flag (`decided_by` from the authenticated context,
  `decided_at = now()`, optional comment) and wakes the tick; it never advances the workflow
  directly.
- **No HTTP endpoint in the framework** (JOBS.md §6): a project writes its own
  `defineAuthorizedHandler` routes; the example project ships `server/routes/api/tasks/index.get.ts`
  (pending inbox, optional `permission` filter) and `server/routes/api/tasks/[id].patch.ts`
  (decide, assignment enforced against the session), plus `server/routes/api/workflows/index.post.ts`
  to start the example chain, with permissions `tasks:read`/`tasks:decide` declared in
  `facilis.config.ts` roles. There is no Studio task inbox tab: the inbox/decide routes are the app's own UI and the project graph is the only workflow surface the Studio adds (D-161).
- `assigned_permission` is stored by the approval step and filtered by
  `ctx.tasks.list({ assignedPermission })`; the framework does not evaluate it, because
  permissions live in the session — the app's decide route loads the task and compares it with
  `ctx.auth.permissions` (the example does), so the decision surface stays app-owned.
- If the runtime is unavailable (tables missing or boot failure) `ctx.workflows`/`ctx.tasks`
  reject with coded `workflow_unavailable`/`task_unavailable` errors — never a framework-wide
  500 (jobs behaviour).

## 8. Execution semantics — one tick

`workflows.tickIntervalMs` (default `1000`) drives a runner in `runtime/workflows/runner.ts`.
Every transition is a short transaction with a CAS guard:

1. **Expire** — pending tasks with `expires_at <= now()` become `expired`; a workflow waiting on
   one fails with `workflow_task_expired`.
2. **Resume decided** — a `decided` task whose workflow is `waiting` on it turns the workflow
   `running`, clears `waiting_task_id` and appends an approval progress entry carrying its
   `decision`; `approve` continues at the next step. `reject` either jumps forward to the
   step's declared `onReject.step` (skipped steps contribute `null` outputs) or fails the run
   with `workflow_task_rejected`; the target is checked against the plan snapshot too, so a
   mid-run definition edit cannot redirect a branch.
3. **Advance** — a `running` workflow with `current_job_id` reads that job: `succeeded` appends
   its output to `progress`, advances `current_step`; `failed` → `workflow_step_failed` (job id
   and error retained); `cancelled` → `cancelled`.
4. **Dispatch** — a `running` workflow without a side effect dispatches the current step: a job
   step resolves its input, enqueues through the job store in the same transaction and stores
   `current_job_id`; an approval step inserts the task and sets `waiting` in the same
   transaction; no steps left → `succeeded` with the last output.
5. **Wake** — `start`, `decide` and any enqueue request an immediate tick; the tick itself is a
   no-op query when no workflow is `running`/`waiting`.

Boot recovery: a `running` workflow with no live job (memory store, worker reload) re-dispatches
its current step while `attempts < jobs.maxAttempts`, otherwise fails with
`workflow_interrupted`; a `waiting` workflow survives as-is.

At-least-once: a crash can re-run a step's job after recovery (jobs semantics — the signal is the
contract, the body may have run); decisions are exactly-once because the CAS lets exactly one
decider win (`task_already_decided` for the others). Cancellation cancels the current job and any
pending task; completed steps are not compensated.

## 9. Security, audit, logging, i18n

- Both tables are tenant-scoped with RLS (D-136: RLS is the app-role grant boundary); the runner
  writes as `facilis_app` under the deployment tenant, like the queue. Step bodies run as
  `facilis_system` through the jobs executor with the sudo audit (D-107) — workflows add no new
  system surface.
- `decide` is an app-scoped write behind an authorized route **and** the session's `tasks:decide`
  permission; RLS confines it to the tenant and `decided_by` comes from the context. An assigned
  task (`assigned_permission`) is filtered by the inbox and checked by the route against
  `ctx.auth.permissions`. The UI never writes the workflow row.
- Route handlers still list their own tables in `dbTables` (invariant 2); the framework tables
  are reached only through `ctx.workflows`/`ctx.tasks`, like `ctx.jobs`.
- Failures degrade like jobs: `workflows_boot_failed` / `workflows_table_missing` manifest
  warnings, `workflow_runtime_error` reported once per context. Decisions are app events; the
  route may append a `ctx.log` audit line (D-119), never prose.
- `title_key`/`title_params` are data for `t()`; every other user-facing string is an i18n key
  (UI rules, D-043).

**Derived table surface (D-162).** A workflow declares no `dbTables` of its own and none is
checked at runtime: what a workflow can reach is the sorted union of the `dbTables` of the
jobs its job steps reference (approval steps contribute nothing; a step references a job by
name). `Analysis.workflowTables` carries one `WorkflowTablesFact` per definition with
`tables`, `unknownJobs` and an `unknown` flag. A referenced job with no definition under
`server/jobs/**` is a `workflow-job-unknown` warning; an unreadable job declaration (or an
unreadable step name) marks the surface `unknown` instead of guessing. There is no runtime
change: a workflow job step runs through the job executor, which inherits that job's guard
(D-157/D-162), so the effective surface is enforced where it is used.

## 10. Config

`facilis.config.ts` gains a `workflows` section, every key defaulted, mirroring `jobs`:

| Key | Default | Meaning |
|---|---|---|
| `tickIntervalMs` | `1000` | runner tick (woken by start/decide) |
| `persist` | `true` | rows are the contract; `false` or a missing table → manifest warning + unavailable API, no memory mode |
| `defaultTaskTtlMs` | `null` | no expiry unless the step sets `ttlMs` |

`jobs.maxConcurrent`/`maxAttempts`/`timeoutMs` apply to the step jobs themselves — the workflow
adds no second scheduler.

## 11. File layout

    packages/core/src/workflows.ts             defineWorkflow, records, APIs, error codes
    packages/core/src/workflows-config.ts      FacilisWorkflowsConfig schema + defaults
    packages/core/src/workflows-validation.ts  authoring-time definition guards
    packages/core/src/tasks.ts                 TaskRecord, TasksApi, task error codes
    packages/db/src/workflows.ts               facilis_workflows (schema + RLS)
    packages/db/src/tasks.ts                   facilis_tasks (schema + RLS)
    packages/nitro/src/runtime/workflows/
      contracts.ts                            StoredWorkflow/Store interfaces, runner deps
      definitions.ts                          registry from #facilis/workflows
      db-store.ts                             Drizzle-backed store, CAS updates
      row-mapping.ts                          row <-> record mapping shared with db-store
      runtime.ts                              ctx.workflows API (start/get/list/cancel/bindScope)
      steps.ts                                step identity, plan comparison, resolver context
      dispatch.ts                             job enqueue / approval insert (one transaction)
      transitions.ts                          expire / resume / advance
      support.ts                              CAS guard, failure settling, helpers
      runner.ts                               the tick (start/stop/tick)
      boot.ts                                 table probes, registry, runner start
    packages/nitro/src/runtime/boot-runtimes.ts  jobs + tasks + workflows boot together
    packages/nitro/src/module.ts              registers #facilis/workflows
    packages/nitro/src/middleware/context.ts  exposes ctx.tasks / ctx.workflows
    examples/todo-app/server/routes/api/tasks/  inbox + decide routes (assignment enforced)
    examples/todo-app/server/workflows/purge-completed-todos.ts  example definition
    examples/todo-app/server/routes/api/workflows/index.post.ts  start route
    examples/todo-app/facilis.config.ts       permissions tasks:read/tasks:decide
    packages/analyze/src/passes/workflows.ts  definition facts -> project-graph workflow nodes
    packages/analyze/src/passes/workflow-tables.ts  derived table surface (D-162)
    ide/src/facilis/graph-model.ts            workflow column/card/inspector
    (not planned)                              Studio task inbox tab: app-owned routes + graph (D-161)

## 12. Out of scope (v1)

Branches beyond a forward rejection jump, conditions/loops/fan-out/parallel steps, dynamic
step graphs, sub-workflows, cron or scheduled workflows, compensation/rollback, exactly-once
step execution, assignment to a user or role (only a permission is stored; the app enforces it),
notifications, first-class external-signal (webhook) steps — an app-owned public route can decide
a pending task, but the framework models no signal outcome — retention/pruning of the two tables,
multi-instance workers (one process per database, as jobs), a Studio task inbox tab (the app
owns the inbox routes and the project graph shows the workflow definitions, D-161).

## 13. Phased plan

- **W1 — manual tasks slice (landed).** `facilis_tasks` + core `TaskRecord`/`TasksApi` + nitro store
  with list/decide + example routes + tests. Tasks exist standalone (`workflow_id` null); the
  approval primitive is useful on its own and W2 needs no migration. There is no Studio `Attività` inbox
  tab: the app owns the inbox routes and the graph shows the workflow definitions (D-161).
- **W2 — workflows (landed).** `facilis_workflows` + `defineWorkflow` + registry + runner tick
  + boot recovery + `ctx.workflows` + tests; approval steps reuse W1's tasks. Dispatch enqueues
  the step job (or inserts the task) in the same transaction as the workflow update, every
  transition is a CAS on the row, expiry is part of the tick, and cancel stops the current
  job/task before settling the row.
- **W3 — polish (landed).** Reject branches (`onReject`, a forward jump validated at load and
  against the plan snapshot), task assignment by permission (`assigned_permission`, filtered by
  the inbox and enforced by the example decide route), the example workflow definition with its
  start route, the `@facilis.dev/analyze` pass and the project-graph workflow nodes, and SPEC §7.10.
  There is no Studio task inbox tab: the inbox/decide routes are app UI and the graph is the only
  new IDE surface (D-161).

## 14. Open questions

- Default task TTL remains `null` (per-step `ttlMs` only); W2 implements expiry as a tick
  transition and a `workflow_task_expired` failure — whether a deployment wants a week-long
  default is still open.
- Reject semantics: resolved in W3 — a declared forward step or failure; a decided task never
  reopens (the CAS makes it terminal).
- Decision audit: route `ctx.log` line vs a dedicated event.
- Studio inbox: resolved in D-161 — none. The app owns the task routes; the Studio adds only the
  workflow definition nodes to the project graph.

