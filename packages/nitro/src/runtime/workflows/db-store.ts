// The Drizzle-backed workflow store (D-135, docs/WORKFLOWS.md §5-§8).
//
// Every operation runs through runWithPolicyScope, i.e. as facilis_app with app.tenant_id set:
// a new row's tenant_id comes from the tenantColumn default (the same GUC the restrictive
// policy reads), and a query cannot reach another tenant's chains. The runner's transitions
// are compare-and-set UPDATEs, so a transition that lost a race changes nothing.
import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";

import { facilisWorkflows, runWithPolicyScope } from "@facilis/db";
import type { FacilisDb, PolicyScopedDatabase } from "@facilis/db";

import type {
  NewStoredWorkflow,
  StoredWorkflow,
  WorkflowGuard,
  WorkflowListFilters,
  WorkflowPatch,
  WorkflowStore,
} from "./contracts.ts";
import { toStoredWorkflow } from "./row-mapping.ts";

/**
 * The persistent WorkflowStore over facilis_workflows. A missing table is not handled here:
 * boot probes it with isWorkflowsTableAvailable and disables the API instead (D-135: no
 * in-memory mode), so these methods may throw when the project is not migrated.
 */
export function createDbWorkflowStore(options: {
  readonly db: FacilisDb;
  readonly tenantId: string;
  /** Request transaction to join (from WorkflowStore.scoped); absent for runner-owned work. */
  readonly scope?: PolicyScopedDatabase;
}): WorkflowStore {
  const { db, tenantId, scope } = options;

  function run<T>(fn: (tx: PolicyScopedDatabase) => Promise<T>): Promise<T> {
    return scope === undefined ? runWithPolicyScope(db, { tenantId }, fn) : fn(scope);
  }

  return {
    async insert(workflow: NewStoredWorkflow): Promise<void> {
      await run((tx) =>
        tx.insert(facilisWorkflows).values({
          id: workflow.id,
          name: workflow.name,
          status: "running",
          input: workflow.input,
          progress: [],
          plan: workflow.plan,
          currentStep: 0,
          attempts: 0,
          startedAt: workflow.startedAt,
          createdAt: workflow.createdAt,
        }),
      );
    },

    async get(id: string): Promise<StoredWorkflow | null> {
      return run(async (tx) => {
        const rows = await tx
          .select()
          .from(facilisWorkflows)
          .where(eq(facilisWorkflows.id, id))
          .limit(1);
        const row = rows[0];
        return row === undefined ? null : toStoredWorkflow(row);
      });
    },

    async list(filters: WorkflowListFilters): Promise<StoredWorkflow[]> {
      return run(async (tx) => {
        const conditions: SQL[] = [];
        if (filters.status !== undefined) {
          conditions.push(
            typeof filters.status === "string"
              ? eq(facilisWorkflows.status, filters.status)
              : inArray(facilisWorkflows.status, [...filters.status]),
          );
        }
        if (filters.name !== undefined) conditions.push(eq(facilisWorkflows.name, filters.name));
        const rows = await tx
          .select()
          .from(facilisWorkflows)
          .where(conditions.length === 0 ? undefined : and(...conditions))
          // Chain order: the tick advances the oldest active run first.
          .orderBy(asc(facilisWorkflows.createdAt))
          .limit(filters.limit);
        return rows.map(toStoredWorkflow);
      });
    },

    async update(
      id: string,
      guard: WorkflowGuard,
      patch: WorkflowPatch,
    ): Promise<StoredWorkflow | null> {
      const values: Partial<typeof facilisWorkflows.$inferInsert> = {};
      if (patch.status !== undefined) values.status = patch.status;
      if (patch.progress !== undefined) values.progress = [...patch.progress];
      if (patch.currentStep !== undefined) values.currentStep = patch.currentStep;
      if (patch.currentJobId !== undefined) values.currentJobId = patch.currentJobId;
      if (patch.waitingTaskId !== undefined) values.waitingTaskId = patch.waitingTaskId;
      if (patch.attempts !== undefined) values.attempts = patch.attempts;
      if (patch.output !== undefined) values.output = patch.output;
      if (patch.error !== undefined) values.error = patch.error;
      if (patch.finishedAt !== undefined) values.finishedAt = patch.finishedAt;
      if (Object.keys(values).length === 0) throw new Error("workflow update has no fields");

      return run(async (tx) => {
        const conditions: SQL[] = [
          eq(facilisWorkflows.id, id),
          eq(facilisWorkflows.status, guard.status),
        ];
        if (guard.currentStep !== undefined) {
          conditions.push(eq(facilisWorkflows.currentStep, guard.currentStep));
        }
        if (guard.currentJobId !== undefined) {
          conditions.push(
            guard.currentJobId === null
              ? isNull(facilisWorkflows.currentJobId)
              : eq(facilisWorkflows.currentJobId, guard.currentJobId),
          );
        }
        if (guard.waitingTaskId !== undefined) {
          conditions.push(
            guard.waitingTaskId === null
              ? isNull(facilisWorkflows.waitingTaskId)
              : eq(facilisWorkflows.waitingTaskId, guard.waitingTaskId),
          );
        }
        const rows = await tx
          .update(facilisWorkflows)
          .set(values)
          .where(and(...conditions))
          .returning();
        const row = rows[0];
        return row === undefined ? null : toStoredWorkflow(row);
      });
    },

    /** Joins workflow operations to an existing transaction (see run above). */
    scoped(next: PolicyScopedDatabase): WorkflowStore {
      return createDbWorkflowStore({ db, tenantId, scope: next });
    },
  };
}

/**
 * Probe used by boot: to_regclass answers null for a missing table instead of raising, which
 * is exactly the "project not migrated yet" case (D-135).
 */
export async function isWorkflowsTableAvailable(db: FacilisDb): Promise<boolean> {
  const result = await db.db.execute(
    sql`select to_regclass('public.facilis_workflows') is not null as available`,
  );
  return result.rows[0]?.["available"] === true;
}
