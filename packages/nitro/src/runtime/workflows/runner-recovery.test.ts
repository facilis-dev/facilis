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

/** Any input passes: recovery and expiry are the subject of this file, not Zod. */
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

function setup(steps: readonly WorkflowStep[]): WorkflowsRuntime {
  const definition = defineWorkflow({
    name: FLOW,
    input: ANY_INPUT,
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

describe("workflow recovery and expiry", () => {
  it("expires a due approval task and fails its chain", async () => {
    const flow = setup([{ approval: { titleKey: "flow.approve", ttlMs: 1000 } }]);
    const { id } = await flow.api.start(FLOW, { orderId: "o-1" });
    await flow.tick();
    const waiting = await row(id);
    expect(waiting.status).toBe("waiting");
    const task = await context.tasks.get(waiting.waitingTaskId ?? "");
    expect(task?.expiresAt?.toISOString()).toBe(new Date(BASE.getTime() + 1000).toISOString());

    clock += 5000;
    await flow.tick();

    const failed = await row(id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("workflow_task_expired");
    expect((await context.tasks.get(task?.id ?? ""))?.status).toBe("expired");
  });

  it("re-dispatches a missing step job until the attempt cap, then fails interrupted", async () => {
    const flow = setup([{ job: "reserve-stock" }]);
    const { id } = await flow.api.start(FLOW, { orderId: "o-1" });
    await flow.tick();
    const first = context.jobs.latest;
    if (first === undefined) throw new Error("job missing");

    // The queue lost the row (memory fallback / interrupted process): re-dispatch.
    context.jobs.forget(first.id);
    await flow.tick();
    let stored = await row(id);
    expect(stored.status).toBe("running");
    expect(stored.attempts).toBe(2);
    const second = context.jobs.latest;
    expect(second?.id).not.toBe(first.id);

    context.jobs.forget(second?.id ?? "");
    await flow.tick();
    stored = await row(id);
    expect(stored.status).toBe("failed");
    expect(stored.error).toContain("workflow_interrupted");
  });

  it("fails at the plan snapshot when the definition changed mid-run", async () => {
    const flow = setup([{ job: "reserve-stock" }]);
    const { id } = await flow.api.start(FLOW, { orderId: "o-1" });
    await flow.tick();
    const first = context.jobs.latest;
    if (first === undefined) throw new Error("job missing");
    context.jobs.forget(first.id);

    const changed = defineWorkflow({
      name: FLOW,
      input: ANY_INPUT,
      steps: [{ job: "ship-order" }],
    });
    definitions.set(FLOW, changed as unknown as WorkflowDefinition<unknown, unknown>);
    await flow.tick();

    const failed = await row(id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("workflow_definition_changed");
  });

  it("settles the chain as cancelled when its job is cancelled out of band", async () => {
    const flow = setup([{ job: "reserve-stock" }]);
    const { id } = await flow.api.start(FLOW, { orderId: "o-1" });
    await flow.tick();
    const first = context.jobs.latest;
    if (first === undefined) throw new Error("job missing");
    await context.jobs.cancel(first.id);
    await flow.tick();

    expect((await row(id)).status).toBe("cancelled");
  });
});
