// The workflow state machine (D-135, docs/WORKFLOWS.md §8).
//
// Every transition is a short transaction with a compare-and-set guard on the row it read;
// the side-effecting half of a transition (job enqueue, task insert) lives in dispatch.ts.
import type { JobJson, WorkflowDefinition, WorkflowProgressEntry } from "@facilis.dev/core";

import { formatIssues } from "../jobs/engine-support.ts";
import type { StoredTask } from "../tasks/contracts.ts";
import type { StoredWorkflow, WorkflowRuntimeDeps } from "./contracts.ts";
import { dispatch } from "./dispatch.ts";
import { planMatches } from "./steps.ts";
import { fail, guard, type Now } from "./support.ts";

/** Active rows one tick advances; the tick re-arms itself, so this is a fairness bound. */
export const TICK_BATCH = 25;

/** Expires due tasks, then fails the workflows waiting on them (docs/WORKFLOWS.md §8.1). */
export async function expireDueTasks(deps: WorkflowRuntimeDeps, now: Now): Promise<void> {
  const expired = await deps.tasks.expireDue(now(), TICK_BATCH);
  if (expired.length === 0) return;
  for (const task of expired) {
    if (task.workflowId === null) continue;
    const workflow = await deps.store.get(task.workflowId);
    if (workflow === null || workflow.status !== "waiting") continue;
    if (workflow.waitingTaskId !== task.id) continue;
    await fail(deps, now, workflow, "workflow_task_expired", "Task " + task.id + " expired.");
  }
}

/** One transition of one active workflow. */
export async function stepWorkflow(
  deps: WorkflowRuntimeDeps,
  now: Now,
  workflow: StoredWorkflow,
): Promise<void> {
  if (workflow.status === "waiting") return resume(deps, now, workflow);
  if (workflow.currentJobId !== null) return advance(deps, now, workflow);
  return dispatch(deps, now, workflow, 1);
}

/** A decided/expired/cancelled waiting task resumes or fails the chain (§8.2). */
async function resume(
  deps: WorkflowRuntimeDeps,
  now: Now,
  workflow: StoredWorkflow,
): Promise<void> {
  if (workflow.waitingTaskId === null) {
    return fail(deps, now, workflow, "workflow_interrupted", "Waiting workflow has no task.");
  }
  const task = await deps.tasks.get(workflow.waitingTaskId);
  if (task === null) {
    return fail(
      deps,
      now,
      workflow,
      "workflow_interrupted",
      "Task " + workflow.waitingTaskId + " is missing.",
    );
  }
  if (task.status === "pending") {
    if (task.expiresAt !== null && task.expiresAt.getTime() <= now().getTime()) {
      // A decision may have won the race between the read and the expiry: then wait for the
      // next tick, which sees the decided row (the CAS keeps exactly one winner, D-135).
      const expired = await deps.tasks.expire(task.id, now());
      if (expired) {
        return fail(deps, now, workflow, "workflow_task_expired", "Task " + task.id + " expired.");
      }
    }
    return;
  }
  if (task.status === "expired") {
    return fail(deps, now, workflow, "workflow_task_expired", "Task " + task.id + " expired.");
  }
  if (task.status === "cancelled") {
    return fail(
      deps,
      now,
      workflow,
      "workflow_task_cancelled",
      "Task " + task.id + " was cancelled.",
    );
  }
  if (task.decision === "reject") {
    return rejectTask(deps, now, workflow, task);
  }
  const entry: WorkflowProgressEntry = {
    index: task.stepIndex ?? workflow.currentStep,
    kind: "approval",
    taskId: task.id,
    decision: "approve",
  };
  const updated = await deps.store.update(workflow.id, guard(workflow), {
    status: "running",
    waitingTaskId: null,
    progress: [...workflow.progress, entry],
    currentStep: workflow.currentStep + 1,
    attempts: 0,
  });
  if (updated === null) return;
  await dispatch(deps, now, updated, 1);
}

/** A rejected approval continues at its declared step, or fails the run (§8.2). */
async function rejectTask(
  deps: WorkflowRuntimeDeps,
  now: Now,
  workflow: StoredWorkflow,
  task: StoredTask,
): Promise<void> {
  const definition = deps.definitions.get(workflow.name);
  if (definition === undefined) {
    return fail(
      deps,
      now,
      workflow,
      "workflow_definition_changed",
      'Workflow "' + workflow.name + '" is no longer defined.',
    );
  }
  const index = task.stepIndex ?? workflow.currentStep;
  const step = definition.steps[index];
  const target = step !== undefined && "approval" in step ? step.approval.onReject : undefined;
  if (target === undefined) {
    return fail(
      deps,
      now,
      workflow,
      "workflow_task_rejected",
      "Task " + task.id + " was rejected.",
    );
  }
  // A definition edited mid-run must not redirect the branch: the plan snapshot has to still
  // describe the target step (the same rule dispatch applies to the current step).
  if (
    target.step <= index ||
    target.step >= definition.steps.length ||
    !planMatches(workflow.plan, definition, target.step)
  ) {
    return fail(
      deps,
      now,
      workflow,
      "workflow_definition_changed",
      "Step " + target.step + " is not the planned reject target.",
    );
  }
  const entry: WorkflowProgressEntry = {
    index,
    kind: "approval",
    taskId: task.id,
    decision: "reject",
  };
  const updated = await deps.store.update(workflow.id, guard(workflow), {
    status: "running",
    waitingTaskId: null,
    progress: [...workflow.progress, entry],
    currentStep: target.step,
    attempts: 0,
  });
  if (updated !== null) await dispatch(deps, now, updated, 1);
}

/** Settles the in-flight job step: advance, fail, cancelled, or recover a missing job (§8.3). */
async function advance(
  deps: WorkflowRuntimeDeps,
  now: Now,
  workflow: StoredWorkflow,
): Promise<void> {
  const jobId = workflow.currentJobId;
  if (jobId === null) return;
  const job = await deps.jobs.get(jobId);
  if (job === null) {
    // Boot recovery: the queue lost the row (memory fallback or an interrupted process).
    if (workflow.attempts >= deps.maxStepAttempts) {
      return fail(
        deps,
        now,
        workflow,
        "workflow_interrupted",
        "Step job " + jobId + " disappeared after " + workflow.attempts + " dispatch(es).",
      );
    }
    return dispatch(deps, now, workflow, workflow.attempts + 1);
  }
  if (job.status === "queued" || job.status === "running") return;
  if (job.status === "failed") {
    return fail(
      deps,
      now,
      workflow,
      "workflow_step_failed",
      job.error ?? "Job " + jobId + " failed.",
    );
  }
  if (job.status === "cancelled") {
    await deps.store.update(workflow.id, guard(workflow), {
      status: "cancelled",
      currentJobId: null,
      error: null,
      finishedAt: now(),
    });
    return;
  }

  const definition = deps.definitions.get(workflow.name);
  if (definition === undefined) {
    return fail(
      deps,
      now,
      workflow,
      "workflow_definition_changed",
      'Workflow "' + workflow.name + '" is no longer defined.',
    );
  }
  const output = job.output ?? null;
  const entry: WorkflowProgressEntry = {
    index: workflow.currentStep,
    kind: "job",
    jobId,
    ...(output === null ? {} : { output }),
  };
  const progress = [...workflow.progress, entry];
  const nextStep = workflow.currentStep + 1;

  if (nextStep >= definition.steps.length) {
    const invalid = validateOutput(definition, output);
    if (invalid !== null) {
      return fail(deps, now, workflow, "workflow_invalid_output", invalid);
    }
    await deps.store.update(workflow.id, guard(workflow), {
      status: "succeeded",
      progress,
      currentStep: nextStep,
      currentJobId: null,
      attempts: 0,
      output,
      error: null,
      finishedAt: now(),
    });
    return;
  }
  const updated = await deps.store.update(workflow.id, guard(workflow), {
    status: "running",
    progress,
    currentStep: nextStep,
    currentJobId: null,
    attempts: 0,
  });
  if (updated !== null) await dispatch(deps, now, updated, 1);
}

function validateOutput(
  definition: WorkflowDefinition<unknown, unknown>,
  output: JobJson | null,
): string | null {
  if (definition.output === undefined) return null;
  const parsed = definition.output.safeParse(output);
  return parsed.success ? null : formatIssues(parsed.error.issues);
}
