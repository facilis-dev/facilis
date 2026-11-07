import type { PolicyScopedDatabase } from "@facilis/db";
import type { z } from "zod";

/**
 * The background-job contract (D-102, docs/JOBS.md).
 *
 * A job is an independent, server-side unit of work: it receives serialized data, always
 * runs in a system context (its own transaction as `facilis_system`, audited), and
 * returns serialized data. The queue is reachable only from server code (`ctx.jobs`), so
 * it is never an HTTP surface of its own.
 */

/** Lifecycle of one job instance. */
export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

/** A JSON value: exactly what the queue persists and hands back across a reload. */
export type JobJson = null | boolean | number | string | JobJson[] | { [key: string]: JobJson };

/** Runtime failures of the job API, as stable codes (never prose). */
export const JOB_ERROR_CODES = [
  "job_unknown",
  "job_invalid_input",
  "job_invalid_output",
  "job_invalid_schedule",
  "job_unavailable",
] as const;

export type JobErrorCode = (typeof JOB_ERROR_CODES)[number];

/** Thrown when a job cannot be enqueued, or a job's own contract is violated. */
export class JobError extends Error {
  readonly code: JobErrorCode;

  constructor(code: JobErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "JobError";
    this.code = code;
  }
}

/** What a running job sees; `db` is the system-scoped transaction, never a raw client. */
export interface JobRunContext<Input> {
  /** The id `ctx.jobs.enqueue` returned, usable for lookups and cancellation. */
  readonly jobId: string;
  readonly name: string;
  /** 1-based attempt number for this instance. */
  readonly attempt: number;
  readonly data: Input;
  /** Aborted on cancellation, timeout or shutdown; jobs should observe it. */
  readonly signal: AbortSignal;
  /** System-scoped database (runs as `facilis_system`, its own transaction, audited). */
  readonly db: PolicyScopedDatabase;
}

/** Per-job override of the config defaults; omitted keys fall back to `jobs` in the config. */
export interface JobOverrides {
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
}

/** A named job definition; one default export per `server/jobs/**\/*.ts` module. */
export interface JobDefinition<Input = unknown, Output = unknown> extends JobOverrides {
  /** Enqueue key; unique across the project's definitions. */
  readonly name: string;
  /** Payload contract: validated at enqueue and re-parsed before every attempt. */
  readonly input: z.ZodType<Input>;
  /** Result contract: validated before the result is persisted. */
  readonly output: z.ZodType<Output>;
  /** Tables the sudo audit records for this job; `[]` when the job reads none. */
  readonly tables?: readonly string[];
  readonly run: (ctx: JobRunContext<Input>) => Promise<Output> | Output;
}

const JOB_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Declares a job. Authoring errors (bad name, missing schema) throw here, at module load,
 * so the definition registry reports them as a manifest warning instead of failing a run.
 */
export function defineJob<Input = unknown, Output = unknown>(
  definition: JobDefinition<Input, Output>,
): JobDefinition<Input, Output> {
  assertJobName(definition.name);
  assertSchema(definition.input, "input");
  assertSchema(definition.output, "output");
  assertPositiveInteger(definition.maxAttempts, "maxAttempts");
  assertPositiveInteger(definition.timeoutMs, "timeoutMs");
  if (typeof definition.run !== "function") {
    throw new TypeError(`Job "${definition.name}": run must be a function.`);
  }
  if (definition.tables !== undefined) {
    for (const table of definition.tables) {
      if (typeof table !== "string" || table.length === 0) {
        throw new TypeError(`Job "${definition.name}": tables must be non-empty strings.`);
      }
    }
  }
  return definition;
}

/** Structural guard used by the registry; never trusts a module's exported value. */
export function isJobDefinition(value: unknown): value is JobDefinition {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<JobDefinition>;
  return (
    typeof candidate.name === "string" &&
    JOB_NAME_PATTERN.test(candidate.name) &&
    isSchema(candidate.input) &&
    isSchema(candidate.output) &&
    typeof candidate.run === "function"
  );
}

function assertJobName(name: unknown): asserts name is string {
  if (typeof name !== "string" || !JOB_NAME_PATTERN.test(name)) {
    throw new TypeError(
      'Job name must match ^[a-z0-9][a-z0-9._-]*$ (lowercase, no spaces); got "' +
        String(name) +
        '".',
    );
  }
}

function isSchema(value: unknown): value is z.ZodType {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { safeParse?: unknown }).safeParse === "function"
  );
}

function assertSchema(value: unknown, label: string): void {
  if (!isSchema(value)) throw new TypeError(`A job requires a Zod "${label}" schema.`);
}

function assertPositiveInteger(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
    throw new TypeError(`Job ${label} must be a positive integer when present.`);
  }
}

/**
 * Serializes job data through a JSON round-trip: what the queue stores is exactly what the
 * job receives and what `get`/`list` return. Non-serializable values (undefined, BigInt,
 * circular references) are a contract violation, not a silent coercion.
 */
export function serializeJobData(value: unknown, code: JobErrorCode): JobJson {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    throw new JobError(code, "Job data is not JSON-serializable.", { cause: error });
  }
  if (encoded === undefined) {
    throw new JobError(code, "Job data is not JSON-serializable (undefined).");
  }
  // JSON.parse of a JSON.stringify result is always a JobJson by construction.
  return JSON.parse(encoded) as JobJson;
}

/** Options accepted by `ctx.jobs.enqueue`; `runAt` and `delayMs` are exclusive. */
export interface EnqueueJobOptions {
  /** Absolute instant (ISO-8601 string or Date) at which the job becomes eligible. */
  readonly runAt?: string | Date;
  /** Relative delay in milliseconds; equivalent to `runAt: new Date(now + delayMs)`. */
  readonly delayMs?: number;
}

/** One job instance, as the API returns it (all JSON, all timestamps ISO-8601). */
export interface JobRecord {
  readonly id: string;
  readonly name: string;
  readonly status: JobStatus;
  /** The serialized input the job receives. */
  readonly input: JobJson;
  /** The serialized result, only for `succeeded`. */
  readonly output: JobJson | null;
  /** Last failure message of this instance (server-only, truncated); null otherwise. */
  readonly error: string | null;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  /** ISO instant the job becomes eligible. */
  readonly runAt: string;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

/** Filters for `ctx.jobs.list`; order is newest-created first. */
export interface JobListOptions {
  readonly status?: JobStatus | readonly JobStatus[];
  readonly name?: string;
  /** Defaults to 50, capped at 200. */
  readonly limit?: number;
}

/** Counters for the whole queue (not just the current page). */
export interface JobQueueStats {
  readonly queued: number;
  readonly running: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly maxConcurrent: number;
}

/**
 * The server-only job API carried by the route context (D-102).
 *
 * There is deliberately no HTTP route behind it: an app that needs a user-facing surface
 * writes a normal `defineAuthorizedHandler` route and calls these functions.
 */
export interface JobsApi {
  enqueue(name: string, data: unknown, options?: EnqueueJobOptions): Promise<{ id: string }>;
  get(id: string): Promise<JobRecord | null>;
  list(options?: JobListOptions): Promise<JobRecord[]>;
  /** Queued jobs ordered by `runAt` ascending. */
  queue(): Promise<JobRecord[]>;
  /** Jobs executing right now. */
  running(): Promise<JobRecord[]>;
  /** Cancels a queued job or aborts a running one; false when unknown or terminal. */
  cancel(id: string): Promise<boolean>;
  stats(): Promise<JobQueueStats>;
  /**
   * Framework plumbing, not an app-facing knob: returns this API bound to a request's
   * policy-scoped transaction, so queue calls join the request instead of opening a second
   * transaction on the single PGlite connection (D-102, docs/JOBS.md §8).
   */
  bindScope?(scope: PolicyScopedDatabase): JobsApi;
}

/**
 * The API a route context carries when the queue runtime failed to boot (the middleware
 * omits `facilis.jobs`). Routes keep serving; only an actual job call fails, with a code
 * the caller can distinguish instead of a framework-wide 500.
 */
export function unavailableJobs(): JobsApi {
  const reject = async (): Promise<never> => {
    throw new JobError("job_unavailable", "The background-job runtime is not available.");
  };
  const api: JobsApi = {
    enqueue: reject,
    get: reject,
    list: reject,
    queue: reject,
    running: reject,
    cancel: reject,
    stats: reject,
  };
  api.bindScope = () => api;
  return api;
}
