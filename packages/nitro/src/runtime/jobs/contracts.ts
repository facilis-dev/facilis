import type { JobDefinition, JobJson, JobListOptions, JobStatus } from "@facilis/core";
import type { PolicyScopedDatabase } from "@facilis/db";

/**
 * Internal contracts of the job runtime (D-102, docs/JOBS.md §9).
 *
 * The engine and the stores both code against this file so the persistence layer can change
 * (Drizzle table, in-memory fallback) without touching scheduling semantics. `StoredJob` uses
 * Date objects; the public `JobRecord` converts them to ISO strings in runtime.ts.
 */

/** One job row as the store knows it. */
export interface StoredJob {
  readonly id: string;
  readonly name: string;
  readonly status: JobStatus;
  readonly input: JobJson;
  readonly output: JobJson | null;
  readonly error: string | null;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  readonly runAt: Date;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
}

/** What an enqueue writes; the store generates nothing but the id. */
export interface NewStoredJob {
  readonly id: string;
  readonly name: string;
  readonly input: JobJson;
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  readonly runAt: Date;
  readonly createdAt: Date;
}

/** Terminal outcome of one attempt (the engine retries by calling `requeue` instead). */
export type JobOutcome =
  | { readonly status: "succeeded"; readonly output: JobJson; readonly finishedAt: Date }
  | { readonly status: "failed"; readonly error: string; readonly finishedAt: Date }
  | {
      readonly status: "cancelled";
      readonly error: string | null;
      readonly finishedAt: Date;
    };

/** Per-status counters for `ctx.jobs.stats`. */
export interface JobCounts {
  readonly queued: number;
  readonly running: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: number;
}

/** Normalized `list` filter (the API applies defaults and the 200-row cap). */
export type StoredJobListOptions = Omit<JobListOptions, "limit"> & {
  readonly limit: number;
};

/**
 * Persistence seam between the engine and a store implementation.
 *
 * `claim` is the only state transition that must be atomic with respect to the queue: it
 * marks due `queued` rows as `running`, increments `attempts` and sets `startedAt`.
 */
export interface JobStore {
  insert(job: NewStoredJob): Promise<void>;
  get(id: string): Promise<StoredJob | null>;
  list(options: StoredJobListOptions): Promise<StoredJob[]>;
  /** Queued jobs ordered by runAt ascending (the "queue" view). */
  queue(limit?: number): Promise<StoredJob[]>;
  /** Jobs in status "running". */
  running(): Promise<StoredJob[]>;
  /** Atomically claim up to `limit` due jobs for execution. */
  claim(now: Date, limit: number): Promise<StoredJob[]>;
  complete(id: string, outcome: JobOutcome): Promise<void>;
  /** Return a job to "queued" for a retry at `runAt`, retaining the last error. */
  requeue(id: string, options: { readonly runAt: Date; readonly error: string }): Promise<void>;
  /** queued -> cancelled; false when the job is no longer queued. */
  cancelQueued(id: string, finishedAt: Date): Promise<boolean>;
  /** Recover rows left "running" by a crashed process; returns how many were touched. */
  recoverInterrupted(now: Date): Promise<number>;
  counts(): Promise<JobCounts>;
  close(): Promise<void>;
  /**
   * Optional view whose operations join `scope` (the request's policy transaction) instead
   * of opening a new one. PGlite is single-connection: a nested BEGIN would deadlock, so a
   * handler's `ctx.jobs` must reuse the transaction it already runs in (D-102, JOBS §8).
   */
  scoped?(scope: PolicyScopedDatabase): JobStore;
}

/** The engine's slice of `FacilisJobsConfig` (persistence and API caps stay outside). */
export interface JobEngineConfig {
  readonly maxConcurrent: number;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
}

/** Clock and scheduling seam, injected so the engine tests are deterministic. */
export interface JobTimers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * Runs one attempt in a system context (wired to `runAsSystem` in executor.ts).
 *
 * The engine owns input/output validation and serialization; the executor owns the system
 * role, the transaction and the audit entry around the definition's `run`.
 */
export type JobExecutor = (input: {
  readonly definition: JobDefinition<unknown, unknown>;
  readonly data: unknown;
  readonly job: StoredJob;
  readonly signal: AbortSignal;
}) => Promise<unknown>;

export interface JobEngine {
  /** Recovers interrupted rows, then starts ticking until `stop`. Idempotent. */
  start(): Promise<void>;
  /** Stops the ticker, aborts in-flight attempts and requeues them as interrupted. */
  stop(): Promise<void>;
  enqueue(name: string, data: unknown, options?: JobEnqueueOptions): Promise<{ id: string }>;
  get(id: string): Promise<StoredJob | null>;
  list(options?: JobListOptions): Promise<StoredJob[]>;
  queue(): Promise<StoredJob[]>;
  running(): Promise<StoredJob[]>;
  cancel(id: string): Promise<boolean>;
  stats(): Promise<JobCounts>;
  /**
   * Optional view whose queue operations use the store bound to `scope` while sharing this
   * engine's timer and in-flight state. Used to bind `ctx.jobs` to a request transaction.
   */
  scoped?(scope: PolicyScopedDatabase): JobEngine;
}

/** Absolute/relative schedule resolved by the engine (validated by the API layer). */
export interface JobEnqueueOptions {
  readonly runAt?: Date;
}

export interface JobEngineOptions {
  readonly definitions: ReadonlyMap<string, JobDefinition<unknown, unknown>>;
  readonly store: JobStore;
  readonly config: JobEngineConfig;
  readonly executor: JobExecutor;
  /** Defaults to the process clock and timers. */
  readonly timers?: JobTimers;
  /** Receives unexpected engine-level failures (a store write failing in the tick). */
  readonly onError?: (error: unknown, context: string) => void;
}

/** One scanned definition module: virtual module entry, useful for warning messages. */
export interface JobModule {
  readonly file: string;
  readonly definition: unknown;
}
