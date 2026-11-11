/**
 * Rule 19 `job-table-declared` (SPEC §9.3, D-157 applied to jobs): a job's `dbTables` is an
 * applied declaration.
 *
 * A job's `run(ctx)` always receives the system-scoped client (D-107), so its usage has no
 * elevation dimension: every relation it reaches — tables and views — must be declared,
 * following project-local helper calls, and a missing or unreadable declaration fails closed.
 * The rule covers **all** effective jobs whose usage facts exist, not only the patched ones: a
 * patch that edits a shared helper changes what untouched jobs touch, and must not bypass the
 * declaration.
 *
 * Errors: undeclared, unresolved/dynamic relation, `db.execute` without `rawSql: true` and a
 * declaration that cannot be read. Warning: declared but unused (suppressed when usage is
 * opaque or raw SQL is present, where the declaration stays authoritative).
 */

import type { EffectiveState } from "../overlay.ts";
import type { JobRelationsFact, ValidationError } from "../types.ts";

function lineOf(source: { readonly line: number } | undefined): number | undefined {
  return source?.line;
}

function error(
  file: string,
  message: string,
  fixHint: string,
  line: number | undefined,
): ValidationError {
  return {
    rule: "job-table-declared",
    severity: "error",
    file,
    message,
    fix_hint: fixHint,
    ...(line === undefined ? {} : { line }),
  };
}

function unusedWarning(job: { readonly sourceFile: string }, name: string): ValidationError {
  return {
    rule: "job-table-declared",
    severity: "warning",
    file: job.sourceFile,
    message: 'dbTables declares "' + name + '" but the job never uses it.',
    fix_hint:
      'Remove "' + name + '" from dbTables, or use it: the declaration is enforced (D-157).',
  };
}

/** Opaque usage or raw SQL keeps the declaration authoritative instead of warning. */
function unusedSuppressed(usage: JobRelationsFact): boolean {
  return usage.opaque || usage.rawSql.length > 0;
}

export interface JobTableDeclaredFindings {
  readonly errors: ValidationError[];
  readonly warnings: ValidationError[];
}

/** Rule 19 over the effective analysis (SPEC §9.3, D-157 applied to jobs). */
export function jobTableDeclaredFindings(state: EffectiveState): JobTableDeclaredFindings {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  for (const job of state.analysis.jobs) {
    // A hand-built analysis may predate the fact: no usage facts, no check.
    const usage: JobRelationsFact | undefined = state.analysis.jobRelations[job.name];
    if (usage === undefined) continue;
    const declared = job.dbTables === null ? null : new Set(job.dbTables);
    if (declared === null) {
      errors.push(
        error(
          job.sourceFile,
          'Job "' + job.name + '" dbTables is missing or cannot be read statically.',
          "Declare dbTables on defineJob({...}): every table or view the run body touches ([] means none).",
          lineOf(job.source),
        ),
      );
    } else {
      for (const use of usage.used) {
        if (declared.has(use.name)) continue;
        errors.push(
          error(
            use.source.file,
            'Relation "' + use.name + '" is used through the job db but not declared in dbTables.',
            'Add "' +
              use.name +
              '" to dbTables (tables and views the run body touches), or stop using it.',
            lineOf(use.source),
          ),
        );
      }
    }
    for (const source of usage.unresolved) {
      errors.push(
        error(
          source.file,
          "A relation used through the job db cannot be resolved statically.",
          "Use a table or view binding imported from db/ instead of a dynamic expression.",
          lineOf(source),
        ),
      );
    }
    for (const source of usage.rawSql) {
      if (job.rawSql === true) continue;
      errors.push(
        error(
          source.file,
          "db.execute() requires rawSql: true on the job definition.",
          job.rawSql === null
            ? "Declare rawSql: true (or false) statically, or use the query builder."
            : "Add rawSql: true to defineJob({...}), or use the query builder.",
          lineOf(source),
        ),
      );
    }
    if (declared !== null && !unusedSuppressed(usage)) {
      const used = new Set(usage.used.map((use) => use.name));
      for (const name of job.dbTables ?? []) {
        if (used.has(name)) continue;
        warnings.push(unusedWarning(job, name));
      }
    }
  }
  return { errors, warnings };
}
