// Row <-> store-contract mapping for the persistent job queue (D-107).
//
// Kept apart from db-store.ts so each file stays well under the 300-line limit and the
// mapping is the single place that knows the text status column and the JSONB columns.
import { JOB_STATUSES } from "@facilis.dev/core";
import type { JobJson, JobStatus } from "@facilis.dev/core";
import type { FacilisJobRow } from "@facilis.dev/db";

import type { JobOutcome, StoredJob } from "./contracts.ts";

/**
 * Maps a row to the store contract. The JSONB columns read as `unknown` because Drizzle
 * cannot know the app's JSON shape; the engine serialized them through a JSON round-trip,
 * so they are JobJson by construction (JOBS.md §5).
 */
export function toStoredJob(row: FacilisJobRow): StoredJob {
  return {
    id: row.id,
    name: row.name,
    status: toJobStatus(row.status),
    input: row.input as JobJson,
    output: (row.output ?? null) as JobJson | null,
    error: row.error,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    timeoutMs: row.timeoutMs,
    runAt: row.runAt,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

/** Column set for `complete`: a terminal status plus the fields that status owns. */
export function completionValues(outcome: JobOutcome) {
  switch (outcome.status) {
    case "succeeded":
      return {
        status: "succeeded" as const,
        output: outcome.output,
        error: null,
        finishedAt: outcome.finishedAt,
      };
    case "failed":
      return {
        status: "failed" as const,
        output: null,
        error: outcome.error,
        finishedAt: outcome.finishedAt,
      };
    case "cancelled":
      return {
        status: "cancelled" as const,
        output: null,
        error: outcome.error,
        finishedAt: outcome.finishedAt,
      };
  }
}

/** Narrows the text status column; an unknown value is corrupt queue data, not a job. */
export function toJobStatus(value: string): JobStatus {
  for (const status of JOB_STATUSES) {
    if (status === value) return status;
  }
  throw new Error(`facilis_jobs: unknown status "${value}"`);
}
