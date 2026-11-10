import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineWorkflow, WorkflowError } from "@facilis/core";
import type { WorkflowDefinition } from "@facilis/core";

import type { JobEngine } from "../jobs/contracts.ts";
import type { WorkflowRuntimeDeps } from "./contracts.ts";
import { createWorkflowsApi } from "./runtime.ts";
import {
  BASE,
  clearWorkflows,
  createWorkflowsTestContext,
  TENANT_ID,
  type WorkflowsTestContext,
} from "./workflows-test-harness.ts";

/** Any input passes: the API layer is the subject of this file, not Zod. */
const ANY_INPUT = {
  safeParse: (value: unknown) => ({ success: true, data: value }),
} as never;

const DEFINITIONS = new Map<string, WorkflowDefinition<unknown, unknown>>([
  [
    "order-approval",
    defineWorkflow({
      name: "order-approval",
      input: ANY_INPUT,
      steps: [{ job: "reserve-stock" }, { approval: { titleKey: "order.approve" } }],
    }) as unknown as WorkflowDefinition<unknown, unknown>,
  ],
]);

const ORDER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let context: WorkflowsTestContext;

beforeEach(async () => {
  context = await createWorkflowsTestContext();
  await clearWorkflows(context.db);
});

function deps(overrides: Partial<WorkflowRuntimeDeps> = {}): WorkflowRuntimeDeps {
  return {
    db: context.db,
    tenantId: TENANT_ID,
    definitions: DEFINITIONS,
    store: context.workflows,
    tasks: context.tasks,
    jobs: context.jobs,
    config: { tickIntervalMs: 1000, persist: true, defaultTaskTtlMs: null },
    maxStepAttempts: 2,
    now: () => BASE,
    ...overrides,
  };
}

function createApi(overrides: Partial<WorkflowRuntimeDeps> = {}) {
  const wake = vi.fn();
  return { api: createWorkflowsApi(deps(overrides), wake), wake };
}

describe("createWorkflowsApi.start", () => {
  it("rejects an unknown workflow", async () => {
    const { api } = createApi();
    await expect(api.start("nope", {})).rejects.toMatchObject({ code: "workflow_unknown" });
  });

  it("rejects input that does not match the definition schema", async () => {
    const rejecting = {
      safeParse: () => ({
        success: false,
        error: { issues: [{ path: ["orderId"], message: "Invalid uuid" }] },
      }),
    } as never;
    const strict = new Map(DEFINITIONS);
    strict.set(
      "strict",
      defineWorkflow({
        name: "strict",
        input: rejecting,
        steps: [{ approval: { titleKey: "order.approve" } }],
      }) as unknown as WorkflowDefinition<unknown, unknown>,
    );
    const { api } = createApi({ definitions: strict });
    await expect(api.start("strict", { orderId: "not-a-uuid" })).rejects.toMatchObject({
      code: "workflow_invalid_input",
    });
  });

  it("inserts a running row with the plan snapshot and wakes the runner", async () => {
    const { api, wake } = createApi();
    const { id } = await api.start("order-approval", { orderId: ORDER_ID });

    const stored = await context.workflows.get(id);
    expect(stored).toMatchObject({ name: "order-approval", status: "running", currentStep: 0 });
    expect(stored?.plan).toEqual([
      { index: 0, kind: "job", name: "reserve-stock" },
      { index: 1, kind: "approval", name: "order.approve" },
    ]);
    expect(wake).toHaveBeenCalledTimes(1);
  });
});

describe("createWorkflowsApi reads", () => {
  it("returns ISO-8601 instants and null for unknown ids", async () => {
    const { api } = createApi();
    const { id } = await api.start("order-approval", { orderId: ORDER_ID });
    const record = await api.get(id);
    expect(record?.startedAt).toBe(BASE.toISOString());
    expect(record?.createdAt).toBe(BASE.toISOString());
    expect(record?.finishedAt).toBeNull();
    expect(await api.get("11111111-1111-4111-8111-111111111111")).toBeNull();
  });

  it("validates the list filter instead of guessing", async () => {
    const { api } = createApi();
    await expect(api.list({ status: "bogus" as never })).rejects.toBeInstanceOf(WorkflowError);
    await expect(api.list({ limit: 0 })).rejects.toMatchObject({ code: "workflow_invalid_input" });
  });
});

describe("createWorkflowsApi.cancel", () => {
  it("cancels a running row and reports terminal/unknown rows as false", async () => {
    const { api } = createApi();
    const { id } = await api.start("order-approval", { orderId: ORDER_ID });

    await expect(api.cancel(id)).resolves.toBe(true);
    const stored = await context.workflows.get(id);
    expect(stored?.status).toBe("cancelled");
    expect(stored?.finishedAt).toBeInstanceOf(Date);

    await expect(api.cancel(id)).resolves.toBe(false);
    await expect(api.cancel("11111111-1111-4111-8111-111111111111")).resolves.toBe(false);
  });
});

describe("createWorkflowsApi.bindScope", () => {
  it("rebinds store, tasks and jobs to the request transaction", async () => {
    const scopedStore = { ...context.workflows, scoped: vi.fn(() => context.workflows) };
    const scopedTasks = { ...context.tasks, scoped: vi.fn(() => context.tasks) };
    const scopedJobs = { scoped: vi.fn(() => context.jobs) } as unknown as JobEngine;
    const { api } = createApi({ store: scopedStore, tasks: scopedTasks, jobs: scopedJobs });
    const scope = {} as never;

    await api.bindScope?.(scope).list();

    expect(scopedStore.scoped).toHaveBeenCalledWith(scope);
    expect(scopedTasks.scoped).toHaveBeenCalledWith(scope);
    expect(scopedJobs.scoped).toHaveBeenCalledWith(scope);
  });
});
