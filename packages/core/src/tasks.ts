import type { PolicyScopedDatabase } from "@facilis.dev/db";

import type { JobJson } from "./jobs.ts";

/**
 * The manual-task contract (D-135, docs/WORKFLOWS.md §7).
 *
 * A task is a durable row a human decides: nothing waits for it in memory and no job body
 * blocks on it, which is what makes an approval survive a dev-server reload (D-135). Like
 * the job queue, this API is reachable only from server code (`ctx.tasks`); the framework
 * owns no HTTP endpoint, so a project writes its own authorized inbox/decide routes.
 */

/** Lifecycle of one task. */
export const TASK_STATUSES = ["pending", "decided", "expired", "cancelled"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/** What the task asks for; approvals are the only kind the v1 slice ships. */
export const TASK_KINDS = ["approval"] as const;

export type TaskKind = (typeof TASK_KINDS)[number];

/** How a decided task closes. */
export const TASK_DECISIONS = ["approve", "reject"] as const;

export type TaskDecision = (typeof TASK_DECISIONS)[number];

/** Runtime failures of the task API, as stable codes (never prose). */
export const TASK_ERROR_CODES = [
  "task_not_found",
  "task_already_decided",
  "task_expired",
  "task_invalid_input",
  "task_unavailable",
] as const;

export type TaskErrorCode = (typeof TASK_ERROR_CODES)[number];

/** Thrown when a task cannot be requested or decided. */
export class TaskError extends Error {
  readonly code: TaskErrorCode;

  constructor(code: TaskErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TaskError";
    this.code = code;
  }
}

/** Task data crosses the same JSON boundary as job data (what the row persists). */
export type TaskJson = JobJson;

/** Input accepted by `ctx.tasks.request`. */
export interface RequestTaskInput {
  /** i18n key of the task title; the UI renders it with `t(titleKey, titleParams)`. */
  readonly titleKey: string;
  /** Flat params for that key. */
  readonly titleParams?: Readonly<Record<string, string | number>>;
  /** Opaque JSON the decider sees (an order snapshot, a diff, ...). */
  readonly payload?: unknown;
  /** Optional absolute expiry; a task decided after it is `task_expired`. */
  readonly expiresAt?: string | Date;
  /**
   * Permission a decider needs (task assignment, D-135 W3). The framework stores and filters
   * it; the app's decide route enforces it, because permissions live in the session (D-098).
   */
  readonly assignedPermission?: string;
}

/** A human decision on a pending task. */
export interface TaskDecisionInput {
  readonly kind: TaskDecision;
  readonly comment?: string;
}

export interface TaskListOptions {
  readonly status?: TaskStatus | readonly TaskStatus[];
  readonly workflowId?: string;
  /** Only tasks assigned to this permission (the inbox of an approver). */
  readonly assignedPermission?: string;
  /** Defaults to 50 rows, max 200 (same caps as the queue). */
  readonly limit?: number;
}

/** One task, as the API returns it (timestamps ISO-8601, data JSON). */
export interface TaskRecord {
  readonly id: string;
  /** Set when a workflow step requested the task; null for a standalone task. */
  readonly workflowId: string | null;
  readonly stepIndex: number | null;
  readonly kind: TaskKind;
  readonly status: TaskStatus;
  readonly decision: TaskDecision | null;
  readonly titleKey: string;
  readonly titleParams: TaskJson;
  readonly payload: TaskJson | null;
  readonly requestedBy: string | null;
  /** Permission required to decide the task; null for an unassigned task. */
  readonly assignedPermission: string | null;
  readonly expiresAt: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly comment: string | null;
  readonly createdAt: string;
}

/** Identity bound by the route wrapper; decisions never take it from the caller. */
export interface TaskActorContext {
  readonly actor: string | null;
}

/**
 * Server-only task surface. `bindScope` is framework plumbing: a handler's calls join
 * the request transaction instead of opening a second one on the single PGlite connection
 * (the same reason as `ctx.jobs`, docs/JOBS.md §8).
 */
export interface TasksApi {
  request(input: RequestTaskInput): Promise<TaskRecord>;
  get(id: string): Promise<TaskRecord | null>;
  list(options?: TaskListOptions): Promise<TaskRecord[]>;
  /** Compare-and-set `pending -> decided`; a repeated decide is `task_already_decided`. */
  decide(id: string, decision: TaskDecisionInput): Promise<TaskRecord>;
  /** Cancels a pending task; false for unknown or already-settled ids. */
  cancel(id: string): Promise<boolean>;
  bindScope?(scope: PolicyScopedDatabase, context: TaskActorContext): TasksApi;
}

/**
 * Serializes task data through a JSON round-trip: what the row stores is exactly what the
 * API hands back. Non-serializable values are a contract violation, not a coercion.
 */
export function serializeTaskData(value: unknown): TaskJson {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    throw new TaskError("task_invalid_input", "Task data is not JSON-serializable.", {
      cause: error,
    });
  }
  if (encoded === undefined) {
    throw new TaskError("task_invalid_input", "Task data is not JSON-serializable (undefined).");
  }
  // JSON.parse of a JSON.stringify result is always a TaskJson by construction.
  return JSON.parse(encoded) as TaskJson;
}

/** Substituted by the route wrapper when the task runtime did not boot (D-135). */
export function unavailableTasks(): TasksApi {
  // Reject (not throw synchronously): callers await the API, exactly like ctx.jobs.
  const unavailable = async (): Promise<never> => {
    throw new TaskError("task_unavailable", "The manual-task runtime is not available.");
  };
  return {
    request: unavailable,
    get: unavailable,
    list: unavailable,
    decide: unavailable,
    cancel: unavailable,
  };
}
