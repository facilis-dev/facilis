# D-162 — `dbTables` is an applied declaration for jobs too; a workflow's table surface is derived
**Status:** accepted (2026-11-11).

D-157 made `dbTables` an applied declaration for routes and stopped there: it kept background
jobs, `ctx.jobs` and their store on the unguarded client ('restano sul client non guarded
(framework) e fuori scope'). That carve-out was a hole of the same shape D-157 closed. A job's
`run(ctx)` receives the system-scoped transaction (D-107), so it can read and write every
table and view in the tenant, while the sudo audit recorded only the `tables` the definition
listed itself — the declaration was still self-certified. The workflow layer (D-135/D-161) adds
a derived surface on top: a workflow references jobs by name and declares nothing of its own, so
what it can reach is exactly the union of its steps' jobs' declarations.

**Decision.**

- **Contract (breaking).** `defineJob` requires `dbTables` (`readonly string[]`, tables and
  views by SQL name, `[]` = the job touches no relation) and accepts `rawSql?: boolean`
  (default `false`); the optional `tables` field is removed. `defineJob`/`isJobDefinition`
  validate the declaration shape and the registry skips an unreadable definition with its
  manifest warning.
- **Runtime.** The executor passes the declaration to `runAsSystem`, which wraps the elevated
  transaction in the same `guardDatabase` the route wrapper uses: every relation must be declared
  before its query runs. An undeclared relation fails closed with `table_not_declared`;
  `db.execute` without `rawSql: true` with `raw_sql_not_allowed`. The audit
  `started/succeeded/failed` entries record the declared set, the `succeeded` one adds the
  relations actually observed (`observedTables`), and the `failed` one carries the canonical
  code — never the relation name or the internal message.
- **Terminal failure.** A declaration violation is deterministic, so it is not retried: the
  attempt settles `failed` with the stable code even when `maxAttempts` would allow a retry.
- **Static side.** `@facilis.dev/analyze` gains `JobFact` (readable `dbTables`/`rawSql` or explicit
  unknown) and `JobRelationsFact` (relation usage in the `run` body, following project-local
  helper calls; views resolve like tables; package calls stay opaque). Diagnostics:
  `job-definition`/`job-definition-static` warnings, `job-table-undeclared`, `job-table-unresolved`
  and `job-raw-sql` errors, `job-table-unused` warning (suppressed when the usage is opaque or
  contains allowed raw SQL). `jobs-gate.test.ts` runs the pass over the shipped example and fails
  on the errors (the D-154 pattern); the AI validator gains rule 19 `job-table-declared` over the
  same facts, covering every effective job and not only the patched ones.
- **Workflow surface, derived.** A workflow declares no tables: `Analysis.workflowTables` is the
  sorted union of the `dbTables` of the jobs its job steps reference (approval steps contribute
  nothing). A missing referenced job is a `workflow-job-unknown` warning, and an unreadable job
  declaration (or step name) marks the surface as unknown instead of guessing. There is no
  workflow runtime change: a workflow job step runs through the job executor and inherits that
  job's guard.
- **Not graph nodes yet.** Jobs do not become project-graph nodes or edges in this change; a
  later step can add a job node and a workflow→job edge without changing this contract.

**Rejected.** A second, job-specific guard (the route guard already models the same declaration;
two guards drift). Retrying a declaration violation (the definition cannot change between
attempts). Inferring the declaration from observed usage instead of enforcing it (the static
pass is best-effort, package calls are opaque and raw SQL is invisible). Declaring workflow
tables separately (a second source of truth that drifts from the jobs; the union is derivable).
Project-graph job nodes in the same change (layout and edges need their own design; deferred).

**Consequences.** Breaking for handwritten jobs that used `tables` or omitted `dbTables`:
the CI gate and the runtime fail closed and the example/fixtures are updated. The D-157
carve-out is revoked for the job body: routes, elevations and jobs are all declaration-enforced,
with the same codes and the same observed audit; the framework's own queue store
(`ctx.jobs`, boot and ticks) remains framework code, not a project db surface. SPEC v1.31
§5.6/§7.9/§8.4.6/§9.3, JOBS.md §5/§7/§8, WORKFLOWS.md §6/§9 and AGENTS.md (invariant 2, 19
rules) follow. The AI validator is now 19 rules, not 18.
