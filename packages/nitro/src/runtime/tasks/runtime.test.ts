import { describe, expect, it } from "vitest";

import type { PolicyScopedDatabase } from "@facilis/db";
import type { StoredTask, TaskDecisionWrite, TaskListFilters, TaskStore } from "./contracts.ts";
import type { NewStoredTask } from "./contracts.ts";
import { createTasksApi } from "./runtime.ts";

/** Minimal in-memory TaskStore: the API layer is what this file exercises. */
class FakeStore implements TaskStore {
  readonly rows = new Map<string, StoredTask>();
  lastFilters: TaskListFilters | null = null;

  async insert(task: NewStoredTask): Promise<void> {
    this.rows.set(task.id, {
      ...task,
      status: "pending",
      decision: null,
      decidedBy: null,
      decidedAt: null,
      comment: null,
    });
  }

  async get(id: string): Promise<StoredTask | null> {
    return this.rows.get(id) ?? null;
  }

  async list(filters: TaskListFilters): Promise<StoredTask[]> {
    this.lastFilters = filters;
    let rows = [...this.rows.values()].sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
    );
    if (filters.status !== undefined) {
      const statuses = typeof filters.status === "string" ? [filters.status] : filters.status;
      rows = rows.filter((row) => statuses.includes(row.status));
    }
    if (filters.workflowId !== undefined) {
      rows = rows.filter((row) => row.workflowId === filters.workflowId);
    }
    return rows.slice(0, filters.limit);
  }

  async expireDue(now: Date, limit: number): Promise<StoredTask[]> {
    const due = [...this.rows.values()]
      .filter(
        (row) =>
          row.status === "pending" &&
          row.expiresAt !== null &&
          row.expiresAt.getTime() <= now.getTime(),
      )
      .slice(0, limit);
    for (const row of due) this.rows.set(row.id, { ...row, status: "expired" });
    return due.map((row) => ({ ...row, status: "expired" }));
  }

  async decide(id: string, write: TaskDecisionWrite): Promise<StoredTask | null> {
    const row = this.rows.get(id);
    if (row === undefined || row.status !== "pending") return null;
    if (row.expiresAt !== null && row.expiresAt.getTime() <= write.now.getTime()) return null;
    const next: StoredTask = {
      ...row,
      status: "decided",
      decision: write.decision,
      decidedBy: write.decidedBy,
      decidedAt: write.now,
      comment: write.comment,
    };
    this.rows.set(id, next);
    return next;
  }

  async expire(id: string, now: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || row.status !== "pending") return false;
    if (row.expiresAt === null || row.expiresAt.getTime() > now.getTime()) return false;
    this.rows.set(id, { ...row, status: "expired" });
    return true;
  }

  async cancel(id: string): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || row.status !== "pending") return false;
    this.rows.set(id, { ...row, status: "cancelled" });
    return true;
  }
}

const SCOPE = {} as PolicyScopedDatabase;

function setup() {
  const store = new FakeStore();
  return { store, api: createTasksApi(store) };
}

describe("createTasksApi", () => {
  it("creates a pending approval from the bound actor", async () => {
    const { store, api } = setup();
    const scoped = api.bindScope?.(SCOPE, { actor: "user-1" });
    if (scoped === undefined) throw new Error("bindScope is part of the API");

    const task = await scoped.request({
      titleKey: "todos.approval",
      titleParams: { title: "Buy milk" },
      payload: { todoId: "todo-1" },
    });

    expect(task).toMatchObject({
      status: "pending",
      kind: "approval",
      decision: null,
      titleKey: "todos.approval",
      titleParams: { title: "Buy milk" },
      payload: { todoId: "todo-1" },
      requestedBy: "user-1",
    });
    expect(task.expiresAt).toBeNull();
    expect(store.rows.size).toBe(1);
  });

  it("rejects requests with an invalid title key, payload or expiry", async () => {
    const { api } = setup();
    await expect(api.request({ titleKey: "" })).rejects.toMatchObject({
      code: "task_invalid_input",
    });
    await expect(api.request({ titleKey: "has spaces" })).rejects.toMatchObject({
      code: "task_invalid_input",
    });
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    await expect(api.request({ titleKey: "ok.key", payload: circular })).rejects.toMatchObject({
      code: "task_invalid_input",
    });
    await expect(
      api.request({ titleKey: "ok.key", expiresAt: "not-a-date" }),
    ).rejects.toMatchObject({ code: "task_invalid_input" });
  });

  it("normalises list filters to the documented caps", async () => {
    const { store, api } = setup();
    await api.list();
    expect(store.lastFilters?.limit).toBe(50);
    await api.list({ limit: 500 });
    expect(store.lastFilters?.limit).toBe(200);
    await api.list({ status: ["pending", "decided"], workflowId: "wf-1" });
    expect(store.lastFilters).toMatchObject({
      status: ["pending", "decided"],
      workflowId: "wf-1",
    });
  });

  it("stores an assignment permission and filters the inbox by it", async () => {
    const { store, api } = setup();
    const task = await api.request({
      titleKey: "todos.approval",
      assignedPermission: "tasks:decide",
    });
    expect(task.assignedPermission).toBe("tasks:decide");

    await api.list({ assignedPermission: "tasks:decide" });
    expect(store.lastFilters).toMatchObject({ assignedPermission: "tasks:decide" });

    await expect(
      api.request({ titleKey: "todos.approval", assignedPermission: "has spaces" }),
    ).rejects.toMatchObject({ code: "task_invalid_input" });
  });

  it("decides once and records the bound actor, instant and comment", async () => {
    const { api } = setup();
    const scoped = api.bindScope?.(SCOPE, { actor: "user-7" });
    if (scoped === undefined) throw new Error("bindScope is part of the API");
    const task = await scoped.request({ titleKey: "todos.approval" });

    const decided = await scoped.decide(task.id, { kind: "approve", comment: "  ok  " });
    expect(decided).toMatchObject({ status: "decided", decision: "approve", decidedBy: "user-7" });
    expect(decided.comment).toBe("ok");
    await expect(scoped.decide(task.id, { kind: "reject" })).rejects.toMatchObject({
      code: "task_already_decided",
    });
  });

  it("classifies unknown, cancelled and expired tasks", async () => {
    const { store, api } = setup();
    await expect(api.decide("missing", { kind: "approve" })).rejects.toMatchObject({
      code: "task_not_found",
    });

    const cancelled = await api.request({ titleKey: "todos.approval" });
    await api.cancel(cancelled.id);
    await expect(api.decide(cancelled.id, { kind: "approve" })).rejects.toMatchObject({
      code: "task_already_decided",
    });

    const expired = await api.request({
      titleKey: "todos.approval",
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expect(api.decide(expired.id, { kind: "approve" })).rejects.toMatchObject({
      code: "task_expired",
    });
    expect(store.rows.get(expired.id)?.status).toBe("expired");
  });

  it("cancels a pending task and reports the second attempt", async () => {
    const { api } = setup();
    const task = await api.request({ titleKey: "todos.approval" });
    await expect(api.cancel(task.id)).resolves.toBe(true);
    await expect(api.cancel(task.id)).resolves.toBe(false);
    await expect(api.get(task.id)).resolves.toMatchObject({ status: "cancelled" });
  });
});
