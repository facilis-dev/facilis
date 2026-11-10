// Internal contracts of the workflow runtime (D-135, docs/WORKFLOWS.md §5-§8). The public
// API lives in @facilis/core; this module only knows rows, statuses and the store seams.
import type { FacilisDb, PolicyScopedDatabase } from "@facilis/db";
import type {
  FacilisWorkflowsConfig,
  JobJson,
  WorkflowDefinition,
  WorkflowProgressEntry,
  WorkflowStatus,
  WorkflowStepIdentity,
} from "@facilis/core";

import type { JobEngine, JobTimers } from "../jobs/contracts.ts";
import type { TaskStore } from "../tasks/contracts.ts";

/** One workflow row as the store knows it: JSON data plus real Dates (the API ISO-izes them). */
export interface StoredWorkflow {
  readonly id: string;
  readonly name: string;
  readonly status: WorkflowStatus;
  readonly input: JobJson;
  readonly progress: readonly WorkflowProgressEntry[];
  readonly plan: readonly WorkflowStepIdentity[];
  readonly currentStep: number;
  readonly currentJobId: string | null;
  readonly waitingTaskId: string | null;
  readonly attempts: number;
  readonly output: JobJson | null;
  readonly error: string | null;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
}

/** What `start` writes; status/attempts belong to the runtime, not the caller. */
export interface NewStoredWorkflow {
  readonly id: string;
  readonly name: string;
  readonly input: JobJson;
  readonly plan: readonly WorkflowStepIdentity[];
  readonly startedAt: Date;
  readonly createdAt: Date;
}

export interface WorkflowListFilters {
  readonly status?: WorkflowStatus | readonly WorkflowStatus[];
  readonly name?: string;
  /** Already normalised by the API (default 50, max 200). */
  readonly limit: number;
}

/**
 * Expected current values for one compare-and-set write. Every present field is an AND
 * condition on the UPDATE, so a transition that lost a race changes nothing.
 */
export interface WorkflowGuard {
  readonly status: WorkflowStatus;
  readonly currentStep?: number;
  readonly currentJobId?: string | null;
  readonly waitingTaskId?: string | null;
}

/** The fields a transition may change; absent fields keep their row value. */
export interface WorkflowPatch {
  readonly status?: WorkflowStatus;
  readonly progress?: readonly WorkflowProgressEntry[];
  readonly currentStep?: number;
  readonly currentJobId?: string | null;
  readonly waitingTaskId?: string | null;
  readonly attempts?: number;
  readonly output?: JobJson | null;
  readonly error?: string | null;
  readonly finishedAt?: Date | null;
}

export interface WorkflowStore {
  insert(workflow: NewStoredWorkflow): Promise<void>;
  get(id: string): Promise<StoredWorkflow | null>;
  list(filters: WorkflowListFilters): Promise<StoredWorkflow[]>;
  /** CAS update; null when the current row no longer matches the guard. */
  update(id: string, guard: WorkflowGuard, patch: WorkflowPatch): Promise<StoredWorkflow | null>;
  /**
   * Optional view whose operations join the request's policy transaction instead of opening
   * a new one: PGlite is single-connection, so a nested BEGIN would deadlock (JOBS §8).
   */
  scoped?(scope: PolicyScopedDatabase): WorkflowStore;
}

/** One scanned definition module: virtual module entry, useful for warning messages. */
export interface WorkflowModule {
  readonly file: string;
  readonly definition: unknown;
}

/** Everything the API and the runner share; the runner is the only writer of transitions. */
export interface WorkflowRuntimeDeps {
  readonly db: FacilisDb;
  readonly tenantId: string;
  readonly definitions: ReadonlyMap<string, WorkflowDefinition<unknown, unknown>>;
  /** Base store; a bound API view swaps in `store.scoped(scope)`. */
  readonly store: WorkflowStore;
  readonly tasks: TaskStore;
  /** The job engine: step dispatch enqueues through it, possibly inside the runner's transaction. */
  readonly jobs: JobEngine;
  readonly config: FacilisWorkflowsConfig;
  /** Step dispatches of one step allowed before the chain fails (`jobs.maxAttempts`). */
  readonly maxStepAttempts: number;
  /** Defaults to the process clock. */
  readonly now?: () => Date;
  /** Defaults to the process timers; tests inject a deterministic ticker. */
  readonly timers?: JobTimers;
  /** Receives unexpected runner failures (a store write failing in the tick). */
  readonly onError?: (error: unknown, context: string) => void;
}
