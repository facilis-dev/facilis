/**
 * Workflow table surface, derived from the jobs its steps reference (user decision: derived,
 * never declared). A workflow declares no tables of its own: the union of the referenced jobs'
 * `dbTables` is what the workflow can reach, and the runtime inherits each job's guard.
 *
 * Approval steps contribute nothing. A referenced job with an unreadable `dbTables` makes the
 * union explicitly unknown; a referenced job with no definition keeps its name visible in
 * `unknownJobs` and is a warning, never a silent hole.
 */

import { warning } from "../diagnostics.ts";
import type { Diagnostic, SourceRef, WorkflowFact } from "../types.ts";
import type { JobFact } from "../types-jobs.ts";
import type { WorkflowTablesFact } from "../types-workflows.ts";
import { sortDiagnostics } from "./static-read.ts";

export interface WorkflowTablesResult {
  readonly facts: readonly WorkflowTablesFact[];
  readonly diagnostics: readonly Diagnostic[];
}

/** One job definition per name; the manifest enforces uniqueness, first wins here. */
function jobRegistry(jobs: readonly JobFact[]): Map<string, JobFact> {
  const byName = new Map<string, JobFact>();
  for (const job of jobs) {
    if (!byName.has(job.name)) byName.set(job.name, job);
  }
  return byName;
}

/** Derive every workflow's table surface from its job steps. */
export function buildWorkflowTableFacts(
  workflows: readonly WorkflowFact[],
  jobs: readonly JobFact[],
): WorkflowTablesResult {
  const registry = jobRegistry(jobs);
  const facts: WorkflowTablesFact[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const workflow of workflows) {
    const tables = new Set<string>();
    const unknownJobs = new Set<string>();
    const missingAt = new Map<string, SourceRef>();
    let unknown = false;
    for (const step of workflow.steps) {
      if (step.kind !== "job") continue;
      // A job step whose name is unreadable is already a workflow-definition unknown, but the
      // derived surface must not pretend it is complete.
      if (step.name === null) {
        unknown = true;
        continue;
      }
      const job = registry.get(step.name);
      if (job === undefined) {
        unknownJobs.add(step.name);
        if (!missingAt.has(step.name)) missingAt.set(step.name, step.source);
        continue;
      }
      if (job.dbTables === null) {
        unknown = true;
        continue;
      }
      for (const table of job.dbTables) tables.add(table);
    }
    for (const name of [...unknownJobs].toSorted()) {
      diagnostics.push(
        warning(
          "workflow-job-unknown",
          'workflow "' +
            workflow.name +
            '" references job "' +
            name +
            '" but no definition exists in server/jobs',
          missingAt.get(name) ?? workflow.source,
        ),
      );
    }
    facts.push({
      name: workflow.name,
      sourceFile: workflow.sourceFile,
      source: workflow.source,
      tables: [...tables].toSorted(),
      unknownJobs: [...unknownJobs].toSorted(),
      unknown,
    });
  }
  return { facts, diagnostics: sortDiagnostics(diagnostics) };
}
