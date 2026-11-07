import { z } from "zod";

/**
 * The `jobs` section of `facilis.config.ts` (D-107, docs/JOBS.md §4).
 *
 * Defaults are deliberately conservative: no retry (at-least-once makes retries a business
 * decision), two slots and a 30 s attempt bound. A definition may override maxAttempts and
 * timeoutMs; the rest is queue-wide.
 */
export interface FacilisJobsConfig {
  /** Maximum attempts executing at the same time. */
  readonly maxConcurrent: number;
  /** Total attempts per job including the first; 1 means "no retry". */
  readonly maxAttempts: number;
  /** Fixed delay before a retry. */
  readonly retryDelayMs: number;
  /** Wall-clock bound of one attempt. */
  readonly timeoutMs: number;
  /** Scheduler tick interval. */
  readonly pollIntervalMs: number;
  /** Persist the queue in `facilis_jobs`; false keeps it in memory only. */
  readonly persist: boolean;
}

/** The default `jobs` section; also what a config that omits it resolves to. */
export const DEFAULT_JOBS_CONFIG: FacilisJobsConfig = {
  maxConcurrent: 2,
  maxAttempts: 1,
  retryDelayMs: 5000,
  timeoutMs: 30_000,
  pollIntervalMs: 1000,
  persist: true,
};

const positiveInteger = z.number().int().positive();

/** Zod schema for the authored `jobs` section; `strictObject` rejects unknown keys. */
export const facilisJobsConfigSchema = z
  .strictObject({
    maxConcurrent: positiveInteger.default(DEFAULT_JOBS_CONFIG.maxConcurrent),
    maxAttempts: positiveInteger.default(DEFAULT_JOBS_CONFIG.maxAttempts),
    retryDelayMs: z.number().int().min(0).default(DEFAULT_JOBS_CONFIG.retryDelayMs),
    timeoutMs: positiveInteger.default(DEFAULT_JOBS_CONFIG.timeoutMs),
    // A tick under 100 ms would busy-loop a browser worker for no benefit.
    pollIntervalMs: z.number().int().min(100).default(DEFAULT_JOBS_CONFIG.pollIntervalMs),
    persist: z.boolean().default(DEFAULT_JOBS_CONFIG.persist),
  })
  .default(() => DEFAULT_JOBS_CONFIG);

/** Authored form of the section (every key optional). */
export type FacilisJobsConfigInput = z.input<typeof facilisJobsConfigSchema>;
