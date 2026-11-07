import {
  JobError,
  type EnqueueJobOptions,
  type JobQueueStats,
  type JobRecord,
  type JobsApi,
} from "@facilis/core";

import type { PolicyScopedDatabase } from "@facilis/db";

import type { JobEngine, StoredJob } from "./contracts.ts";

/** The booted job runtime carried by `BootstrapState` (D-107). */
export interface JobsRuntime {
  readonly api: JobsApi;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * The API returns `JobRecord`s: the store's `Date`s are JSON-unfriendly and the queue is
 * persisted/serialized data, so every instant crosses the boundary as ISO-8601 (docs/JOBS.md §6).
 */
export function toJobRecord(job: StoredJob): JobRecord {
  return {
    id: job.id,
    name: job.name,
    status: job.status,
    input: job.input,
    output: job.output,
    error: job.error,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    timeoutMs: job.timeoutMs,
    runAt: job.runAt.toISOString(),
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt === null ? null : job.startedAt.toISOString(),
    finishedAt: job.finishedAt === null ? null : job.finishedAt.toISOString(),
  };
}

/**
 * Adapts the engine to the server-only `ctx.jobs` surface (D-107, docs/JOBS.md §6).
 *
 * The relative `delayMs` form is resolved here, not in the engine: the engine only knows
 * absolute instants, which keeps its scheduling deterministic and its tests clock-free.
 */
export function createJobsApi(engine: JobEngine, maxConcurrent: number): JobsApi {
  return {
    async enqueue(name, data, options) {
      const runAt = resolveRunAt(options);
      const engineOptions = runAt === undefined ? undefined : { runAt };
      return await engine.enqueue(name, data, engineOptions);
    },
    async get(id) {
      const job = await engine.get(id);
      return job === null ? null : toJobRecord(job);
    },
    async list(options) {
      return (await engine.list(options)).map(toJobRecord);
    },
    async queue() {
      return (await engine.queue()).map(toJobRecord);
    },
    async running() {
      return (await engine.running()).map(toJobRecord);
    },
    cancel(id) {
      return engine.cancel(id);
    },
    async stats() {
      const counts = await engine.stats();
      return { ...counts, maxConcurrent } satisfies JobQueueStats;
    },
    // Framework plumbing (D-107, docs/JOBS.md §8): the route wrapper binds the API to the
    // request's policy transaction so queue calls join it instead of opening a nested one.
    bindScope(scope: PolicyScopedDatabase): JobsApi {
      const scopedEngine = engine.scoped?.(scope) ?? engine;
      return createJobsApi(scopedEngine, maxConcurrent);
    },
  };
}

/** Validates the author-facing schedule options and resolves them to one instant. */
function resolveRunAt(options: EnqueueJobOptions | undefined): Date | undefined {
  if (options === undefined) return undefined;
  const { runAt, delayMs } = options;
  if (runAt !== undefined && delayMs !== undefined) {
    throw new JobError("job_invalid_schedule", '"runAt" and "delayMs" are mutually exclusive.');
  }
  if (runAt !== undefined) {
    const instant = runAt instanceof Date ? runAt : new Date(runAt);
    if (Number.isNaN(instant.getTime())) {
      throw new JobError("job_invalid_schedule", '"runAt" is not a valid ISO-8601 instant.');
    }
    return instant;
  }
  if (delayMs !== undefined) {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new JobError("job_invalid_schedule", '"delayMs" must be a finite number >= 0.');
    }
    return new Date(Date.now() + delayMs);
  }
  return undefined;
}
