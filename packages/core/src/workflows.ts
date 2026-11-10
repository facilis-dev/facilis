import type { PolicyScopedDatabase } from "@facilis/db";
import type { z } from "zod";

import type { JobJson } from "./jobs.ts";
import {
  assertStep,
  assertWorkflowName,
  isSchema,
  isStep,
  isWorkflowName,
} from "./workflows-validation.ts";

/**
 * The workflow contract (D-135, docs/WORKFLOWS.md §6–§7).
 *
 * A workflow is a named, ordered chain of steps; a step is either a job instance or a manual
 * approval task. The chain is `facilis_workflows` data advanced by a runtime tick, never a
 * job body holding a transaction open: the manual step waits on a task row, and a decision is
 * that row's flag (D-135, O-017).
 */

/** Lifecycle of one workflow instance. */
export const WORKFLOW_STATUSES = [
  "running",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

/** v1 step kinds: a job to enqueue, or an approval to request. */
export const WORKFLOW_STEP_KINDS = ["job", "approval"] as const;

export type WorkflowStepKind = (typeof WORKFLOW_STEP_KINDS)[number];

/** Runtime failures of the workflow API, as stable codes (never prose). */
export const WORKFLOW_ERROR_CODES = [
  "workflow_unknown",
  "workflow_invalid_input",
  "workflow_invalid_output",
  "workflow_unavailable",
  "workflow_definition_changed",
  "workflow_step_failed",
  "workflow_task_rejected",
  "workflow_task_expired",
  "workflow_task_cancelled",
  "workflow_interrupted",
] as const;

export type WorkflowErrorCode = (typeof WORKFLOW_ERROR_CODES)[number];

/** Thrown when a workflow cannot be started, or a run's contract is violated. */
export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;

  constructor(code: WorkflowErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkflowError";
    this.code = code;
  }
}

/** Workflow data crosses the same JSON boundary as job data (what the row persists). */
export type WorkflowJson = JobJson;

/**
 * What a step's resolver sees when the runner reaches it. `steps[i]` is the serialized
 * output of the completed step at index i; an approval step contributes `null`.
 */
export interface WorkflowResolveContext<Input = unknown> {
  readonly input: Input;
  readonly steps: readonly (WorkflowJson | null)[];
}

/** A job step: enqueue the named job through the queue (D-107). */
export interface WorkflowJobStep<Input = unknown> {
  readonly job: string;
  /** Resolves the job input from the workflow input and completed step outputs. */
  readonly input?: (context: WorkflowResolveContext<Input>) => unknown;
}

/** A manual step: suspend the chain on an approval task until a human decides it. */
export interface WorkflowApprovalStep<Input = unknown> {
  readonly approval: {
    /** i18n key of the task title; the UI renders it with `t(titleKey, params)`. */
    readonly titleKey: string;
    /** Resolves the flat title params for that key. */
    readonly params?: (
      context: WorkflowResolveContext<Input>,
    ) => Readonly<Record<string, string | number>>;
    /** Overrides `workflows.defaultTaskTtlMs` for this step. */
    readonly ttlMs?: number;
  };
}

export type WorkflowStep<Input = unknown> = WorkflowJobStep<Input> | WorkflowApprovalStep<Input>;

/** A named chain; one default export per `server/workflows/**\/*.ts` module. */
export interface WorkflowDefinition<Input = unknown, Output = unknown> {
  /** Start key; unique across the project's definitions. */
  readonly name: string;
  /** Validated when `ctx.workflows.start` is called and stored in the row. */
  readonly input: z.ZodType<Input>;
  /** Optional contract of the last step's output, validated before `succeeded`. */
  readonly output?: z.ZodType<Output>;
  /** Ordered steps; at least one. */
  readonly steps: readonly WorkflowStep<Input>[];
}

/** The stored step identity: what plan snapshot comparison reads on resume (§6). */
export interface WorkflowStepIdentity {
  readonly index: number;
  readonly kind: WorkflowStepKind;
  /** Job name for a job step, approval title key for an approval step. */
  readonly name: string;
}

/**
 * Declares a workflow. Authoring errors (bad name, missing schema, malformed step) throw
 * here, at module load, so the definition registry reports them as a manifest warning
 * instead of failing a run (jobs behaviour, docs/WORKFLOWS.md §6).
 */
export function defineWorkflow<Input = unknown, Output = unknown>(
  definition: WorkflowDefinition<Input, Output>,
): WorkflowDefinition<Input, Output> {
  assertWorkflowName(definition.name);
  if (!isSchema(definition.input)) {
    throw new TypeError(`Workflow "${definition.name}" requires a Zod "input" schema.`);
  }
  if (definition.output !== undefined && !isSchema(definition.output)) {
    throw new TypeError(`Workflow "${definition.name}": output must be a Zod schema when present.`);
  }
  if (!Array.isArray(definition.steps) || definition.steps.length === 0) {
    throw new TypeError(`Workflow "${definition.name}" requires at least one step.`);
  }
  definition.steps.forEach((step, index) => assertStep(definition.name, step, index));
  return definition;
}

/** Structural guard used by the registry; never trusts a module's exported value. */
export function isWorkflowDefinition(value: unknown): value is WorkflowDefinition {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<WorkflowDefinition>;
  if (
    !isWorkflowName(candidate.name) ||
    !isSchema(candidate.input) ||
    (candidate.output !== undefined && !isSchema(candidate.output)) ||
    !Array.isArray(candidate.steps) ||
    candidate.steps.length === 0
  ) {
    return false;
  }
  return candidate.steps.every((step, index) => isStep(step, index));
}

/** One completed step, appended by the runner when the step settles. */
export interface WorkflowProgressEntry {
  readonly index: number;
  readonly kind: WorkflowStepKind;
  /** Set for a job step. */
  readonly jobId?: string;
  /** Set for an approval step. */
  readonly taskId?: string;
  /** The job's serialized output; approval steps carry no output. */
  readonly output?: WorkflowJson;
}

/** Filters for `ctx.workflows.list`; order is oldest-created first (chain order). */
export interface WorkflowListOptions {
  readonly status?: WorkflowStatus | readonly WorkflowStatus[];
  readonly name?: string;
  /** Defaults to 50, capped at 200 (same caps as the queue). */
  readonly limit?: number;
}

/** One workflow, as the API returns it (timestamps ISO-8601, data JSON). */
export interface WorkflowRecord {
  readonly id: string;
  readonly name: string;
  readonly status: WorkflowStatus;
  /** The serialized, validated start input. */
  readonly input: WorkflowJson;
  /** Completed steps, in order. */
  readonly progress: readonly WorkflowProgressEntry[];
  /** Index of the step the chain is on (equals `steps.length` once succeeded). */
  readonly currentStep: number;
  readonly currentJobId: string | null;
  readonly waitingTaskId: string | null;
  /** Dispatches of the current step (reset on advance; drives interrupted recovery). */
  readonly attempts: number;
  /** Last completed step's serialized output, when the definition declares none. */
  readonly output: WorkflowJson | null;
  /** Coded failure kind plus the last error message (server-only). */
  readonly error: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly createdAt: string;
}

/**
 * Server-only workflow surface. `bindScope` is framework plumbing: a handler's calls join
 * the request transaction instead of opening a second one on the single PGlite connection
 * (the same reason as `ctx.jobs`, docs/JOBS.md §8).
 */
export interface WorkflowsApi {
  /** Validates `input` against the definition and starts a run; returns its id. */
  start(name: string, input: unknown): Promise<{ id: string }>;
  get(id: string): Promise<WorkflowRecord | null>;
  list(options?: WorkflowListOptions): Promise<WorkflowRecord[]>;
  /** Cancels a running/waiting run (current job and pending task); false when terminal. */
  cancel(id: string): Promise<boolean>;
  bindScope?(scope: PolicyScopedDatabase): WorkflowsApi;
}

/**
 * Serializes workflow data through a JSON round-trip: what the row stores is exactly what
 * the runner and the API hand back. Non-serializable values are a contract violation.
 */
export function serializeWorkflowData(value: unknown): WorkflowJson {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    throw new WorkflowError("workflow_invalid_input", "Workflow data is not JSON-serializable.", {
      cause: error,
    });
  }
  if (encoded === undefined) {
    throw new WorkflowError(
      "workflow_invalid_input",
      "Workflow data is not JSON-serializable (undefined).",
    );
  }
  // JSON.parse of a JSON.stringify result is always a WorkflowJson by construction.
  return JSON.parse(encoded) as WorkflowJson;
}

/** Substituted by the route wrapper when the workflow runtime did not boot (D-135). */
export function unavailableWorkflows(): WorkflowsApi {
  // Reject (not throw synchronously): callers await the API, exactly like ctx.jobs.
  const unavailable = async (): Promise<never> => {
    throw new WorkflowError("workflow_unavailable", "The workflow runtime is not available.");
  };
  const api: WorkflowsApi = {
    start: unavailable,
    get: unavailable,
    list: unavailable,
    cancel: unavailable,
  };
  api.bindScope = () => api;
  return api;
}
