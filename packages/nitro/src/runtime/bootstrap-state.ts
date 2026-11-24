// The per-process bootstrap result (split out of bootstrap.ts for the 300-line gate).
// Everything here is nullable on failure: a broken runtime is a manifest warning, never a
// crashed request (docs/archive/PHASE1-CONTRACTS.md §8).
import type { FacilisDb } from "@facilis.dev/db";
import type { SessionEvent } from "@facilis.dev/auth";
import type {
  FacilisConfig,
  FacilisLoggingApi,
  FacilisLoggingConfig,
  ManifestWarning,
  StorageApi,
} from "@facilis.dev/core";

import type { JobsRuntime } from "./jobs/runtime.ts";
import type { TasksRuntime } from "./tasks/boot.ts";
import type { WorkflowsRuntime } from "./workflows/runner.ts";

export interface BootstrapState {
  readonly db: FacilisDb | null;
  readonly config: FacilisConfig | null;
  readonly warnings: readonly ManifestWarning[];
  readonly startedAt: string;
  /**
   * Background-job runtime (D-107); null when the db or the job boot failed. The context
   * middleware carries `jobs.api` on `event.context.facilis`.
   */
  readonly jobs: JobsRuntime | null;
  /**
   * Manual-task runtime (D-135); null when facilis_tasks is missing or the task boot failed.
   * The context middleware carries tasks.api on event.context.facilis.
   */
  readonly tasks: TasksRuntime | null;
  /**
   * Workflow runtime (D-135); null when the tables or the job queue are unavailable. The
   * context middleware carries workflows.api on event.context.facilis.
   */
  readonly workflows: WorkflowsRuntime | null;
  /** Binary-storage runtime (D-053); null when the boot refused its configuration. */
  readonly storage: StorageApi | null;
  /**
   * Operator logging runtime (D-119). Always present: built from the documented defaults when
   * the project config failed, so the request context never lacks a logger.
   */
  readonly logging: FacilisLoggingApi;
  /** Effective logging config (project defaults + env level override) for the middleware. */
  readonly loggingConfig: FacilisLoggingConfig;
  /** Cached session handler; rebuilt lazily because it closes over the db client. */
  sessionHandler?: (event: SessionEvent) => Promise<void>;
}
