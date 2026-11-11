import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb, runWithPolicyScope } from "@facilis/db";
import type { FacilisDb } from "@facilis/db";

import { createDbJobStore, isJobsTableAvailable } from "./db-store.ts";
import {
  BASE,
  FINISHED,
  OTHER_TENANT,
  TENANT_ID,
  clearJobs,
  createJobsTestContext,
  insertAndClaim,
  newJob,
  type JobsTestStore,
} from "./db-store-test-harness.ts";

let db: FacilisDb;
let store: JobsTestStore;

beforeAll(async () => {
  ({ db, store } = await createJobsTestContext());
}, 30_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await clearJobs(db);
});

describe("createDbJobStore", () => {
  it("joins a bound request transaction instead of opening a nested one", async () => {
    // Regression: PGlite is single-connection, so a store call opening its own transaction
    // while the request transaction is open deadlocks the request (the bug ctx.jobs hit).
    const job = newJob();
    await runWithPolicyScope(
      db,
      { tenantId: TENANT_ID, permissions: ["jobs:read", "jobs:exec"] },
      async (requestTx) => {
        const requestStore = store.scoped?.(requestTx);
        expect(requestStore).toBeDefined();
        await requestStore?.insert(job);
        await expect(requestStore?.get(job.id)).resolves.toMatchObject({
          id: job.id,
          status: "queued",
        });
      },
    );
    // The queue row committed with the request transaction and the base store sees it.
    await expect(store.get(job.id)).resolves.toMatchObject({ id: job.id, status: "queued" });
  }, 30_000);

  it("denies a request scope that lacks jobs:read/jobs:exec (D-145)", async () => {
    const seeded = newJob();
    await store.insert(seeded);

    // INSERT: the WITH CHECK policy refuses the row (drizzle wraps the driver error, so the
    // message is "Failed query" and the RLS error is the cause).
    await runWithPolicyScope(db, { tenantId: TENANT_ID }, async (requestTx) => {
      await expect(store.scoped?.(requestTx).insert(newJob())).rejects.toThrow();
    });

    // SELECT: USING hides the row (a separate transaction, because the failed INSERT aborted
    // the previous one); the queue is invisible, not an error.
    await runWithPolicyScope(db, { tenantId: TENANT_ID }, async (requestTx) => {
      await expect(store.scoped?.(requestTx).get(seeded.id)).resolves.toBeNull();
    });
  }, 30_000);

  it("detects the queue table without throwing when it is missing", async () => {
    await expect(isJobsTableAvailable(db)).resolves.toBe(true);
    const empty = await createDb();
    try {
      await expect(isJobsTableAvailable(empty)).resolves.toBe(false);
    } finally {
      await empty.close();
    }
    await expect(store.close()).resolves.toBeUndefined();
  }, 30_000);

  it("inserts and reads a job back with its serialized input and real Dates", async () => {
    const input = { olderThanDays: 7, nested: { tags: ["a", 1, true, null] } };
    const job = newJob({ input });
    await store.insert(job);

    const stored = await store.get(job.id);
    expect(stored).toMatchObject({
      id: job.id,
      name: "purge",
      status: "queued",
      input,
      output: null,
      error: null,
      attempts: 0,
      maxAttempts: 3,
      timeoutMs: 10_000,
      startedAt: null,
      finishedAt: null,
    });
    expect(stored?.runAt).toBeInstanceOf(Date);
    expect(stored?.runAt.getTime()).toBe(job.runAt.getTime());
    expect(stored?.createdAt.getTime()).toBe(job.createdAt.getTime());
    await expect(store.get(randomUUID())).resolves.toBeNull();

    // tenant_id comes from the column default fed by app.tenant_id, not from the insert.
    const tenant = await db.db.execute(
      sql`select tenant_id from facilis_jobs where id = ${job.id}`,
    );
    expect(tenant.rows[0]).toEqual({ tenant_id: TENANT_ID });
    // RLS: another tenant's store cannot see the row.
    const other = createDbJobStore({ db, tenantId: OTHER_TENANT });
    await expect(other.get(job.id)).resolves.toBeNull();
  });

  it("lists newest-created first with status, name and limit filters", async () => {
    const c = newJob({ name: "list-c", runAt: new Date(BASE.getTime() - 1_000), createdAt: BASE });
    const later = new Date(BASE.getTime() + 60_000);
    const a1 = newJob({
      name: "list-a",
      runAt: later,
      createdAt: new Date(BASE.getTime() + 1_000),
    });
    const b = newJob({ name: "list-b", runAt: later, createdAt: new Date(BASE.getTime() + 2_000) });
    const a2 = newJob({
      name: "list-a",
      runAt: later,
      createdAt: new Date(BASE.getTime() + 3_000),
    });
    await store.insert(c);
    await store.insert(a1);
    await store.insert(b);
    await store.insert(a2);
    await store.claim(BASE, 10); // claims only c (the single due row)

    const all = await store.list({ limit: 50 });
    expect(all.map((job) => job.id)).toEqual([a2.id, b.id, a1.id, c.id]);
    expect((await store.list({ status: "queued", limit: 50 })).map((job) => job.id)).toEqual([
      a2.id,
      b.id,
      a1.id,
    ]);
    expect((await store.list({ status: ["running"], limit: 50 })).map((job) => job.id)).toEqual([
      c.id,
    ]);
    expect((await store.list({ name: "list-a", limit: 50 })).map((job) => job.id)).toEqual([
      a2.id,
      a1.id,
    ]);
    expect((await store.list({ limit: 2 })).map((job) => job.id)).toEqual([a2.id, b.id]);
    await expect(store.list({ status: [], limit: 50 })).resolves.toEqual([]);
  });

  it("shows queued jobs ordered by runAt and running jobs ordered by start", async () => {
    const q2 = newJob({ runAt: new Date(BASE.getTime() + 2_000) });
    const q1 = newJob({ runAt: new Date(BASE.getTime() + 1_000) });
    const r = newJob({ runAt: new Date(BASE.getTime() - 1_000) });
    await store.insert(q2);
    await store.insert(q1);
    await store.insert(r);
    await store.claim(BASE, 1); // claims r, which is the only due row
    await expect(store.queue()).resolves.toMatchObject([{ id: q1.id }, { id: q2.id }]);
    await expect(store.queue(1)).resolves.toMatchObject([{ id: q1.id }]);
    expect((await store.running()).map((job) => job.id)).toEqual([r.id]);
  });

  it("claims due jobs in runAt order, incrementing attempts and respecting the limit", async () => {
    const early = newJob({ runAt: new Date(BASE.getTime() - 2_000) });
    const late = newJob({ runAt: new Date(BASE.getTime() - 1_000) });
    const future = newJob({ runAt: new Date(BASE.getTime() + 60_000) });
    await store.insert(late);
    await store.insert(future);
    await store.insert(early);

    const first = await store.claim(BASE, 1);
    expect(first.map((job) => job.id)).toEqual([early.id]);
    expect(first[0]).toMatchObject({ status: "running", attempts: 1 });
    expect(first[0]?.startedAt?.getTime()).toBe(BASE.getTime());

    const second = await store.claim(BASE, 5);
    expect(second.map((job) => job.id)).toEqual([late.id]);
    // A claimed row and a not-yet-due row are both invisible to the next claim.
    await expect(store.claim(BASE, 5)).resolves.toEqual([]);
    const later = await store.claim(new Date(BASE.getTime() + 120_000), 5);
    expect(later.map((job) => job.id)).toEqual([future.id]);

    // The counter survives a requeue, so a retry really is attempt 2 (at-least-once).
    await store.requeue(early.id, { runAt: BASE, error: "retry" });
    const retried = await store.claim(BASE, 5);
    expect(retried.find((job) => job.id === early.id)?.attempts).toBe(2);
  });

  it("completes a job as succeeded, failed or cancelled", async () => {
    const succeeded = newJob();
    await insertAndClaim(store, succeeded);
    await store.complete(succeeded.id, {
      status: "succeeded",
      output: { deleted: 3 },
      finishedAt: FINISHED,
    });
    const done = await store.get(succeeded.id);
    expect(done).toMatchObject({ status: "succeeded", output: { deleted: 3 }, error: null });
    expect(done?.finishedAt?.getTime()).toBe(FINISHED.getTime());

    const failed = newJob();
    await insertAndClaim(store, failed);
    await store.complete(failed.id, { status: "failed", error: "boom", finishedAt: FINISHED });
    expect(await store.get(failed.id)).toMatchObject({
      status: "failed",
      output: null,
      error: "boom",
    });

    const cancelled = newJob();
    await insertAndClaim(store, cancelled);
    await store.complete(cancelled.id, { status: "cancelled", error: null, finishedAt: FINISHED });
    expect(await store.get(cancelled.id)).toMatchObject({ status: "cancelled", error: null });
  });

  it("requeues a failed attempt at the retry instant and keeps the last error", async () => {
    const job = newJob();
    await insertAndClaim(store, job);
    const retryAt = new Date(BASE.getTime() + 5_000);
    await store.requeue(job.id, { runAt: retryAt, error: "first failure" });

    const stored = await store.get(job.id);
    expect(stored).toMatchObject({ status: "queued", error: "first failure", attempts: 1 });
    expect(stored?.startedAt).toBeNull();
    expect(stored?.finishedAt).toBeNull();
    expect(stored?.runAt.getTime()).toBe(retryAt.getTime());
    // Not claimable before its retry instant, claimable from it on.
    await expect(store.claim(BASE, 5)).resolves.toEqual([]);
    const claimed = await store.claim(retryAt, 5);
    expect(claimed.map((candidate) => candidate.id)).toEqual([job.id]);
    expect(claimed[0]?.attempts).toBe(2);
  });

  it("cancels only queued jobs and reports whether it changed anything", async () => {
    const queued = newJob();
    await store.insert(queued);
    await expect(store.cancelQueued(queued.id, FINISHED)).resolves.toBe(true);
    const cancelled = await store.get(queued.id);
    expect(cancelled).toMatchObject({ status: "cancelled" });
    expect(cancelled?.finishedAt?.getTime()).toBe(FINISHED.getTime());
    // Terminal rows never transition again, and neither does a running one: the engine
    // aborts the attempt's controller instead.
    await expect(store.cancelQueued(queued.id, FINISHED)).resolves.toBe(false);
    const running = newJob();
    await insertAndClaim(store, running);
    await expect(store.cancelQueued(running.id, FINISHED)).resolves.toBe(false);
    await expect(store.cancelQueued(randomUUID(), FINISHED)).resolves.toBe(false);
  });
});
