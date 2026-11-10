import { beforeEach, describe, expect, it } from "vitest";
import { defineWorkflow } from "@facilis/core";
import type { WorkflowDefinition, WorkflowStep } from "@facilis/core";

import type { WorkflowRuntimeDeps } from "./contracts.ts";
import { createWorkflowRunner, type WorkflowsRuntime } from "./runner.ts";
import {
  BASE,
  clearWorkflows,
  createWorkflowsTestContext,
  TENANT_ID,
  type WorkflowsTestContext,
} from "./workflows-test-harness.ts";

const FLOW = "flow";

/** Any input passes: the runner's transitions are the subject of this file, not Zod. */
const ANY_INPUT = {
  safeParse: (value: unknown) => ({ success: true, data: value }),
} as never;

let context: WorkflowsTestContext;
let clock: number;
let definitions: Map<string, WorkflowDefinition<unknown, unknown>>;
let runner: WorkflowsRuntime;

beforeEach(async () => {
  context = await createWorkflowsTestContext();
  await clearWorkflows(context.db);
  clock = BASE.getTime();
  definitions = new Map();
});

function setup(steps: readonly WorkflowStep[], output?: unknown): WorkflowsRuntime {
  const definition = defineWorkflow({
    name: FLOW,
    input: ANY_INPUT,
    ...(output === undefined ? {} : { output: output as never }),
    steps,
  });
  definitions.set(FLOW, definition as unknown as WorkflowDefinition<unknown, unknown>);
  const deps: WorkflowRuntimeDeps = {
    db: context.db,
    tenantId: TENANT_ID,
    definitions,
    store: context.workflows,
    tasks: context.tasks,
    jobs: context.jobs,
    config: { tickIntervalMs: 1000, persist: true, defaultTaskTtlMs: null },
    maxStepAttempts: 2,
    now: () => new Date(clock),
    timers: { now: () => clock, setTimeout: () => 0, clearTimeout: () => undefined },
  };
  runner = createWorkflowRunner(deps);
  return runner;
}

async function row(id: string) {
  const stored = await context.workflows.get(id);
  if (stored === null) throw new Error("workflow row missing");
  return stored;
}

describe("workflow runner", () => {
  it("chains job -> approval -> job and completes with the last output", async () => {
    const flow = setup([
      { job: "reserve-stock" },
      { approval: { titleKey: "flow.approve" } },
      { job: "ship-order" },
    ]);
    const { id } = await flow.api.start(FLOW, { orderId: "o-1" });

    await flow.tick();
    let stored = await row(id);
    expect(stored.currentJobId).not.toBeNull();
    const first = context.jobs.latest;
    expect(first?.name).toBe("reserve-stock");
    // No resolver on step 0: the chain input is the job input.
    expect(first?.input).toEqual({ orderId: "o-1" });

    if (first === undefined) throw new Error("first job missing");
    context.jobs.succeed(first.id, { amount: 10 });
    await flow.tick();
    stored = await row(id);
    expect(stored.status).toBe("waiting");
    expect(stored.waitingTaskId).not.toBeNull();
    expect(stored.progress).toEqual([
      { index: 0, kind: "job", jobId: first.id, output: { amount: 10 } },
    ]);

    const task = await context.tasks.get(stored.waitingTaskId ?? "");
    expect(task).toMatchObject({
      status: "pending",
      kind: "approval",
      workflowId: id,
      stepIndex: 1,
      titleKey: "flow.approve",
      requestedBy: "system:workflow:" + FLOW,
    });
    if (task === null) throw new Error("approval task missing");

    await context.tasks.decide(task.id, {
      decision: "approve",
      decidedBy: "user-1",
      comment: null,
      now: new Date(clock),
    });
    await flow.tick();
    stored = await row(id);
    expect(stored.status).toBe("running");
    expect(stored.currentStep).toBe(2);
    const second = context.jobs.latest;
    expect(second?.name).toBe("ship-order");
    expect(second?.id).not.toBe(first.id);

    if (second === undefined) throw new Error("second job missing");
    context.jobs.succeed(second.id, { shipped: true });
    await flow.tick();
    stored = await row(id);
    expect(stored.status).toBe("succeeded");
    expect(stored.currentJobId).toBeNull();
    expect(stored.output).toEqual({ shipped: true });
    expect(stored.finishedAt).toBeInstanceOf(Date);
  });

  it("fails the chain when the approval is rejected", async () => {
    const flow = setup([{ approval: { titleKey: "flow.approve" } }]);
    const { id } = await flow.api.start(FLOW, { orderId: "o-1" });
    await flow.tick();
    const stored = await row(id);
    const task = await context.tasks.get(stored.waitingTaskId ?? "");
    if (task === null) throw new Error("approval task missing");

    await context.tasks.decide(task.id, {
      decision: "reject",
      decidedBy: "user-1",
      comment: "no",
      now: new Date(clock),
    });
    await flow.tick();

    const failed = await row(id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("workflow_task_rejected");
  });

  it("continues at the declared reject branch instead of failing", async () => {
    const flow = setup([
      { job: "reserve-stock" },
      { approval: { titleKey: "flow.approve", onReject: { step: 2 } } },
      { job: "ship-order" },
    ]);
    const { id } = await flow.api.start(FLOW, { orderId: "o-1" });
    await flow.tick();
    const first = context.jobs.latest;
    if (first === undefined) throw new Error("job missing");
    context.jobs.succeed(first.id, { amount: 10 });
    await flow.tick();

    const waiting = await row(id);
    const task = await context.tasks.get(waiting.waitingTaskId ?? "");
    if (task === null) throw new Error("approval task missing");
    await context.tasks.decide(task.id, {
      decision: "reject",
      decidedBy: "user-1",
      comment: "no",
      now: new Date(clock),
    });
    await flow.tick();

    const branched = await row(id);
    expect(branched.status).toBe("running");
    expect(branched.currentStep).toBe(2);
    expect(branched.progress).toEqual([
      { index: 0, kind: "job", jobId: first.id, output: { amount: 10 } },
      { index: 1, kind: "approval", taskId: task.id, decision: "reject" },
    ]);
    const second = context.jobs.latest;
    expect(second?.name).toBe("ship-order");
    if (second === undefined) throw new Error("second job missing");
    context.jobs.succeed(second.id, { shipped: true });
    await flow.tick();

    const done = await row(id);
    expect(done.status).toBe("succeeded");
    expect(done.output).toEqual({ shipped: true });
  });

  it("stores the approval's permission on the task as its assignment", async () => {
    const flow = setup([{ approval: { titleKey: "flow.approve", permission: "tasks:decide" } }]);
    const { id } = await flow.api.start(FLOW, { orderId: "o-1" });
    await flow.tick();

    const stored = await row(id);
    const task = await context.tasks.get(stored.waitingTaskId ?? "");
    expect(task?.assignedPermission).toBe("tasks:decide");
  });

  it("fails the chain when a step job fails", async () => {
    const flow = setup([{ job: "reserve-stock" }]);
    const { id } = await flow.api.start(FLOW, { orderId: "o-1" });
    await flow.tick();
    const first = context.jobs.latest;
    if (first === undefined) throw new Error("job missing");
    context.jobs.fail(first.id, "stock unavailable");
    await flow.tick();

    const failed = await row(id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("workflow_step_failed: stock unavailable");
  });

  it("cancels the in-flight job when the chain is cancelled", async () => {
    const flow = setup([{ job: "reserve-stock" }]);
    const { id } = await flow.api.start(FLOW, { orderId: "o-1" });
    await flow.tick();
    const first = context.jobs.latest;
    if (first === undefined) throw new Error("job missing");

    await expect(flow.api.cancel(id)).resolves.toBe(true);
    expect((await row(id)).status).toBe("cancelled");
    expect(context.jobs.jobs.get(first.id)?.status).toBe("cancelled");
  });

  it("rejects a last-step output that violates the definition schema", async () => {
    const rejecting = {
      safeParse: () => ({
        success: false,
        error: { issues: [{ path: [], message: "expected shipped: true" }] },
      }),
    } as never;
    const flow = setup([{ job: "reserve-stock" }], rejecting);
    const { id } = await flow.api.start(FLOW, { orderId: "o-1" });
    await flow.tick();
    const first = context.jobs.latest;
    if (first === undefined) throw new Error("job missing");
    context.jobs.succeed(first.id, { shipped: false });
    await flow.tick();

    const failed = await row(id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("workflow_invalid_output");
  });
});
