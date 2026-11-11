import type { FacilisDb } from "@facilis.dev/db";
import { runAsSystem } from "@facilis.dev/db";

import type { JobExecutor } from "./contracts.ts";

/**
 * Runs every job attempt in a system context (D-107, docs/JOBS.md §5/§7).
 *
 * The engine owns scheduling and input/output validation; this adapter owns the security
 * boundary: each attempt is its own transaction as `facilis_system`, audited like a route's
 * sudo and guarded by the job's `dbTables` declaration (D-157), so a job body never sees a
 * policy-free client, the declaration is enforced and the trail names the job.
 */
export function createSystemJobExecutor(db: FacilisDb): JobExecutor {
  return async ({ definition, data, job, signal }) =>
    runAsSystem(
      db,
      {
        actor: `system:job:${definition.name}`,
        operation: `jobs:${definition.name}`,
        reason: `Background job "${definition.name}" (attempt ${job.attempts})`,
        // The declaration is required (possibly empty) and enforced inside the elevation: an
        // undeclared relation fails closed instead of being audited after the fact (D-157).
        dbTables: definition.dbTables,
        rawSql: definition.rawSql === true,
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
