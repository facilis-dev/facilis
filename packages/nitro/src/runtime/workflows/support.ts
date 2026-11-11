// Shared helpers of the workflow state machine (D-135, docs/WORKFLOWS.md §8).
//
// Kept out of transitions.ts/dispatch.ts so both files stay under the 300-line gate and the
// compare-and-set policy lives in one place: a transition only applies to the row it read.
import { WorkflowError } from "@facilis.dev/core";
import type { JobJson, WorkflowProgressEntry } from "@facilis.dev/core";

import type { StoredWorkflow, WorkflowRuntimeDeps } from "./contracts.ts";

/** Stored failures are diagnostics, not a log (same bound as a job's error). */
export const MAX_STORED_ERROR = 2000;

export type Now = () => Date;

/** Thrown inside a transaction when the CAS guard no longer matches, to roll the write back. */
export class CasLost extends Error {}

/** Settles a chain as failed, keeping the coded reason in `error`. */
export async function fail(
  deps: WorkflowRuntimeDeps,
  now: Now,
  workflow: StoredWorkflow,
  code: string,
  message: string,
): Promise<void> {
  await deps.store.update(workflow.id, guard(workflow), {
    status: "failed",
    currentJobId: null,
    waitingTaskId: null,
    error: (code + ": " + message).slice(0, MAX_STORED_ERROR),
    finishedAt: now(),
  });
}

/** Every present field is an AND condition: the transition only applies to what it read. */
export function guard(workflow: StoredWorkflow): {
  status: StoredWorkflow["status"];
  currentStep: number;
  currentJobId: string | null;
  waitingTaskId: string | null;
} {
  return {
    status: workflow.status,
    currentStep: workflow.currentStep,
    currentJobId: workflow.currentJobId,
    waitingTaskId: workflow.waitingTaskId,
  };
}

/** The serialized output of the step at `index`, or null when it has none. */
export function lastOutput(
  progress: readonly WorkflowProgressEntry[],
  index: number,
): JobJson | null {
  return progress.find((entry) => entry.index === index)?.output ?? null;
}

export function describe(error: unknown): string {
  return error instanceof WorkflowError || error instanceof Error ? error.message : String(error);
}
