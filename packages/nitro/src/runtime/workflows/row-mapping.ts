// Row <-> record mapping for the workflow runtime (D-135, docs/WORKFLOWS.md §5).
//
// StoredWorkflow keeps real Dates and JSON values; WorkflowRecord is the public shape and
// carries ISO-8601 instants, exactly like JobRecord (docs/JOBS.md §6).
import type {
  JobJson,
  WorkflowProgressEntry,
  WorkflowRecord,
  WorkflowStatus,
  WorkflowStepIdentity,
} from "@facilis/core";
import type { FacilisWorkflowRow } from "@facilis/db";

import type { StoredWorkflow } from "./contracts.ts";

export function toStoredWorkflow(row: FacilisWorkflowRow): StoredWorkflow {
  return {
    id: row.id,
    name: row.name,
    status: row.status as WorkflowStatus,
    input: row.input as JobJson,
    // JSONB comes back as parsed JSON; the plan/progress contracts are enforced on write.
    progress: Array.isArray(row.progress) ? (row.progress as WorkflowProgressEntry[]) : [],
    plan: Array.isArray(row.plan) ? (row.plan as WorkflowStepIdentity[]) : [],
    currentStep: row.currentStep,
    currentJobId: row.currentJobId,
    waitingTaskId: row.waitingTaskId,
    attempts: row.attempts,
    output: (row.output as JobJson | null) ?? null,
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  };
}

export function toWorkflowRecord(workflow: StoredWorkflow): WorkflowRecord {
  return {
    id: workflow.id,
    name: workflow.name,
    status: workflow.status,
    input: workflow.input,
    progress: workflow.progress,
    currentStep: workflow.currentStep,
    currentJobId: workflow.currentJobId,
    waitingTaskId: workflow.waitingTaskId,
    attempts: workflow.attempts,
    output: workflow.output,
    error: workflow.error,
    startedAt: workflow.startedAt.toISOString(),
    finishedAt: workflow.finishedAt === null ? null : workflow.finishedAt.toISOString(),
    createdAt: workflow.createdAt.toISOString(),
  };
}
