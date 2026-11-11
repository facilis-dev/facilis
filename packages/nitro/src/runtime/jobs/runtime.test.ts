import { describe, expect, it, vi } from "vitest";
import { JobError } from "@facilis.dev/core";
import type { PolicyScopedDatabase } from "@facilis.dev/db";

import type { JobCounts, JobEngine, StoredJob } from "./contracts.ts";
import { createJobsApi, toJobRecord } from "./runtime.ts";

function storedJob(overrides: Partial<StoredJob> = {}): StoredJob {
  return {
    id: "job-1",
    name: "ping",
    status: "queued",
    input: { message: "pong" },
    output: null,
    error: null,
    attempts: 0,
    maxAttempts: 1,
    timeoutMs: 30_000,
    runAt: new Date("2026-11-07T10:00:00.000Z"),
    createdAt: new Date("2026-11-07T09:59:00.000Z"),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

const EMPTY_COUNTS: JobCounts = {
  queued: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  cancelled: 0,
};

/** Minimal engine double: the adapter must not reach past the frozen JobEngine surface. */
function fakeEngine(overrides: Partial<JobEngine> = {}): JobEngine {
  return {
    start: async () => {},
    stop: async () => {},
    enqueue: async () => ({ id: "job-1" }),
    get: async () => null,
    list: async () => [],
    queue: async () => [],
    running: async () => [],
    cancel: async () => false,
    stats: async () => EMPTY_COUNTS,
    ...overrides,
  };
}

interface EnqueueCall {
  readonly name: string;
  readonly data: unknown;
  readonly options: { readonly runAt?: Date } | undefined;
}

function captureEngine(calls: EnqueueCall[]): JobEngine {
  return fakeEngine({
    enqueue: async (name, data, options) => {
      calls.push({ name, data, options });
      return { id: "job-42" };
    },
  });
}

describe("toJobRecord", () => {
  it("turns Date instances into ISO strings and keeps nulls", () => {
    expect(toJobRecord(storedJob())).toEqual({
      id: "job-1",
      name: "ping",
      status: "queued",
      input: { message: "pong" },
      output: null,
      error: null,
      attempts: 0,
      maxAttempts: 1,
      timeoutMs: 30_000,
      runAt: "2026-11-07T10:00:00.000Z",
      createdAt: "2026-11-07T09:59:00.000Z",
      startedAt: null,
      finishedAt: null,
    });
  });

  it("serializes the attempt timestamps of a finished job", () => {
    const record = toJobRecord(
      storedJob({
        status: "succeeded",
        output: { ok: true },
        attempts: 2,
        startedAt: new Date("2026-11-07T10:00:00.500Z"),
        finishedAt: new Date("2026-11-07T10:00:01.000Z"),
      }),
    );
    expect(record.startedAt).toBe("2026-11-07T10:00:00.500Z");
    expect(record.finishedAt).toBe("2026-11-07T10:00:01.000Z");
    expect(record.output).toEqual({ ok: true });
  });
});

describe("createJobsApi bindScope", () => {
  it("delegates to the engine's scoped view and keeps the concurrency cap", async () => {
    const scope = {} as PolicyScopedDatabase;
    const scopedStats = { ...EMPTY_COUNTS, queued: 1 };
    const scoped = vi.fn(() => fakeEngine({ stats: async () => scopedStats }));
    const engine = fakeEngine({ scoped });
    const bound = createJobsApi(engine, 3).bindScope?.(scope);

    expect(scoped).toHaveBeenCalledWith(scope);
    expect(bound).toBeDefined();
    await expect(bound?.stats()).resolves.toEqual({ ...scopedStats, maxConcurrent: 3 });
  });
});

describe("createJobsApi", () => {
  it("maps an absolute ISO runAt to a Date and returns the engine id", async () => {
    const calls: EnqueueCall[] = [];
    const api = createJobsApi(captureEngine(calls), 2);

    await expect(
      api.enqueue("ping", { message: "x" }, { runAt: "2026-11-08T00:00:00.000Z" }),
    ).resolves.toEqual({ id: "job-42" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("ping");
    expect(calls[0]?.data).toEqual({ message: "x" });
    expect(calls[0]?.options?.runAt?.toISOString()).toBe("2026-11-08T00:00:00.000Z");
  });

  it("keeps a Date runAt as the same instant", async () => {
    const calls: EnqueueCall[] = [];
    const api = createJobsApi(captureEngine(calls), 2);

    await api.enqueue("ping", {}, { runAt: new Date("2026-12-01T12:00:00.000Z") });
    expect(calls[0]?.options?.runAt?.toISOString()).toBe("2026-12-01T12:00:00.000Z");
  });

  it("resolves delayMs against the current clock", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-07T10:00:00.000Z"));
      const calls: EnqueueCall[] = [];
      const api = createJobsApi(captureEngine(calls), 2);

      await api.enqueue("ping", {}, { delayMs: 5000 });
      expect(calls[0]?.options?.runAt?.toISOString()).toBe("2026-11-07T10:00:05.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes no schedule when none was requested", async () => {
    const calls: EnqueueCall[] = [];
    const api = createJobsApi(captureEngine(calls), 2);

    await api.enqueue("ping", {});
    expect(calls[0]?.options).toBeUndefined();
  });

  it("rejects runAt + delayMs together as job_invalid_schedule", async () => {
    const api = createJobsApi(fakeEngine(), 2);
    await expect(
      api.enqueue("ping", {}, { runAt: new Date(), delayMs: 1000 }),
    ).rejects.toBeInstanceOf(JobError);
    await expect(
      api.enqueue("ping", {}, { runAt: new Date(), delayMs: 1000 }),
    ).rejects.toMatchObject({ code: "job_invalid_schedule" });
  });

  it("rejects an unparseable runAt and an invalid delayMs", async () => {
    const api = createJobsApi(fakeEngine(), 2);
    await expect(api.enqueue("ping", {}, { runAt: "not-a-date" })).rejects.toMatchObject({
      code: "job_invalid_schedule",
    });
    await expect(api.enqueue("ping", {}, { delayMs: -1 })).rejects.toMatchObject({
      code: "job_invalid_schedule",
    });
  });

  it("maps get/list/queue/running through toJobRecord", async () => {
    const engine = fakeEngine({
      get: async (id) => (id === "known" ? storedJob({ id }) : null),
      list: async () => [storedJob({ id: "a" }), storedJob({ id: "b" })],
      queue: async () => [storedJob({ id: "q" })],
      running: async () => [storedJob({ id: "r", status: "running" })],
    });
    const api = createJobsApi(engine, 2);

    await expect(api.get("unknown")).resolves.toBeNull();
    const found = await api.get("known");
    expect(found?.runAt).toBe("2026-11-07T10:00:00.000Z");
    expect((await api.list())?.map((job) => job.id)).toEqual(["a", "b"]);
    expect((await api.queue()).map((job) => job.id)).toEqual(["q"]);
    expect((await api.running()).map((job) => job.id)).toEqual(["r"]);
  });

  it("delegates cancel and merges maxConcurrent into stats", async () => {
    const engine = fakeEngine({
      cancel: async (id) => id === "queued",
      stats: async () => ({ ...EMPTY_COUNTS, queued: 2, running: 1 }),
    });
    const api = createJobsApi(engine, 3);

    await expect(api.cancel("queued")).resolves.toBe(true);
    await expect(api.cancel("terminal")).resolves.toBe(false);
    await expect(api.stats()).resolves.toEqual({
      queued: 2,
      running: 1,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      maxConcurrent: 3,
    });
  });
});
