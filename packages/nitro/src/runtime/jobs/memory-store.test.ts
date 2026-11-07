import { describe, expect, it } from "vitest";

import type { JobStore, NewStoredJob, StoredJob } from "./contracts.ts";
import { createMemoryJobStore } from "./memory-store.ts";

const START = Date.UTC(2026, 10, 7, 12, 0, 0);
const INTERRUPTED = "interrupted (recovered after restart)";

function newJob(overrides: Partial<NewStoredJob> = {}): NewStoredJob {
  return {
    id: crypto.randomUUID(),
    name: "report",
    input: { days: 7 },
    maxAttempts: 3,
    timeoutMs: 1_000,
    runAt: new Date(START),
    createdAt: new Date(START),
    ...overrides,
  };
}

async function insertAll(...jobs: NewStoredJob[]): Promise<JobStore> {
  const store = createMemoryJobStore();
  await Promise.all(jobs.map((job) => store.insert(job)));
  return store;
}

function ids(jobs: StoredJob[]): string[] {
  return jobs.map((job) => job.id);
}

describe("createMemoryJobStore", () => {
  it("round-trips an inserted row and returns fresh snapshots", async () => {
    const store = createMemoryJobStore();
    const job = newJob();
    await store.insert(job);
    const first = await store.get(job.id);
    const second = await store.get(job.id);
    expect(first).toMatchObject({
      id: job.id,
      name: "report",
      status: "queued",
      input: { days: 7 },
      output: null,
      error: null,
      attempts: 0,
      maxAttempts: 3,
      timeoutMs: 1_000,
      startedAt: null,
      finishedAt: null,
    });
    expect(first?.runAt).toEqual(new Date(START));
    expect(first?.createdAt).toEqual(new Date(START));
    expect(first).not.toBe(second);
    expect(first?.runAt).not.toBe(second?.runAt);
    expect(await store.get("missing")).toBeNull();
  });

  it("lists newest-created first with status/name filters and a limit", async () => {
    const older = newJob({ name: "alpha", createdAt: new Date(START) });
    const newer = newJob({ name: "beta", createdAt: new Date(START + 2_000) });
    const tie = newJob({ name: "alpha", createdAt: new Date(START + 2_000) });
    const store = await insertAll(older, newer, tie);
    await store.complete(older.id, {
      status: "succeeded",
      output: { ok: true },
      finishedAt: new Date(START + 3_000),
    });

    expect(ids(await store.list({ limit: 10 }))).toEqual([tie.id, newer.id, older.id]);
    expect(ids(await store.list({ status: "succeeded", limit: 10 }))).toEqual([older.id]);
    expect(ids(await store.list({ status: ["succeeded", "queued"], limit: 10 }))).toEqual([
      tie.id,
      newer.id,
      older.id,
    ]);
    expect(ids(await store.list({ name: "alpha", limit: 10 }))).toEqual([tie.id, older.id]);
    expect(ids(await store.list({ limit: 1 }))).toEqual([tie.id]);
  });

  it("returns the queue ordered by runAt and claims only due rows", async () => {
    const late = newJob({ runAt: new Date(START + 2_000) });
    const early = newJob({ runAt: new Date(START + 1_000) });
    const store = await insertAll(late, early);

    expect(ids(await store.queue())).toEqual([early.id, late.id]);
    expect(ids(await store.queue(1))).toEqual([early.id]);
    expect(await store.claim(new Date(START + 500), 10)).toEqual([]);
    const claimed = await store.claim(new Date(START + 1_000), 10);
    expect(ids(claimed)).toEqual([early.id]);
    expect(claimed[0]).toMatchObject({
      status: "running",
      attempts: 1,
      startedAt: new Date(START + 1_000),
    });
    expect(ids(await store.queue())).toEqual([late.id]);
    expect(await store.claim(new Date(START + 1_000), 10)).toEqual([]);
  });

  it("claims at most the requested number of due rows", async () => {
    const first = newJob({ runAt: new Date(START - 2_000) });
    const second = newJob({ runAt: new Date(START - 1_000) });
    const store = await insertAll(first, second);
    expect(ids(await store.claim(new Date(START), 1))).toEqual([first.id]);
    expect(ids(await store.claim(new Date(START), 5))).toEqual([second.id]);
    expect((await store.get(first.id))?.attempts).toBe(1);
  });

  it("completes a job with each terminal outcome", async () => {
    const succeeded = newJob();
    const failed = newJob();
    const cancelled = newJob();
    const store = await insertAll(succeeded, failed, cancelled);

    await store.complete(succeeded.id, {
      status: "succeeded",
      output: { deleted: 3 },
      finishedAt: new Date(START + 10),
    });
    expect(await store.get(succeeded.id)).toMatchObject({
      status: "succeeded",
      output: { deleted: 3 },
      error: null,
      finishedAt: new Date(START + 10),
    });
    await store.complete(failed.id, {
      status: "failed",
      error: "boom",
      finishedAt: new Date(START + 20),
    });
    expect(await store.get(failed.id)).toMatchObject({
      status: "failed",
      output: null,
      error: "boom",
    });
    await store.complete(cancelled.id, {
      status: "cancelled",
      error: null,
      finishedAt: new Date(START + 30),
    });
    expect(await store.get(cancelled.id)).toMatchObject({ status: "cancelled", error: null });
  });

  it("requeues a job at the retry instant and retains the error", async () => {
    const job = newJob();
    const store = await insertAll(job);
    await store.claim(new Date(START), 1);
    await store.requeue(job.id, { runAt: new Date(START + 5_000), error: "retry me" });

    expect(await store.get(job.id)).toMatchObject({
      status: "queued",
      attempts: 1,
      error: "retry me",
      runAt: new Date(START + 5_000),
      startedAt: null,
      finishedAt: null,
    });
    expect(await store.claim(new Date(START + 4_999), 10)).toEqual([]);
    expect(ids(await store.claim(new Date(START + 5_000), 10))).toEqual([job.id]);
  });

  it("cancels only queued jobs", async () => {
    const first = newJob();
    const second = newJob();
    const store = await insertAll(first, second);
    await store.claim(new Date(START), 1);

    expect(await store.cancelQueued(first.id, new Date(START + 10))).toBe(false);
    expect(await store.cancelQueued(second.id, new Date(START + 10))).toBe(true);
    expect(await store.get(second.id)).toMatchObject({
      status: "cancelled",
      finishedAt: new Date(START + 10),
    });
    expect(await store.cancelQueued(second.id, new Date(START + 20))).toBe(false);
    expect(await store.cancelQueued("missing", new Date(START))).toBe(false);
  });

  it("recovers interrupted runs, failing the ones out of attempts", async () => {
    const retryable = newJob({ maxAttempts: 2 });
    const exhausted = newJob({ maxAttempts: 1 });
    const store = await insertAll(retryable, exhausted);
    await store.claim(new Date(START), 2);

    expect(await store.recoverInterrupted(new Date(START + 500))).toBe(2);
    expect(await store.get(retryable.id)).toMatchObject({
      status: "queued",
      error: INTERRUPTED,
      runAt: new Date(START + 500),
      startedAt: null,
    });
    expect(await store.get(exhausted.id)).toMatchObject({
      status: "failed",
      error: INTERRUPTED,
      finishedAt: new Date(START + 500),
    });
    expect(await store.recoverInterrupted(new Date(START + 600))).toBe(0);
  });

  it("counts every status and closes without error", async () => {
    const running = newJob();
    const succeeded = newJob();
    const failed = newJob();
    const cancelled = newJob();
    const queued = newJob();
    const store = await insertAll(running, succeeded, failed, cancelled, queued);
    await store.claim(new Date(START), 1);
    await store.complete(succeeded.id, {
      status: "succeeded",
      output: {},
      finishedAt: new Date(START),
    });
    await store.complete(failed.id, {
      status: "failed",
      error: "boom",
      finishedAt: new Date(START),
    });
    await store.complete(cancelled.id, {
      status: "cancelled",
      error: null,
      finishedAt: new Date(START),
    });

    expect(await store.counts()).toEqual({
      queued: 1,
      running: 1,
      succeeded: 1,
      failed: 1,
      cancelled: 1,
    });
    await expect(store.close()).resolves.toBeUndefined();
  });
});
