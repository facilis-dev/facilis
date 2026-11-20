# D-135 — Workflows are a state machine over rows; manual steps are tasks
**Status:** accepted (2026-11-10) — design approved; W1 (manual tasks), W2 (workflows) and W3 (reject branches, task assignment, example, SPEC §7.10) implemented, and the analyzer pass puts workflow definitions in the project graph (D-161); there is no Studio inbox tab (D-161).

Owner request (2026-11-10): a workflow is a chain of jobs, and a manual step (typically an
approval) should be the simplest possible mechanism — the chain stays suspended until a row
flag changes. The jobs runtime (D-107, [JOBS.md](./JOBS.md)) deliberately keeps jobs
independent (O-017: "a workflow is a separate construct"), and a job body runs through
`runAsSystem` inside its own transaction on the single PGlite connection (JOBS.md §8): a
suspended attempt would hold that connection and deadlock the app, and the browser host has no
cross-process wake-up. A blocking wait is therefore not expressible; the wait must be data.

**Decision.** Add a workflow layer above the unchanged job queue: `facilis_workflows` (one
row per instance: status, input, progress/plan snapshot, current step, waiting task, attempts)
and `facilis_tasks` (one row per manual step: i18n title, payload, pending → decided/expired,
`decided_by`/`decided_at`, comment). `defineWorkflow` declares an ordered chain of job and
approval steps in `server/workflows/**/*.ts`; a runtime tick advances each workflow by CAS
transitions (dispatch the step, observe the job, observe the decision) in short transactions
and reconciles interrupted instances on boot. The manual flag is the task row's
`status = 'decided'` plus `decision`, written by an authorized `ctx.tasks.decide` (permission
`tasks:decide`); the runtime keeps ownership of the workflow row, so a decision cannot race
the tick and who decided when is audited. Like jobs, the framework owns no HTTP endpoint —
the example project ships the task routes. Design and the phased plan (W1 tasks, W2 workflows, W3
polish) are in [WORKFLOWS.md](./WORKFLOWS.md).

**Rejected.** A root job with `parent_job_id` and a `waiting` status (pollutes the job
contract, scatters chain state — O-017); a chain assembled by `ctx.jobs` inside job bodies
(recovery/observability in app code); advancing only from the decision route (no boot
reconciliation after a reload between job completion and advance); suspend points inside step
functions (a job cannot release its transaction).

**Consequences.** Jobs stay independent and unchanged; workflow state is rows, so a reload
resumes it; step jobs are at-least-once (jobs semantics), decisions are exactly-once via the
CAS. v1 is linear (only a forward rejection jump) and has no compensation. SPEC §5.6/§7.9
describe the jobs surface and §7.10 the workflow/task surface (v1.30).

Verification: W1 landed with unit and integration tests (contract, handler binding, the Drizzle
store over PGlite with RLS, boot and API). W2 landed with the workflow contract and registry,
the Drizzle store over PGlite (CAS transitions, RLS), the runner over PGlite (job chain,
approval resume/reject, expiry, missing-job re-dispatch, plan-snapshot mismatch, cancellation),
the API (start/get/list/cancel/bindScope) and boot degradation. W3 landed with the reject
branch (contract validation, forward jump, plan-snapshot check and runner test), task
assignment (`assigned_permission` column and migration 0007, store filter, runtime validation,
example route enforcement), the example workflow with its start route, and SPEC §7.10; root
`pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` are green. The analyzer pass and
the `workflow` graph node landed in D-161; the Studio adds no task inbox tab (D-161).
