import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@facilis.dev/db";
import type { FacilisDb } from "@facilis.dev/db";

import { createDbWorkflowStore, isWorkflowsTableAvailable } from "./db-store.ts";
import type { NewStoredWorkflow } from "./contracts.ts";
import {
  BASE,
  clearWorkflows,
  createWorkflowsTestContext,
  OTHER_TENANT,
  TENANT_ID,
} from "./workflows-test-harness.ts";

let db: FacilisDb;
let store: ReturnType<typeof createDbWorkflowStore>;

beforeEach(async () => {
  ({ db, workflows: store } = await createWorkflowsTestContext());
  await clearWorkflows(db);
});

function newWorkflow(overrides: Partial<NewStoredWorkflow> = {}): NewStoredWorkflow {
  return {
    id: crypto.randomUUID(),
    name: "order-approval",
    input: { orderId: "o-1" },
    plan: [
      { index: 0, kind: "job", name: "reserve-stock" },
      { index: 1, kind: "approval", name: "workflow.order.approve" },
    ],
    startedAt: BASE,
    createdAt: BASE,
    ...overrides,
  };
}

describe("createDbWorkflowStore", () => {
  it("inserts a running row with an empty progress", async () => {
    const workflow = newWorkflow();
    await store.insert(workflow);

    const stored = await store.get(workflow.id);
    expect(stored).toMatchObject({
      id: workflow.id,
      name: "order-approval",
      status: "running",
      input: { orderId: "o-1" },
      progress: [],
      currentStep: 0,
      currentJobId: null,
      waitingTaskId: null,
      attempts: 0,
      output: null,
      error: null,
      finishedAt: null,
    });
    expect(stored?.plan).toEqual(workflow.plan);
  });

  it("lists by status and name in creation order", async () => {
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    await store.insert(newWorkflow({ id: first, createdAt: new Date(BASE.getTime() + 1) }));
    await store.insert(
      newWorkflow({ id: second, name: "other", createdAt: new Date(BASE.getTime() + 2) }),
    );

    const running = await store.list({ status: ["running"], limit: 10 });
    expect(running.map((row) => row.id)).toEqual([first, second]);
    expect((await store.list({ name: "other", limit: 10 })).map((row) => row.id)).toEqual([second]);
    expect(await store.list({ status: ["failed"], limit: 10 })).toEqual([]);
  });

  it("applies a compare-and-set update only while the guard matches", async () => {
    const workflow = newWorkflow();
    await store.insert(workflow);

    const jobId = crypto.randomUUID();
    const updated = await store.update(
      workflow.id,
      { status: "running", currentStep: 0, currentJobId: null, waitingTaskId: null },
      { currentJobId: jobId, attempts: 1 },
    );
    expect(updated).toMatchObject({ currentJobId: jobId, attempts: 1 });

    const stale = await store.update(
      workflow.id,
      { status: "running", currentStep: 0, currentJobId: null, waitingTaskId: null },
      { currentJobId: crypto.randomUUID() },
    );
    expect(stale).toBeNull();
    expect((await store.get(workflow.id))?.currentJobId).toBe(jobId);
  });

  it("settles a row with a status and finishedAt", async () => {
    const workflow = newWorkflow();
    await store.insert(workflow);
    const updated = await store.update(
      workflow.id,
      { status: "running", currentStep: 0, currentJobId: null, waitingTaskId: null },
      {
        status: "succeeded",
        output: { shipped: true },
        finishedAt: new Date(BASE.getTime() + 5000),
      },
    );
    expect(updated?.status).toBe("succeeded");
    expect(updated?.output).toEqual({ shipped: true });
    expect(updated?.finishedAt).toBeInstanceOf(Date);
  });

  it("keeps rows inside their tenant (RLS)", async () => {
    await store.insert(newWorkflow());
    const other = createDbWorkflowStore({ db, tenantId: OTHER_TENANT });
    expect(await other.list({ status: ["running"], limit: 10 })).toEqual([]);
  });
});

describe("isWorkflowsTableAvailable", () => {
  it("detects the table after the migration and its absence on a bare database", async () => {
    expect(await isWorkflowsTableAvailable(db)).toBe(true);
    const bare = await createDb();
    expect(await isWorkflowsTableAvailable(bare)).toBe(false);
  });
});

void TENANT_ID;
