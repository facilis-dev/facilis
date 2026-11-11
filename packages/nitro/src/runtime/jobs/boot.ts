import type { FacilisJobsConfig, ManifestWarning } from "@facilis.dev/core";
import type { FacilisDb } from "@facilis.dev/db";

import type { JobModule, JobStore } from "./contracts.ts";
import { createDbJobStore, isJobsTableAvailable } from "./db-store.ts";
import { buildJobRegistry } from "./definitions.ts";
import { createJobEngine } from "./engine.ts";
import { createSystemJobExecutor } from "./executor.ts";
import { createMemoryJobStore } from "./memory-store.ts";
import { createJobsApi, type JobsRuntime } from "./runtime.ts";

export interface BootJobsOptions {
  readonly db: FacilisDb;
  readonly jobsConfig: FacilisJobsConfig;
  readonly modules: readonly JobModule[];
  readonly tenantId: string;
  /** Session-wide manifest warnings; boot pushes into it instead of throwing. */
  readonly warnings: ManifestWarning[];
}

/**
 * Boots the background-job runtime (D-107, docs/JOBS.md §8).
 *
 * Never throws: a broken queue degrades to "no jobs" with a manifest warning, because the
 * dev server must still serve the project (contracts §8). The returned runtime is carried by
 * `BootstrapState` and exposed as `ctx.jobs`.
 */
export async function bootJobs(options: BootJobsOptions): Promise<JobsRuntime | null> {
  const { db, jobsConfig, modules, tenantId, warnings } = options;
  try {
    const registry = buildJobRegistry(modules);
    warnings.push(...registry.warnings);

    const store = await selectStore(db, jobsConfig, tenantId, warnings);
    // One warning per failing context is enough: a broken store would otherwise flood the
    // manifest on every tick.
    const reportedErrors = new Set<string>();
    const engine = createJobEngine({
      definitions: registry.definitions,
      store,
      config: {
        maxConcurrent: jobsConfig.maxConcurrent,
        maxAttempts: jobsConfig.maxAttempts,
        retryDelayMs: jobsConfig.retryDelayMs,
        timeoutMs: jobsConfig.timeoutMs,
        pollIntervalMs: jobsConfig.pollIntervalMs,
      },
      executor: createSystemJobExecutor(db),
      onError: (error, context) => {
        if (reportedErrors.has(context)) return;
        reportedErrors.add(context);
        warnings.push({
          code: "jobs_runtime_error",
          message: `Background-job scheduler error (${context}): ${describe(error)}`,
        });
      },
    });

    const runtime: JobsRuntime = {
      api: createJobsApi(engine, jobsConfig.maxConcurrent),
      engine,
      definitions: registry.definitions,
      start: () => engine.start(),
      stop: () => engine.stop(),
    };
    await runtime.start();
    return runtime;
  } catch (error) {
    warnings.push({
      code: "jobs_boot_failed",
      message: `Background jobs are disabled: ${describe(error)}`,
    });
    return null;
  }
}

async function selectStore(
  db: FacilisDb,
  jobsConfig: FacilisJobsConfig,
  tenantId: string,
  warnings: ManifestWarning[],
): Promise<JobStore> {
  if (!jobsConfig.persist) return createMemoryJobStore();
  if (await isJobsTableAvailable(db)) return createDbJobStore({ db, tenantId });
  // The project has not applied the framework migration yet: jobs still work, but queued
  // work is lost on the next reload (docs/JOBS.md §8).
  warnings.push({
    code: "jobs_table_missing",
    message:
      "facilis_jobs is missing; background jobs fall back to the in-memory queue. Re-export the table from db/schema.ts and apply the framework migration to persist them.",
  });
  return createMemoryJobStore();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
