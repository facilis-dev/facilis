import type { ManifestWarning, TasksApi } from "@facilis/core";
import type { FacilisDb } from "@facilis/db";

import { createDbTaskStore, isTasksTableAvailable } from "./db-store.ts";
import { createTasksApi } from "./runtime.ts";

/** The booted task runtime carried by BootstrapState (D-135). */
export interface TasksRuntime {
  readonly api: TasksApi;
}

export interface BootTasksOptions {
  readonly db: FacilisDb;
  readonly tenantId: string;
  /** Session-wide manifest warnings; boot pushes into it instead of throwing. */
  readonly warnings: ManifestWarning[];
}

/**
 * Boots the manual-task runtime (D-135, docs/WORKFLOWS.md §7).
 *
 * Never throws: without the table the API is unavailable with a manifest warning, because a
 * reload-durable task needs rows (there is deliberately no in-memory mode). The returned
 * runtime is carried by BootstrapState and exposed as ctx.tasks.
 */
export async function bootTasks(options: BootTasksOptions): Promise<TasksRuntime | null> {
  const { db, tenantId, warnings } = options;
  try {
    if (!(await isTasksTableAvailable(db))) {
      warnings.push({
        code: "tasks_table_missing",
        message:
          "facilis_tasks is missing; manual tasks are disabled. Re-export the table from db/schema.ts and apply the framework migration.",
      });
      return null;
    }
    return { api: createTasksApi(createDbTaskStore({ db, tenantId })) };
  } catch (error) {
    warnings.push({
      code: "tasks_boot_failed",
      message: "Manual tasks are disabled: " + describe(error),
    });
    return null;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
