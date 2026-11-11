import { JobError, type JobDefinition } from "@facilis.dev/core";
import { TableAccessError } from "@facilis.dev/db";
import { describe, expect, it } from "vitest";
import type { JobEngineConfig, JobExecutor, JobTimers } from "./contracts.ts";
import { createJobEngine } from "./engine.ts";
import { createMemoryJobStore } from "./memory-store.ts";

type Def = JobDefinition<unknown, unknown>;

type SchemaResult =
  | { readonly success: true; readonly data: unknown }
  | {
      readonly success: false;
      readonly error: {
        readonly issues: readonly {
          readonly path: readonly (string | number)[];
          readonly message: string;
        }[];
      };
    };

type SchemaLike = { readonly safeParse: (value: unknown) => SchemaResult };

const acceptAnything: SchemaLike = { safeParse: (value) => ({ success: true, data: value }) };

function accepting(valid: (value: unknown) => boolean, message: string): SchemaLike {
  return {
    safeParse: (value) =>
      valid(value)
        ? { success: true, data: value }
        : { success: false, error: { issues: [{ path: [], message }] } },
  };
}

function jobDefinition(
  name: string,
  overrides: {
    input?: SchemaLike;
    output?: SchemaLike;
    maxAttempts?: number;
    timeoutMs?: number;
  } = {},
): Def {
  const definition = {
    name,
    input: acceptAnything,
    output: acceptAnything,
    dbTables: [],
    run: async () => null,
  };
  return { ...definition, ...overrides } as unknown as Def;
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function createFakeTimers() {
  const state = {
    current: Date.UTC(2026, 10, 7, 12, 0, 0),
    tasks: [] as { at: number; run: () => void }[],
  };
  return {
    now: (): number => state.current,
    setTimeout: (run: () => void, ms: number): unknown => {
      const task = { at: state.current + Math.max(0, ms), run };
      state.tasks.push(task);
      return task;
    },
    clearTimeout: (handle: unknown): void => {
      state.tasks = state.tasks.filter((task) => task !== handle);
    },
    pending: (): number => state.tasks.length,
    advance: async (ms: number): Promise<void> => {
      const target = state.current + ms;
      for (;;) {
        const due = state.tasks
          .filter((task) => task.at <= target)
          .toSorted((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        state.tasks = state.tasks.filter((task) => task !== due);
        state.current = due.at;
        due.run();
        // oxlint-disable-next-line no-await-in-loop -- the timer queue must settle between ticks
        await flush();
      }
      state.current = target;
    },
  };
}

function fixture(
  options: {
    config?: Partial<JobEngineConfig>;
    definitions?: readonly Def[];
    executor?: JobExecutor;
  } = {},
) {
  const timers: JobTimers & ReturnType<typeof createFakeTimers> = createFakeTimers();
  const store = createMemoryJobStore();
  const definitions = new Map<string, Def>();
  for (const definition of options.definitions ?? [jobDefinition("work")]) {
    definitions.set(definition.name, definition);
  }
  const engine = createJobEngine({
    definitions,
    store,
    config: {
      maxConcurrent: 1,
      maxAttempts: 1,
      retryDelayMs: 0,
      timeoutMs: 1_000,
      pollIntervalMs: 10,
      ...options.config,
    },
    executor: options.executor ?? (async () => ({ ok: true })),
    timers,
  });
  return { engine, store, timers };
}

const aborting: JobExecutor = ({ signal }) =>
  new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });

async function expectStopped(maxAttempts: number, expected: string): Promise<void> {
  const { engine, store, timers } = fixture({ config: { maxAttempts }, executor: aborting });
  const { id } = await engine.enqueue("work", {});
  await engine.start();
  await timers.advance(0);
  await engine.stop();
  expect(await store.get(id)).toMatchObject({ status: expected, error: "interrupted" });
  expect(timers.pending()).toBe(0);
}

describe("createJobEngine", () => {
  it("enqueues a validated queued record, honouring definition overrides", async () => {
    const { engine, store, timers } = fixture({
      definitions: [jobDefinition("report", { maxAttempts: 2, timeoutMs: 4_000 })],
    });
    const { id } = await engine.enqueue("report", { days: 7 });
    expect(await store.get(id)).toMatchObject({
      id,
      name: "report",
      status: "queued",
      input: { days: 7 },
      output: null,
      error: null,
      attempts: 0,
      maxAttempts: 2,
      timeoutMs: 4_000,
      runAt: new Date(timers.now()),
    });
  });
  it("rejects unknown names, invalid input and non-serializable data", async () => {
    const { engine } = fixture({
      definitions: [
        jobDefinition("numbers", {
          input: accepting((v) => typeof v === "number", "Expected number"),
        }),
      ],
    });
    await expect(engine.enqueue("missing", {})).rejects.toMatchObject({ code: "job_unknown" });
    await expect(engine.enqueue("numbers", "nope")).rejects.toMatchObject({
      code: "job_invalid_input",
      message: "Expected number",
    });
    await expect(engine.enqueue("numbers", { big: 1n })).rejects.toBeInstanceOf(JobError);
  });
  it("caps concurrent attempts and starts the next when a slot frees", async () => {
    const resolvers = new Map<string, () => void>();
    const { engine, store, timers } = fixture({
      config: { maxConcurrent: 2 },
      executor: async ({ job }) => {
        await new Promise<void>((resolve) => {
          resolvers.set(job.id, resolve);
        });
        return {};
      },
    });
    const first = (await engine.enqueue("work", { index: 0 })).id;
    await engine.enqueue("work", { index: 1 });
    const third = (await engine.enqueue("work", { index: 2 })).id;
    await engine.start();
    await timers.advance(0);
    expect(resolvers.size).toBe(2);
    expect((await store.get(first))?.status).toBe("running");
    expect((await store.get(third))?.status).toBe("queued");
    resolvers.get(first)?.();
    await flush();
    await timers.advance(0);
    expect((await store.get(third))?.status).toBe("running");
    await engine.stop();
  });
  it("retries after retryDelayMs and fails once maxAttempts is exhausted", async () => {
    const seen: number[] = [];
    const { engine, store, timers } = fixture({
      config: { maxAttempts: 3, retryDelayMs: 100 },
      executor: async ({ job }) => {
        seen.push(job.attempts);
        throw new Error("boom");
      },
    });
    const { id } = await engine.enqueue("work", {});
    await engine.start();
    await timers.advance(0);
    expect(seen).toEqual([1]);
    expect((await store.get(id))?.runAt.getTime()).toBe(timers.now() + 100);
    await timers.advance(99);
    expect(seen).toEqual([1]);
    await timers.advance(1);
    expect(seen).toEqual([1, 2]);
    await timers.advance(100);
    expect(seen).toEqual([1, 2, 3]);
    expect(await store.get(id)).toMatchObject({ status: "failed", attempts: 3, error: "boom" });
  });
  it("fails a declaration violation without retrying and stores only the code", async () => {
    let calls = 0;
    const { engine, store, timers } = fixture({
      // Retries are configured but must not be used: the declaration cannot change at runtime.
      config: { maxAttempts: 3, retryDelayMs: 100 },
      executor: async () => {
        calls += 1;
        throw new TableAccessError("table_not_declared", "secret_table");
      },
    });
    const { id } = await engine.enqueue("work", {});
    await engine.start();
    await timers.advance(0);

    expect(calls).toBe(1);
    const job = await store.get(id);
    expect(job).toMatchObject({ status: "failed", attempts: 1, error: "table_not_declared" });
    expect(job?.error).not.toContain("secret_table");
  });
  it("aborts an attempt that outlives timeoutMs", async () => {
    let signal: AbortSignal | undefined;
    const { engine, store, timers } = fixture({
      config: { timeoutMs: 500 },
      executor: ({ signal: aborted }) => {
        signal = aborted;
        return new Promise(() => undefined);
      },
    });
    const { id } = await engine.enqueue("work", {});
    await engine.start();
    await timers.advance(499);
    expect(signal?.aborted).toBe(false);
    await timers.advance(1);
    expect(signal?.aborted).toBe(true);
    expect(await store.get(id)).toMatchObject({ status: "failed", error: "timeout after 500ms" });
  });
  it("fails an attempt whose result violates the output schema", async () => {
    const { engine, store, timers } = fixture({
      definitions: [
        jobDefinition("typed", {
          output: accepting(
            (value) => typeof value === "number" && value > 0,
            "Expected a positive number",
          ),
        }),
      ],
      executor: async () => "not a number",
    });
    const { id } = await engine.enqueue("typed", {});
    await engine.start();
    await timers.advance(0);
    expect(await store.get(id)).toMatchObject({
      status: "failed",
      error: "Expected a positive number",
      output: null,
    });
  });
  it("cancels queued jobs, aborts running jobs and refuses unknown ids", async () => {
    const { engine, store, timers } = fixture({ executor: aborting });
    const queued = await engine.enqueue("work", {});
    await engine.start();
    expect(await engine.cancel(queued.id)).toBe(true);
    expect((await store.get(queued.id))?.status).toBe("cancelled");
    expect(await engine.cancel("00000000-0000-4000-8000-000000000000")).toBe(false);
    const running = await engine.enqueue("work", {});
    await timers.advance(0);
    expect((await store.get(running.id))?.status).toBe("running");
    expect(await engine.cancel(running.id)).toBe(true);
    await flush();
    expect(await store.get(running.id)).toMatchObject({ status: "cancelled", error: null });
  });
  it("does not claim a job before its runAt", async () => {
    const { engine, store, timers } = fixture();
    const { id } = await engine.enqueue("work", {}, { runAt: new Date(timers.now() + 500) });
    await engine.start();
    await timers.advance(499);
    expect((await store.get(id))?.status).toBe("queued");
    await timers.advance(1);
    expect((await store.get(id))?.status).toBe("succeeded");
  });
  it("settles in-flight attempts as interrupted on stop", async () => {
    await expectStopped(2, "queued");
    await expectStopped(1, "failed");
  });
  it("reports per-status counts", async () => {
    const { engine, timers } = fixture({
      definitions: [jobDefinition("ok"), jobDefinition("bad")],
      executor: async ({ job }) => {
        if (job.name === "bad") throw new Error("nope");
        return {};
      },
    });
    await engine.enqueue("ok", {});
    await engine.start();
    await timers.advance(0);
    await engine.enqueue("bad", {});
    await timers.advance(0);
    const cancelled = await engine.enqueue("ok", {});
    expect(await engine.cancel(cancelled.id)).toBe(true);
    expect(await engine.stats()).toEqual({
      queued: 0,
      running: 0,
      succeeded: 1,
      failed: 1,
      cancelled: 1,
    });
  });
});
