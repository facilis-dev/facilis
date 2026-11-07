import type { FacilisDb } from "@facilis/db";
import { runAsSystem } from "@facilis/db";

import type { JobExecutor } from "./contracts.ts";

/**
 * Runs every job attempt in a system context (D-107, docs/JOBS.md §5/§7).
 *
 * The engine owns scheduling and input/output validation; this adapter owns the security
 * boundary: each attempt is its own transaction as `facilis_system`, audited like a route's
 * sudo, so a job body never sees a policy-free client and the trail names the job.
 */
export function createSystemJobExecutor(db: FacilisDb): JobExecutor {
  return async ({ definition, data, job, signal }) =>
    runAsSystem(
      db,
      {
        actor: `system:job:${definition.name}`,
        operation: `jobs:${definition.name}`,
        reason: `Background job "${definition.name}" (attempt ${job.attempts})`,
        // A job may declare no audit tables ([]), unlike a route's sudo, which must escalate
        // over an explicit subset of its dbTables (D-107).
        tables: definition.tables ?? [],
      },
      async (systemDb) =>
        definition.run({
          jobId: job.id,
          name: definition.name,
          attempt: job.attempts,
          data,
          signal,
          db: systemDb,
        }),
    );
}
