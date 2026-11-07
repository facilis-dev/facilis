import { describe, expect, it } from "vitest";
import type { JobDefinition } from "@facilis/core";
import type { PolicyScopedDatabase } from "@facilis/db";

import type { JobEngineConfig, JobExecutor, JobStore, JobTimers } from "./contracts.ts";
import { createJobEngine } from "./engine.ts";
import { createMemoryJobStore } from "./memory-store.ts";

// The engine's scoped view is plumbing for the request path: queue calls must go through a
// store bound to the request transaction, while scheduling state stays shared (JOBS §8).
const accept = { safeParse: (value: unknown) => ({ success: true, data: value }) };
const definition = {
  name: "work",
  input: accept,
  output: accept,
  run: async () => null,
} as unknown as JobDefinition<unknown, unknown>;

const TIMERS: JobTimers = { now: () => Date.UTC(2026, 10, 7), setTimeout: () => null, clearTimeout: () => {} };
const CONFIG: JobEngineConfig = {
  maxConcurrent: 1,
  maxAttempts: 1,
  retryDelayMs: 0,
  timeoutMs: 1_000,
  pollIntervalMs: 10,
};
const EXECUTOR: JobExecutor = async () => null;
const SCOPE = { request: "transaction" } as unknown as PolicyScopedDatabase;

function engineWith(store: JobStore) {
  return createJobEngine({
    definitions: new Map([["work", definition]]),
    store,
    config: CONFIG,
    executor: EXECUTOR,
    timers: TIMERS,
  });
}

describe("JobEngine.scoped", () => {
  it("uses the store view bound to the given transaction for reads and writes", async () => {
    const baseStore = createMemoryJobStore();
    const seen: unknown[] = [];
    const view: JobStore = {
      ...baseStore,
      insert: async (job) => {
        seen.push(job.id);
        return baseStore.insert(job);
      },
    };
    let scopedWith: unknown;
    const store: JobStore = {
      ...baseStore,
      scoped: (scope) => {
        scopedWith = scope;
        return view;
      },
    };
    const scoped = engineWith(store).scoped?.(SCOPE);
    expect(scoped).toBeDefined();

    const { id } = await scoped!.enqueue("work", {});
    expect(scopedWith).toBe(SCOPE);
    expect(seen).toEqual([id]);
    // The row went through the base store; the scoped view shares the same scheduler.
    await expect(scoped!.get(id)).resolves.toMatchObject({ id, status: "queued" });
  });

  it("falls back to the same store when the store has no scoped view (memory queue)", async () => {
    const engine = engineWith(createMemoryJobStore());
    const scoped = engine.scoped?.(SCOPE);
    const { id } = await scoped!.enqueue("work", {});

    await expect(engine.get(id)).resolves.toMatchObject({ id, status: "queued" });
  });
});
