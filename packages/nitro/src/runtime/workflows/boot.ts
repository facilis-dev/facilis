import type { FacilisJobsConfig, FacilisWorkflowsConfig, ManifestWarning } from "@facilis/core";
import type { FacilisDb } from "@facilis/db";

import type { JobsRuntime } from "../jobs/runtime.ts";
import type { TaskStore } from "../tasks/contracts.ts";
import { createDbTaskStore, isTasksTableAvailable } from "../tasks/db-store.ts";
import type { WorkflowModule } from "./contracts.ts";
import { createDbWorkflowStore, isWorkflowsTableAvailable } from "./db-store.ts";
import { buildWorkflowRegistry } from "./definitions.ts";
import { createWorkflowRunner, type WorkflowsRuntime } from "./runner.ts";

export interface BootWorkflowsOptions {
  readonly db: FacilisDb;
  readonly tenantId: string;
  readonly modules: readonly WorkflowModule[];
  /** The booted job queue; null disables workflows, because a step cannot run without it. */
  readonly jobs: JobsRuntime | null;
  readonly jobsConfig: FacilisJobsConfig;
  readonly workflowsConfig: FacilisWorkflowsConfig;
  /** Session-wide manifest warnings; boot pushes into it instead of throwing. */
  readonly warnings: ManifestWarning[];
}

/**
 * Boots the workflow runtime (D-135, docs/WORKFLOWS.md §8).
 *
 * Never throws: without both tables (or without the job queue) the API is unavailable with a
 * manifest warning, because a suspended chain needs durable rows and jobs (there is
 * deliberately no in-memory mode). The returned runtime is carried by BootstrapState and
 * exposed as ctx.workflows.
 */
export async function bootWorkflows(
  options: BootWorkflowsOptions,
): Promise<WorkflowsRuntime | null> {
  const { db, tenantId, modules, jobs, jobsConfig, workflowsConfig, warnings } = options;
  if (!workflowsConfig.persist) {
    warnings.push({
      code: "workflows_disabled",
      message: "workflows.persist is false; workflows are disabled (rows are the contract).",
    });
    return null;
  }
  if (jobs === null) {
    warnings.push({
      code: "workflows_disabled",
      message: "Background jobs are unavailable; workflows are disabled.",
    });
    return null;
  }
  try {
    if (!(await isWorkflowsTableAvailable(db)) || !(await isTasksTableAvailable(db))) {
      warnings.push({
        code: "workflows_table_missing",
        message:
          "facilis_workflows or facilis_tasks is missing; workflows are disabled. Re-export the tables from db/schema.ts and apply the framework migration.",
      });
      return null;
    }
    const registry = buildWorkflowRegistry(modules, jobs.definitions);
    warnings.push(...registry.warnings);

    // One warning per failing context is enough: a broken store would otherwise flood the
    // manifest on every tick.
    const reportedErrors = new Set<string>();
    const taskStore: TaskStore = createDbTaskStore({ db, tenantId });
    const runner = createWorkflowRunner({
      db,
      tenantId,
      definitions: registry.definitions,
      store: createDbWorkflowStore({ db, tenantId }),
      tasks: taskStore,
      jobs: jobs.engine,
      config: workflowsConfig,
      maxStepAttempts: jobsConfig.maxAttempts,
      onError: (error, context) => {
        if (reportedErrors.has(context)) return;
        reportedErrors.add(context);
        warnings.push({
          code: "workflow_runtime_error",
          message: "Workflow runner error (" + context + "): " + describe(error),
        });
      },
    });
    await runner.start();
    return runner;
  } catch (error) {
    warnings.push({
      code: "workflows_boot_failed",
      message: "Workflows are disabled: " + describe(error),
    });
    return null;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
