// The Drizzle-backed job store (D-107, docs/JOBS.md §8).
//
// Every operation runs through `runWithPolicyScope`, i.e. as facilis_app with
// `app.tenant_id` set: a new row's tenant_id comes from the tenantColumn default (the same
// GUC the restrictive policy reads), and a query cannot reach another tenant's queue. The
// engine writes this way; the only escalation is the job body itself, behind the executor.
import { and, asc, count, desc, eq, gte, inArray, lt, lte, sql, type SQL } from "drizzle-orm";

import { facilisJobs, runWithPolicyScope } from "@facilis/db";
import type { FacilisDb, PolicyScopedDatabase } from "@facilis/db";
import type { JobStatus } from "@facilis/core";

import type {
  JobCounts,
  JobOutcome,
  JobStore,
  NewStoredJob,
  StoredJob,
  StoredJobListOptions,
} from "./contracts.ts";
import { completionValues, toJobStatus, toStoredJob } from "./row-mapping.ts";

/** Recovery marker; the memory store writes the same phrase so a fallback is indistinguishable. */
const INTERRUPTED_ERROR = "interrupted (recovered after restart)";

/**
 * The persistent JobStore over `facilis_jobs`.
 *
 * A missing table is not handled here: boot probes it with `isJobsTableAvailable` and picks
 * the memory store instead, so these methods may throw when the project is not migrated.
 * `tenantId` is the deployment tenant the queue belongs to (the single-tenant fallback
 * unless configured).
 */
export function createDbJobStore(options: {
  readonly db: FacilisDb;
  readonly tenantId: string;
  /** Request transaction to join (from `JobStore.scoped`); absent for engine-owned work. */
  readonly scope?: PolicyScopedDatabase;
}): JobStore {
  const { db, tenantId, scope } = options;

  /**
   * One policy-scoped transaction per store operation; a row's tenant_id comes from the GUC.
   *
   * When a scope is bound (a handler's `ctx.jobs`), the operation joins that request
   * transaction instead: PGlite is single-connection and a nested BEGIN would deadlock the
   * request that is waiting for the queue call to return (D-107, docs/JOBS.md §8).
   */
  function run<T>(fn: (tx: PolicyScopedDatabase) => Promise<T>): Promise<T> {
    return scope === undefined ? runWithPolicyScope(db, { tenantId }, fn) : fn(scope);
  }

  return {
    async insert(job: NewStoredJob): Promise<void> {
      await run((tx) =>
        tx.insert(facilisJobs).values({
          id: job.id,
          name: job.name,
          status: "queued",
          input: job.input,
          maxAttempts: job.maxAttempts,
          timeoutMs: job.timeoutMs,
          runAt: job.runAt,
          createdAt: job.createdAt,
        }),
      );
    },

    async get(id: string): Promise<StoredJob | null> {
      return run(async (tx) => {
        const rows = await tx.select().from(facilisJobs).where(eq(facilisJobs.id, id)).limit(1);
        const row = rows[0];
        return row === undefined ? null : toStoredJob(row);
      });
    },

    async list(filters: StoredJobListOptions): Promise<StoredJob[]> {
      return run(async (tx) => {
        const conditions: SQL[] = [];
        if (filters.status !== undefined) {
          conditions.push(
            typeof filters.status === "string"
              ? eq(facilisJobs.status, filters.status)
              : inArray(facilisJobs.status, [...filters.status]),
          );
        }
        if (filters.name !== undefined) conditions.push(eq(facilisJobs.name, filters.name));
        const rows = await tx
          .select()
          .from(facilisJobs)
          .where(and(...conditions))
          .orderBy(desc(facilisJobs.createdAt))
          .limit(filters.limit);
        return rows.map(toStoredJob);
      });
    },

    async queue(limit?: number): Promise<StoredJob[]> {
      return run(async (tx) => {
        const query = tx
          .select()
          .from(facilisJobs)
          .where(eq(facilisJobs.status, "queued"))
          .orderBy(asc(facilisJobs.runAt), asc(facilisJobs.createdAt));
        const rows = limit === undefined ? await query : await query.limit(limit);
        return rows.map(toStoredJob);
      });
    },

    async running(): Promise<StoredJob[]> {
      return run(async (tx) => {
        const rows = await tx
          .select()
          .from(facilisJobs)
          .where(eq(facilisJobs.status, "running"))
          .orderBy(asc(facilisJobs.startedAt));
        return rows.map(toStoredJob);
      });
    },

    async claim(now: Date, limit: number): Promise<StoredJob[]> {
      // Select-then-update in ONE policy-scoped transaction. No SELECT ... SKIP LOCKED: the
      // engine is the only claimer and the runtime assumes a single process per database
      // (docs/JOBS.md §10), so the row cannot be claimed by anyone else between the two
      // statements. The update repeats the queued predicate to stay correct anyway.
      return run(async (tx) => {
        const due = await tx
          .select({ id: facilisJobs.id })
          .from(facilisJobs)
          .where(and(eq(facilisJobs.status, "queued"), lte(facilisJobs.runAt, now)))
          .orderBy(asc(facilisJobs.runAt), asc(facilisJobs.createdAt))
          .limit(limit);
        if (due.length === 0) return [];
        const claimed = await tx
          .update(facilisJobs)
          .set({
            status: "running",
            attempts: sql`${facilisJobs.attempts} + 1`,
            startedAt: now,
          })
          .where(
            and(
              inArray(
                facilisJobs.id,
                due.map((row) => row.id),
              ),
              eq(facilisJobs.status, "queued"),
            ),
          )
          .returning();
        return claimed.map(toStoredJob);
      });
    },

    async complete(id: string, outcome: JobOutcome): Promise<void> {
      await run((tx) =>
        tx.update(facilisJobs).set(completionValues(outcome)).where(eq(facilisJobs.id, id)),
      );
    },

    async requeue(
      id: string,
      retry: { readonly runAt: Date; readonly error: string },
    ): Promise<void> {
      await run((tx) =>
        tx
          .update(facilisJobs)
          .set({
            status: "queued",
            runAt: retry.runAt,
            error: retry.error,
            startedAt: null,
            finishedAt: null,
          })
          .where(eq(facilisJobs.id, id)),
      );
    },

    async cancelQueued(id: string, finishedAt: Date): Promise<boolean> {
      return run(async (tx) => {
        const rows = await tx
          .update(facilisJobs)
          .set({ status: "cancelled", finishedAt })
          .where(and(eq(facilisJobs.id, id), eq(facilisJobs.status, "queued")))
          .returning({ id: facilisJobs.id });
        return rows.length > 0;
      });
    },

    async recoverInterrupted(now: Date): Promise<number> {
      // Two updates in one scope: an exhausted row cannot be retried, a fresh one can. The
      // attempt counter already covers the attempt that the crash interrupted.
      return run(async (tx) => {
        const failed = await tx
          .update(facilisJobs)
          .set({ status: "failed", error: INTERRUPTED_ERROR, finishedAt: now })
          .where(
            and(
              eq(facilisJobs.status, "running"),
              gte(facilisJobs.attempts, facilisJobs.maxAttempts),
            ),
          )
          .returning({ id: facilisJobs.id });
        const requeued = await tx
          .update(facilisJobs)
          .set({
            status: "queued",
            error: INTERRUPTED_ERROR,
            runAt: now,
            startedAt: null,
          })
          .where(
            and(
              eq(facilisJobs.status, "running"),
              lt(facilisJobs.attempts, facilisJobs.maxAttempts),
            ),
          )
          .returning({ id: facilisJobs.id });
        return failed.length + requeued.length;
      });
    },

    async counts(): Promise<JobCounts> {
      return run(async (tx) => {
        const rows = await tx
          .select({ status: facilisJobs.status, total: count() })
          .from(facilisJobs)
          .groupBy(facilisJobs.status);
        const counts: Record<JobStatus, number> = {
          queued: 0,
          running: 0,
          succeeded: 0,
          failed: 0,
          cancelled: 0,
        };
        for (const row of rows) counts[toJobStatus(row.status)] = Number(row.total);
        return counts;
      });
    },

    close(): Promise<void> {
      // The Drizzle client belongs to the process, not to the store; boot owns its lifetime.
      return Promise.resolve();
    },

    /** Joins queue operations to an existing request transaction (see `run` above). */
    scoped(next: PolicyScopedDatabase): JobStore {
      return createDbJobStore({ db, tenantId, scope: next });
    },
  };
}

/**
 * Probe used by boot to pick persistence. `to_regclass` answers `null` for a missing table
 * instead of raising, which is exactly the "project not migrated yet" case (JOBS.md §8).
 */
export async function isJobsTableAvailable(db: FacilisDb): Promise<boolean> {
  const result = await db.db.execute(
    sql`select to_regclass('public.facilis_jobs') is not null as available`,
  );
  return result.rows[0]?.["available"] === true;
}
