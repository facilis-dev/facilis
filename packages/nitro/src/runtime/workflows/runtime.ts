// The server-only workflow API (D-135, docs/WORKFLOWS.md §7).
//
// Validation and JSON serialization live here; the store only knows rows and the runner owns
// every state transition. `start` writes the row and wakes the tick - it never executes a
// step inline, so a route's latency is independent of the chain (WORKFLOWS.md §4).
import { randomUUID } from "node:crypto";

import { serializeWorkflowData, WORKFLOW_STATUSES, WorkflowError } from "@facilis/core";
import type {
  WorkflowDefinition,
  WorkflowListOptions,
  WorkflowRecord,
  WorkflowsApi,
  WorkflowStatus,
} from "@facilis/core";
import type { PolicyScopedDatabase } from "@facilis/db";

import { formatIssues } from "../jobs/engine-support.ts";
import type { WorkflowListFilters, WorkflowRuntimeDeps } from "./contracts.ts";
import { toWorkflowRecord } from "./row-mapping.ts";
import { stepIdentity } from "./steps.ts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Terminal statuses: cancel is a no-op and the tick never reads them. */
export const TERMINAL_WORKFLOW_STATUSES: ReadonlySet<WorkflowStatus> = new Set([
  "succeeded",
  "failed",
  "cancelled",
]);

/**
 * Adapts the workflow store and the job engine to the handler-facing API.
 *
 * `wake` asks the runner for an immediate tick; a bound view (`bindScope`) joins the
 * request transaction for every read/write it performs.
 */
export function createWorkflowsApi(deps: WorkflowRuntimeDeps, wake: () => void): WorkflowsApi {
  const now = (): Date => (deps.now ?? (() => new Date()))();

  const api: WorkflowsApi = {
    async start(name: string, input: unknown): Promise<{ id: string }> {
      const definition = deps.definitions.get(name);
      if (definition === undefined) {
        throw new WorkflowError(
          "workflow_unknown",
          `Workflow "${name}" is not defined by this project.`,
        );
      }
      const data = parseStartInput(definition, input);
      const id = randomUUID();
      const createdAt = now();
      await deps.store.insert({
        id,
        name,
        input: data,
        plan: definition.steps.map(stepIdentity),
        startedAt: createdAt,
        createdAt,
      });
      wake();
      return { id };
    },

    async get(id: string): Promise<WorkflowRecord | null> {
      const workflow = await deps.store.get(id);
      return workflow === null ? null : toWorkflowRecord(workflow);
    },

    async list(options: WorkflowListOptions = {}): Promise<WorkflowRecord[]> {
      return (await deps.store.list(normalizeFilters(options))).map(toWorkflowRecord);
    },

    async cancel(id: string): Promise<boolean> {
      const workflow = await deps.store.get(id);
      if (workflow === null || TERMINAL_WORKFLOW_STATUSES.has(workflow.status)) return false;
      const finishedAt = now();
      // Stop the side effect first, then settle the row: a crash in between leaves the job/
      // task terminal, so the next tick observes cancellation instead of stalling (JOBS §8).
      if (workflow.currentJobId !== null) await deps.jobs.cancel(workflow.currentJobId);
      if (workflow.waitingTaskId !== null) {
        await deps.tasks.cancel(workflow.waitingTaskId, finishedAt);
      }
      const updated = await deps.store.update(
        id,
        {
          status: workflow.status,
          currentStep: workflow.currentStep,
          currentJobId: workflow.currentJobId,
          waitingTaskId: workflow.waitingTaskId,
        },
        {
          status: "cancelled",
          currentJobId: null,
          waitingTaskId: null,
          error: null,
          finishedAt,
        },
      );
      return updated !== null;
    },

    /**
     * A handler's ctx.workflows joins the request's policy transaction, so starting or
     * cancelling inside a route does not open a second transaction on the one connection
     * (D-107, docs/JOBS.md §8).
     */
    bindScope(scope: PolicyScopedDatabase): WorkflowsApi {
      return createWorkflowsApi(
        {
          ...deps,
          store: deps.store.scoped?.(scope) ?? deps.store,
          tasks: deps.tasks.scoped?.(scope) ?? deps.tasks,
          jobs: deps.jobs.scoped?.(scope) ?? deps.jobs,
        },
        wake,
      );
    },
  };
  return api;
}

/** Zod-validates the start input and serializes it for the row (what the runner reads). */
export function parseStartInput(
  definition: WorkflowDefinition<unknown, unknown>,
  input: unknown,
): ReturnType<typeof serializeWorkflowData> {
  const parsed = definition.input.safeParse(input);
  if (!parsed.success) {
    throw new WorkflowError("workflow_invalid_input", formatIssues(parsed.error.issues));
  }
  return serializeWorkflowData(parsed.data);
}

function normalizeFilters(options: WorkflowListOptions): WorkflowListFilters {
  const status = options.status;
  if (status !== undefined) {
    const values = typeof status === "string" ? [status] : [...status];
    for (const value of values) {
      if (!WORKFLOW_STATUSES.includes(value as WorkflowStatus)) {
        throw invalid(`Unknown workflow status "${String(value)}".`);
      }
    }
  }
  return {
    ...(status === undefined ? {} : { status }),
    ...(options.name === undefined ? {} : { name: options.name }),
    limit: normalizeLimit(options.limit),
  };
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1) throw invalid("limit must be a positive integer.");
  return Math.min(value, MAX_LIMIT);
}

function invalid(message: string): WorkflowError {
  return new WorkflowError("workflow_invalid_input", message);
}
