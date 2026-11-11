/**
 * D-157 diagnostics for a job's static db usage. The rules mirror the route ones
 * (`route-relations-diagnostics.ts`) with job codes; jobs have no elevation dimension, so the
 * only suppression of the unused warning is an opaque helper or an allowed `db.execute`.
 */

import { error, warning } from "../diagnostics.ts";
import type { Diagnostic } from "../types.ts";
import type { JobFact, JobRelationsFact } from "../types-jobs.ts";

function unusedSuppressed(usage: JobRelationsFact): boolean {
  return usage.opaque || usage.rawSql.length > 0;
}

/** Every diagnostic the relation pass derives from one job's usage fact. */
export function jobRelationDiagnostics(job: JobFact, usage: JobRelationsFact): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const declared = job.dbTables === null ? null : new Set(job.dbTables);
  if (declared !== null) {
    for (const use of usage.used) {
      if (declared.has(use.name)) continue;
      diagnostics.push(
        error(
          "job-table-undeclared",
          'relation "' + use.name + '" is used through the job db but not declared in dbTables',
          use.source,
        ),
      );
    }
  }
  for (const source of usage.unresolved) {
    diagnostics.push(
      error(
        "job-table-unresolved",
        "a relation used through the job db cannot be resolved statically",
        source,
      ),
    );
  }
  for (const source of usage.rawSql) {
    if (job.rawSql === true) continue;
    diagnostics.push(
      error("job-raw-sql", "db.execute() requires rawSql: true on the job definition", source),
    );
  }
  if (declared !== null && !unusedSuppressed(usage)) {
    const used = new Set(usage.used.map((use) => use.name));
    for (const name of job.dbTables ?? []) {
      if (used.has(name)) continue;
      diagnostics.push(
        warning(
          "job-table-unused",
          'dbTables declares "' + name + '" but the job never uses it',
          job.source,
        ),
      );
    }
  }
  return diagnostics;
}
