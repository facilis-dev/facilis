import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { FacilisDb } from "@facilis.dev/db";

import {
  BASE,
  FINISHED,
  clearJobs,
  createJobsTestContext,
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

describe("createDbJobStore recovery and counters", () => {
  it("recovers interrupted rows: requeues retryable and fails exhausted ones", async () => {
    const retryable = newJob({ maxAttempts: 3 });
    const exhausted = newJob({ maxAttempts: 1 });
    await store.insert(retryable);
    await store.insert(exhausted);
    await store.claim(BASE, 10);

    const recoveredAt = new Date(BASE.getTime() + 30_000);
    await expect(store.recoverInterrupted(recoveredAt)).resolves.toBe(2);

    const requeued = await store.get(retryable.id);
    expect(requeued).toMatchObject({
      status: "queued",
      error: "interrupted (recovered after restart)",
      attempts: 1,
    });
    expect(requeued?.runAt.getTime()).toBe(recoveredAt.getTime());
    expect(requeued?.startedAt).toBeNull();

    const failed = await store.get(exhausted.id);
    expect(failed).toMatchObject({
      status: "failed",
      error: "interrupted (recovered after restart)",
      attempts: 1,
    });
    expect(failed?.finishedAt?.getTime()).toBe(recoveredAt.getTime());
    // A second recovery pass has nothing left to touch.
    await expect(store.recoverInterrupted(recoveredAt)).resolves.toBe(0);
  });

  it("counts jobs by status", async () => {
    await expect(store.counts()).resolves.toEqual({
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    });

    const running = newJob({ runAt: new Date(BASE.getTime() - 3_000) });
    const succeeded = newJob({ runAt: new Date(BASE.getTime() - 2_000) });
    const failed = newJob({ runAt: new Date(BASE.getTime() - 1_000) });
    const cancelled = newJob({ runAt: new Date(BASE.getTime() + 60_000) });
    const queuedA = newJob();
    const queuedB = newJob();
    await store.insert(running);
    await store.insert(succeeded);
    await store.insert(failed);
    await store.insert(cancelled);
    await store.insert(queuedA);
    await store.insert(queuedB);
    await store.claim(BASE, 3); // running, succeeded, failed
    await store.complete(succeeded.id, {
      status: "succeeded",
      output: { deleted: 0 },
      finishedAt: FINISHED,
    });
    await store.complete(failed.id, { status: "failed", error: "boom", finishedAt: FINISHED });
    await store.cancelQueued(cancelled.id, FINISHED);

    await expect(store.counts()).resolves.toEqual({
      queued: 2,
      running: 1,
      succeeded: 1,
      failed: 1,
      cancelled: 1,
    });
  });
});
