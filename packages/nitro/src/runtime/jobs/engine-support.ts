import type { JobTimers } from "./contracts.ts";

/**
 * Small helpers shared by the scheduler and its view (D-102, docs/JOBS.md §7).
 *
 * Split out of engine.ts to keep the scheduler under the 300-line gate; none of this needs
 * the engine's closure state.
 */

/** Default process clock/timers; tests inject a deterministic implementation instead. */
export const SYSTEM_TIMERS: JobTimers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;
/** Stored errors are diagnostics, not a log: bound what a runaway failure can persist. */
export const MAX_STORED_ERROR = 2000;
export const INTERRUPTED_ERROR = "interrupted";

type ValidationIssues = readonly {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}[];

export function formatIssues(issues: ValidationIssues): string {
  return issues
    .map(({ path, message }) =>
      path.length === 0 ? message : `${path.map(String).join(".")}: ${message}`,
    )
    .join("; ");
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return typeof error === "string" && error.length > 0 ? error : "Job attempt failed.";
}

export function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIST_LIMIT;
  return Math.max(0, Math.min(MAX_LIST_LIMIT, Math.trunc(limit)));
}
