import type { FrameworkModule } from "../framework-reference";

/**
 * `@facilis.dev/core` — the contract a generated project imports (SPEC §5.1).
 *
 * The authorized route wrapper is the security surface; jobs, workflows and manual tasks are
 * the three other definitions a project writes; `t` comes from the `/i18n` subpath.
 */
export const CORE_MODULE: FrameworkModule = {
  id: "core",
  package: "@facilis.dev/core",
  summary:
    "Configuration contract, the defineAuthorizedHandler wrapper and its ctx, job/workflow/task definitions, runtime i18n.",
  entries: [
    {
      name: "defineAuthorizedHandler",
      kind: "function",
      signature:
        "defineAuthorizedHandler<B, Q, P, F>(config: AuthorizedHandlerConfig<B, Q, P, F>, handler: (event: FacilisHandlerEvent, ctx: AuthorizedHandlerContext<B, Q, P, A, F>) => unknown): AuthorizedHandler",
      summary:
        "The only sanctioned way to declare an API route: session → permission → Zod body/form/query/params validation → policy-scoped ctx.db; failures become code Responses, never leaked internals.",
      example:
        'export default defineAuthorizedHandler({ permission: "todos:read", dbTables: ["todos"], description: "List todos" }, async (event, ctx) => ctx.db.select().from(todos));',
    },
    {
      name: "AuthorizedHandlerContext",
      kind: "type",
      signature:
        "interface AuthorizedHandlerContext<B, Q, P, A, F> { auth: A; body: B; form: F; query: Q; params: P; db: PolicyScopedDatabase; sudo: SudoHandler; system: SystemHandler; jobs: JobsApi; tasks: TasksApi; workflows: WorkflowsApi; storage: StorageApi; log: FacilisLogger; requestId: string }",
      summary:
        "What every route handler receives as ctx: validated input, the policy-scoped db client, audited sudo/system elevation, and the server-only jobs/tasks/workflows/storage surfaces.",
    },
    {
      name: "AuthorizedHandlerConfig",
      kind: "type",
      signature:
        'interface AuthorizedHandlerConfig<B, Q, P, F> { permission: string | readonly string[]; body?: z.ZodType<B>; form?: z.ZodType<F>; query?: z.ZodType<Q>; params?: z.ZodType<P>; crossSite?: boolean; originCheck?: "enforce" | "skip"; dbTables: readonly string[]; dbColumns?: readonly string[]; rateLimit?: RateLimitWindow; rawSql?: boolean; description?: string }',
      summary:
        "The declaration the wrapper and the Nitro AST pass read: permission ([] = public), the Zod schemas (body and form are mutually exclusive), and dbTables — required and accurate, possibly [].",
    },
    {
      name: "defineConfig",
      kind: "function",
      signature: "defineConfig(config: FacilisConfigInput): FacilisConfig",
      summary:
        "Validates facilis.config.ts at boot: throws on an unknown role, permission or locale instead of failing the first request. The auth block is always explicit.",
    },
    {
      name: "defineJob",
      kind: "function",
      signature:
        "defineJob<Input, Output>(definition: JobDefinition<Input, Output>): JobDefinition<Input, Output>",
      summary:
        "Declares one background job as the default export of server/jobs/**/*.ts: unique name, Zod input/output, required dbTables (the runtime enforces the declaration) and run(ctx).",
      example:
        'export default defineJob({ name: "todos.purge", input: z.object({}), output: z.object({ removed: z.number() }), dbTables: ["todos"], async run(ctx) { /* ctx.db is system-scoped */ return { removed: 0 }; } });',
    },
    {
      name: "JobRunContext",
      kind: "type",
      signature:
        "interface JobRunContext<Input> { jobId: string; name: string; attempt: number; data: Input; signal: AbortSignal; db: PolicyScopedDatabase }",
      summary:
        "What run() sees: the validated payload, the 1-based attempt, a cancellation/timeout signal to observe, and a system-scoped db client guarded by the job's dbTables.",
    },
    {
      name: "defineWorkflow",
      kind: "function",
      signature:
        "defineWorkflow<Input, Output>(definition: WorkflowDefinition<Input, Output>): WorkflowDefinition<Input, Output>",
      summary:
        "Declares a named job/approval chain (default export under server/workflows/**/*.ts); an approval step suspends on a durable manual task until ctx.tasks.decide records the decision.",
      example:
        'export default defineWorkflow({ name: "todos.purge-reviewed", input: z.object({}), steps: [{ job: "todos.purge" }, { approval: { titleKey: "workflow.purge.approve" } }] });',
    },
    {
      name: "TasksApi",
      kind: "type",
      signature:
        "interface TasksApi { request(input: RequestTaskInput): Promise<TaskRecord>; get(id: string): Promise<TaskRecord | null>; list(options?: TaskListOptions): Promise<TaskRecord[]>; decide(id: string, decision: TaskDecisionInput): Promise<TaskRecord>; cancel(id: string): Promise<boolean> }",
      summary:
        "ctx.tasks (server-only): there is no defineManualTask — a task row is created by ctx.tasks.request or by a workflow approval step, and an app route calls decide with the session's actor.",
    },
    {
      name: "RequestTaskInput",
      kind: "type",
      signature:
        "interface RequestTaskInput { titleKey: string; titleParams?: Readonly<Record<string, string | number>>; payload?: unknown; expiresAt?: string | Date; assignedPermission?: string }",
      summary:
        "Input for ctx.tasks.request: an i18n title key the inbox renders with t(), JSON payload for the decider, optional expiry and the permission deciding requires.",
    },
    {
      name: "t",
      kind: "function",
      signature: "t(key: string, params?: I18nParams): string",
      summary:
        "Runtime translator from @facilis.dev/core/i18n: flat keys, {placeholder} interpolation, missing keys return the key and are reported to the collector — it never throws.",
    },
  ],
};
