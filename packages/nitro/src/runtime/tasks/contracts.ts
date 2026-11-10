// Internal task-runtime contract (D-135, docs/WORKFLOWS.md §7-8). The public API lives in
// @facilis/core; this module only knows rows, statuses and the store seams.
import type { PolicyScopedDatabase } from "@facilis/db";
import type { JobJson, TaskDecision, TaskKind, TaskStatus } from "@facilis/core";

/** One task as the store sees it: JSON data plus real Dates (the API ISO-izes them). */
export interface StoredTask {
  readonly id: string;
  readonly workflowId: string | null;
  readonly stepIndex: number | null;
  readonly kind: TaskKind;
  readonly status: TaskStatus;
  readonly decision: TaskDecision | null;
  readonly titleKey: string;
  readonly titleParams: JobJson;
  readonly payload: JobJson | null;
  readonly requestedBy: string | null;
  readonly expiresAt: Date | null;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly comment: string | null;
  readonly createdAt: Date;
}

/** What the API writes for a new task; status/decision belong to the store. */
export interface NewStoredTask {
  readonly id: string;
  readonly workflowId: string | null;
  readonly stepIndex: number | null;
  readonly kind: TaskKind;
  readonly titleKey: string;
  readonly titleParams: JobJson;
  readonly payload: JobJson | null;
  readonly requestedBy: string | null;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
}

export interface TaskListFilters {
  readonly status?: TaskStatus | readonly TaskStatus[];
  readonly workflowId?: string;
  /** Already normalised by the API (default 50, max 200). */
  readonly limit: number;
}

/** A decision write: decider, instant and comment land atomically with the status change. */
export interface TaskDecisionWrite {
  readonly decision: TaskDecision;
  readonly decidedBy: string | null;
  readonly comment: string | null;
  readonly now: Date;
}

export interface TaskStore {
  insert(task: NewStoredTask): Promise<void>;
  get(id: string): Promise<StoredTask | null>;
  list(filters: TaskListFilters): Promise<StoredTask[]>;
  /** pending -> decided when the row is still pending and not expired; null otherwise. */
  decide(id: string, write: TaskDecisionWrite): Promise<StoredTask | null>;
  /** pending -> expired (lazy expiry, called by decide); false when the row is not pending. */
  expire(id: string, now: Date): Promise<boolean>;
  /** pending -> cancelled; false when the row is no longer pending. */
  cancel(id: string, now: Date): Promise<boolean>;
  /**
   * Optional view whose operations join the request's policy transaction instead of opening
   * a new one: PGlite is single-connection, so a nested BEGIN would deadlock (D-107, JOBS §8).
   */
  scoped?(scope: PolicyScopedDatabase): TaskStore;
}
