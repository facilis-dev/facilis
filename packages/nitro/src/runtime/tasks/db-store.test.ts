import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@facilis/db";
import type { FacilisDb } from "@facilis/db";

import { createDbTaskStore, isTasksTableAvailable } from "./db-store.ts";
import {
  BASE,
  LATER,
  OTHER_TENANT,
  clearTasks,
  createTasksTestContext,
  newTask,
} from "./tasks-test-harness.ts";

let db: FacilisDb;
let store: ReturnType<typeof createDbTaskStore>;

beforeAll(async () => {
  ({ db, store } = await createTasksTestContext());
}, 30_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await clearTasks(db);
});

describe("createDbTaskStore", () => {
  it("inserts and reads a task back", async () => {
    const task = newTask();
    await store.insert(task);

    const stored = await store.get(task.id);
    expect(stored).toMatchObject({
      id: task.id,
      workflowId: null,
      stepIndex: null,
      kind: "approval",
      status: "pending",
      decision: null,
      titleKey: "todos.approval",
      titleParams: { title: "Buy milk" },
      payload: { todoId: "todo-1" },
      requestedBy: "system:test",
      expiresAt: null,
      decidedBy: null,
      decidedAt: null,
    });
    expect(stored?.createdAt.getTime()).toBe(task.createdAt.getTime());
  });

  it("lists oldest first, filtered by status", async () => {
    const first = newTask({ createdAt: new Date(BASE.getTime() + 3_000) });
    const second = newTask({ createdAt: new Date(BASE.getTime() + 1_000) });
    const decided = newTask();
    await store.insert(first);
    await store.insert(second);
    await store.insert(decided);
    await store.decide(decided.id, { decision: "approve", decidedBy: "u1", comment: null, now: LATER });

    const pending = await store.list({ status: "pending", limit: 10 });
    expect(pending.map((task) => task.id)).toEqual([second.id, first.id]);

    const decidedRows = await store.list({ status: "decided", limit: 10 });
    expect(decidedRows.map((task) => task.id)).toEqual([decided.id]);

    const limited = await store.list({ limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it("decides a pending task atomically and records who, when and why", async () => {
    const task = newTask();
    await store.insert(task);

    const decided = await store.decide(task.id, {
      decision: "approve",
      decidedBy: "user-1",
      comment: "looks good",
      now: LATER,
    });
    expect(decided).toMatchObject({ status: "decided", decision: "approve", decidedBy: "user-1" });
    expect(decided?.decidedAt?.getTime()).toBe(LATER.getTime());

    // The CAS makes the second decision a no-op: exactly one decider wins.
    await expect(
      store.decide(task.id, { decision: "reject", decidedBy: "user-2", comment: null, now: LATER }),
    ).resolves.toBeNull();
  });

  it("never decides an expired task, and expire() only moves pending rows", async () => {
    const task = newTask({ expiresAt: new Date(BASE.getTime() - 60_000) });
    await store.insert(task);

    await expect(
      store.decide(task.id, { decision: "approve", decidedBy: "u1", comment: null, now: BASE }),
    ).resolves.toBeNull();

    await expect(store.expire(task.id, BASE)).resolves.toBe(true);
    await expect(store.expire(task.id, BASE)).resolves.toBe(false);
    await expect(store.get(task.id)).resolves.toMatchObject({ status: "expired" });
  });

  it("cancels only a pending task", async () => {
    const pending = newTask();
    await store.insert(pending);
    await expect(store.cancel(pending.id, BASE)).resolves.toBe(true);
    await expect(store.cancel(pending.id, BASE)).resolves.toBe(false);
    await expect(store.get(pending.id)).resolves.toMatchObject({ status: "cancelled" });

    const decided = newTask();
    await store.insert(decided);
    await store.decide(decided.id, { decision: "approve", decidedBy: "u1", comment: null, now: LATER });
    await expect(store.cancel(decided.id, LATER)).resolves.toBe(false);
  });

  it("cannot read another tenant's tasks", async () => {
    const task = newTask();
    await store.insert(task);

    const otherTenant = createDbTaskStore({ db, tenantId: OTHER_TENANT });
    await expect(otherTenant.get(task.id)).resolves.toBeNull();
    await expect(otherTenant.list({ limit: 10 })).resolves.toEqual([]);
  });

  it("reports whether the table exists", async () => {
    await expect(isTasksTableAvailable(db)).resolves.toBe(true);

    const empty = await createDb();
    await expect(isTasksTableAvailable(empty)).resolves.toBe(false);
    await empty.close();
  });
});
