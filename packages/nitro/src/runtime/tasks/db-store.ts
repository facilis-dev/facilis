// The Drizzle-backed task store (D-135, docs/WORKFLOWS.md §7).
//
// Every operation runs through runWithPolicyScope, i.e. as facilis_app with app.tenant_id
// set: a new row's tenant_id comes from the tenantColumn default (the same GUC the
// restrictive policy reads), and a query cannot reach another tenant's tasks. The workflow
// runner (W2) reuses this store; only the actor differs.
import { and, asc, eq, gt, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";

import { facilisTasks, runWithPolicyScope } from "@facilis/db";
import type { FacilisDb, PolicyScopedDatabase } from "@facilis/db";

import type {
  NewStoredTask,
  StoredTask,
  TaskDecisionWrite,
  TaskListFilters,
  TaskStore,
} from "./contracts.ts";
import { toStoredTask } from "./row-mapping.ts";

/**
 * The persistent TaskStore over facilis_tasks. A missing table is not handled here: boot
 * probes it with isTasksTableAvailable and disables the API instead (D-135: no memory mode),
 * so these methods may throw when the project is not migrated.
 */
export function createDbTaskStore(options: {
  readonly db: FacilisDb;
  readonly tenantId: string;
  /** Request transaction to join (from TaskStore.scoped); absent for runtime-owned work. */
  readonly scope?: PolicyScopedDatabase;
}): TaskStore {
  const { db, tenantId, scope } = options;

  // One policy-scoped transaction per operation; when a scope is bound (a handler's
  // ctx.tasks), the operation joins that request transaction instead (D-135, JOBS §8).
  function run<T>(fn: (tx: PolicyScopedDatabase) => Promise<T>): Promise<T> {
    return scope === undefined ? runWithPolicyScope(db, { tenantId }, fn) : fn(scope);
  }

  return {
    async insert(task: NewStoredTask): Promise<void> {
      await run((tx) =>
        tx.insert(facilisTasks).values({
          id: task.id,
          workflowId: task.workflowId,
          stepIndex: task.stepIndex,
          kind: task.kind,
          status: "pending",
          titleKey: task.titleKey,
          titleParams: task.titleParams,
          payload: task.payload,
          requestedBy: task.requestedBy,
          expiresAt: task.expiresAt,
          createdAt: task.createdAt,
        }),
      );
    },

    async get(id: string): Promise<StoredTask | null> {
      return run(async (tx) => {
        const rows = await tx.select().from(facilisTasks).where(eq(facilisTasks.id, id)).limit(1);
        const row = rows[0];
        return row === undefined ? null : toStoredTask(row);
      });
    },

    async list(filters: TaskListFilters): Promise<StoredTask[]> {
      return run(async (tx) => {
        const conditions: SQL[] = [];
        if (filters.status !== undefined) {
          conditions.push(
            typeof filters.status === "string"
              ? eq(facilisTasks.status, filters.status)
              : inArray(facilisTasks.status, [...filters.status]),
          );
        }
        if (filters.workflowId !== undefined) {
          conditions.push(eq(facilisTasks.workflowId, filters.workflowId));
        }
        const rows = await tx
          .select()
          .from(facilisTasks)
          .where(conditions.length === 0 ? undefined : and(...conditions))
          // FIFO: the inbox shows the oldest pending request first.
          .orderBy(asc(facilisTasks.createdAt))
          .limit(filters.limit);
        return rows.map(toStoredTask);
      });
    },

    async decide(id: string, write: TaskDecisionWrite): Promise<StoredTask | null> {
      return run(async (tx) => {
        const rows = await tx
          .update(facilisTasks)
          .set({
            status: "decided",
            decision: write.decision,
            decidedBy: write.decidedBy,
            decidedAt: write.now,
            comment: write.comment,
          })
          // Compare-and-set: only the first decider wins, and an expired row cannot be decided.
          .where(
            and(
              eq(facilisTasks.id, id),
              eq(facilisTasks.status, "pending"),
              or(isNull(facilisTasks.expiresAt), gt(facilisTasks.expiresAt, write.now)),
            ),
          )
          .returning();
        const row = rows[0];
        return row === undefined ? null : toStoredTask(row);
      });
    },

    async expireDue(now: Date, limit: number): Promise<StoredTask[]> {
      return run(async (tx) => {
        const due = await tx
          .select({ id: facilisTasks.id })
          .from(facilisTasks)
          .where(and(eq(facilisTasks.status, "pending"), lte(facilisTasks.expiresAt, now)))
          .orderBy(asc(facilisTasks.createdAt))
          .limit(limit);
        if (due.length === 0) return [];
        const rows = await tx
          .update(facilisTasks)
          .set({ status: "expired" })
          .where(
            and(
              eq(facilisTasks.status, "pending"),
              lte(facilisTasks.expiresAt, now),
              inArray(
                facilisTasks.id,
                due.map((row) => row.id),
              ),
            ),
          )
          .returning();
        return rows.map(toStoredTask);
      });
    },

    async expire(id: string, now: Date): Promise<boolean> {
      return run(async (tx) => {
        const rows = await tx
          .update(facilisTasks)
          .set({ status: "expired" })
          .where(
            and(
              eq(facilisTasks.id, id),
              eq(facilisTasks.status, "pending"),
              lte(facilisTasks.expiresAt, now),
            ),
          )
          .returning({ id: facilisTasks.id });
        return rows.length > 0;
      });
    },

    async cancel(id: string, _now: Date): Promise<boolean> {
      return run(async (tx) => {
        const rows = await tx
          .update(facilisTasks)
          .set({ status: "cancelled" })
          .where(and(eq(facilisTasks.id, id), eq(facilisTasks.status, "pending")))
          .returning({ id: facilisTasks.id });
        return rows.length > 0;
      });
    },

    /** Joins task operations to an existing request transaction (see run above). */
    scoped(next: PolicyScopedDatabase): TaskStore {
      return createDbTaskStore({ db, tenantId, scope: next });
    },
  };
}

/**
 * Probe used by boot: to_regclass answers null for a missing table instead of raising, which
 * is exactly the "project not migrated yet" case (D-135).
 */
export async function isTasksTableAvailable(db: FacilisDb): Promise<boolean> {
  const result = await db.db.execute(
    sql`select to_regclass('public.facilis_tasks') is not null as available`,
  );
  return result.rows[0]?.["available"] === true;
}
