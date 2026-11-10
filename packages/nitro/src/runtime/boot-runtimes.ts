// Boots the framework runtimes that sit behind ctx (D-107, D-135, docs/JOBS.md §8).
//
// Split out of bootstrap.ts to keep that file under the 300-line gate. Each boot is
// degradation-safe: a broken queue/task/workflow runtime is a manifest warning and a null
// service, never a failed process (contracts §8).
import {
  DEFAULT_JOBS_CONFIG,
  DEFAULT_WORKFLOWS_CONFIG,
  type FacilisConfig,
  type ManifestWarning,
} from "@facilis/core";
import type { FacilisDb } from "@facilis/db";

import { bootJobs } from "./jobs/boot.ts";
import type { JobModule } from "./jobs/contracts.ts";
import type { JobsRuntime } from "./jobs/runtime.ts";
import { bootTasks } from "./tasks/boot.ts";
import type { TasksRuntime } from "./tasks/boot.ts";
import { bootWorkflows } from "./workflows/boot.ts";
import type { WorkflowModule } from "./workflows/contracts.ts";
import type { WorkflowsRuntime } from "./workflows/runner.ts";

/** The per-request services the context middleware attaches, all nullable on failure. */
export interface BootedRuntimes {
  readonly jobs: JobsRuntime | null;
  readonly tasks: TasksRuntime | null;
  readonly workflows: WorkflowsRuntime | null;
}

export async function bootRuntimes(options: {
  readonly db: FacilisDb;
  readonly tenantId: string;
  readonly projectConfig: FacilisConfig;
  readonly jobModules: readonly JobModule[];
  readonly workflowModules: readonly WorkflowModule[];
  readonly warnings: ManifestWarning[];
}): Promise<BootedRuntimes> {
  const { db, tenantId, projectConfig, jobModules, workflowModules, warnings } = options;

  // The queue starts after the roles/views exist: its own writes run as facilis_app, while
  // a job body escalates to facilis_system (D-107). A failure there is a warning, not a 500.
  const jobs = await bootJobs({
    db,
    // isFacilisConfig deliberately does not require `jobs`, so an older virtual config can
    // still hand an undefined section to a newer runtime: fall back to documented defaults.
    jobsConfig: projectConfig.jobs ?? DEFAULT_JOBS_CONFIG,
    modules: jobModules,
    tenantId,
    warnings,
  });

  // Manual tasks are durable rows, not a process queue (D-135): booting them is just the
  // store and its table probe; the workflow runner (below) is the only tick.
  const tasks = await bootTasks({ db, tenantId, warnings });

  // Workflows chain step jobs and approval tasks (D-135, WORKFLOWS.md §8): the runner needs
  // both runtimes, and a missing one disables the API with a warning instead of failing boot.
  const workflows = await bootWorkflows({
    db,
    tenantId,
    modules: workflowModules,
    jobs,
    jobsConfig: projectConfig.jobs ?? DEFAULT_JOBS_CONFIG,
    workflowsConfig: projectConfig.workflows ?? DEFAULT_WORKFLOWS_CONFIG,
    warnings,
  });

  return { jobs, tasks, workflows };
}
