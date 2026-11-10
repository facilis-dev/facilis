// Step dispatch: the two side effects a chain can hand off (D-135, WORKFLOWS.md §8.4).
//
// A job step enqueues its job in the same transaction as the workflow update, and an approval
// step inserts its task in the same transaction as the waiting transition: either both sides
// of the hand-off exist or neither does.
import { randomUUID } from "node:crypto";

import type { WorkflowApprovalStep, WorkflowJobStep, WorkflowResolveContext } from "@facilis/core";
import { runWithPolicyScope } from "@facilis/db";

import type { StoredWorkflow, WorkflowRuntimeDeps } from "./contracts.ts";
import { normalizeTitleParams, planMatches, resolveContext } from "./steps.ts";
import { CasLost, describe, fail, guard, lastOutput, type Now } from "./support.ts";

/** Dispatches the current step: enqueue its job or request its approval (§8.4). */
export async function dispatch(
  deps: WorkflowRuntimeDeps,
  now: Now,
  workflow: StoredWorkflow,
  attempts: number,
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
  const index = workflow.currentStep;
  if (index >= definition.steps.length) {
    await deps.store.update(workflow.id, guard(workflow), {
      status: "succeeded",
      currentStep: index,
      currentJobId: null,
      attempts: 0,
      output: lastOutput(workflow.progress, index - 1),
      error: null,
      finishedAt: now(),
    });
    return;
  }
  if (!planMatches(workflow.plan, definition, index)) {
    return fail(
      deps,
      now,
      workflow,
      "workflow_definition_changed",
      "Step " + index + " changed since the run started.",
    );
  }
  const step = definition.steps[index];
  if (step === undefined) return;
  const context = resolveContext(workflow.input, workflow.progress, index);
  if ("job" in step) {
    return dispatchJob(deps, now, workflow, step, context, attempts);
  }
  return dispatchApproval(deps, now, workflow, step, index, context);
}

/** Resolves, enqueues and records one job step inside a single transaction. */
async function dispatchJob(
  deps: WorkflowRuntimeDeps,
  now: Now,
  workflow: StoredWorkflow,
  step: WorkflowJobStep,
  context: WorkflowResolveContext,
  attempts: number,
): Promise<void> {
  let data: unknown;
  try {
    // No resolver means "the chain input is this job's input": the common first-step case.
    data = step.input === undefined ? workflow.input : step.input(context);
  } catch (error) {
    await fail(deps, now, workflow, "workflow_step_failed", describe(error));
    return;
  }
  try {
    await runWithPolicyScope(deps.db, { tenantId: deps.tenantId }, async (tx) => {
      const store = deps.store.scoped?.(tx) ?? deps.store;
      const jobs = deps.jobs.scoped?.(tx) ?? deps.jobs;
      const { id: jobId } = await jobs.enqueue(step.job, data);
      const updated = await store.update(workflow.id, guard(workflow), {
        status: "running",
        currentJobId: jobId,
        attempts,
      });
      if (updated === null) throw new CasLost();
    });
  } catch (error) {
    if (error instanceof CasLost) return;
    await fail(deps, now, workflow, "workflow_step_failed", describe(error));
  }
}

/** Inserts the approval task and suspends the chain on it inside a single transaction. */
async function dispatchApproval(
  deps: WorkflowRuntimeDeps,
  now: Now,
  workflow: StoredWorkflow,
  step: WorkflowApprovalStep,
  index: number,
  context: WorkflowResolveContext,
): Promise<void> {
  const approval = step.approval;
  let params: Record<string, string | number>;
  try {
    params = normalizeTitleParams(approval.params === undefined ? {} : approval.params(context));
  } catch (error) {
    await fail(deps, now, workflow, "workflow_step_failed", describe(error));
    return;
  }
  const ttl = approval.ttlMs ?? deps.config.defaultTaskTtlMs;
  const taskId = randomUUID();
  const createdAt = now();
  const expiresAt = ttl === null ? null : new Date(createdAt.getTime() + ttl);
  try {
    await runWithPolicyScope(deps.db, { tenantId: deps.tenantId }, async (tx) => {
      const store = deps.store.scoped?.(tx) ?? deps.store;
      const tasks = deps.tasks.scoped?.(tx) ?? deps.tasks;
      await tasks.insert({
        id: taskId,
        workflowId: workflow.id,
        stepIndex: index,
        kind: "approval",
        titleKey: approval.titleKey,
        titleParams: params,
        // The decider sees the chain input; the params are only the rendered title.
        payload: workflow.input,
        requestedBy: "system:workflow:" + workflow.name,
        assignedPermission: approval.permission ?? null,
        expiresAt,
        createdAt,
      });
      const updated = await store.update(workflow.id, guard(workflow), {
        status: "waiting",
        waitingTaskId: taskId,
        attempts: 0,
      });
      if (updated === null) throw new CasLost();
    });
  } catch (error) {
    if (error instanceof CasLost) return;
    await fail(deps, now, workflow, "workflow_step_failed", describe(error));
  }
}
