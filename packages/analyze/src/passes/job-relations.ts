/**
 * Job `run(ctx)` -> relation usage (D-157 applied to jobs). A job's `db` is the
 * system-scoped client, so its usage has no elevation bucket: it is the route walk with the
 * `{ db }` seed on the first parameter and elevations disabled. The walk and the name
 * resolution are the route ones (`route-relations-walk.ts` / `route-relation-resolve.ts`),
 * so the two passes cannot drift.
 */

import { callArguments, unwrapExpression, type AstNode } from "../ast/node.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import type { Diagnostic, TableFact, ViewFact } from "../types.ts";
import type { JobFact, JobRelationsFact } from "../types-jobs.ts";
import { EMPTY_JOB_RELATIONS } from "../types-jobs.ts";
import { createRelationIndex } from "./route-relation-resolve.ts";
import { scanFunctionUsage, type UsageSeed } from "./route-relations-walk.ts";
import { jobRelationDiagnostics } from "./job-relations-diagnostics.ts";
import { resolveJobCall } from "./jobs.ts";
import { readStaticObject, sortDiagnostics } from "./static-read.ts";

/** A job runs as `facilis_system`: `run`'s first parameter is the context, no elevations. */
const JOB_SEED: UsageSeed = { contextParam: 0, elevations: false };

export interface JobRelationsScan {
  readonly jobs: readonly JobFact[];
  /** Usage per job, keyed by the job name (unique across the project). */
  readonly relations: Readonly<Record<string, JobRelationsFact>>;
  readonly diagnostics: readonly Diagnostic[];
}

/** The function expression of the definition's `run` property, when inspectable. */
function runFunction(graph: ModuleGraph, file: ProjectFile, call: AstNode): AstNode | undefined {
  const object = readStaticObject(
    callArguments(call)[0],
    { graph, file: file.path },
    { code: "job-definition-static", report: false },
  );
  const value = unwrapExpression(object.fields.get("run")?.node);
  return value?.type === "ArrowFunctionExpression" || value?.type === "FunctionExpression"
    ? value
    : undefined;
}

function toJobRelations(usage: ReturnType<typeof scanFunctionUsage>): JobRelationsFact {
  return {
    used: usage.used,
    unresolved: usage.unresolved,
    rawSql: usage.rawSql,
    opaque: usage.opaque,
  };
}

/** Attach relation-usage facts to every scannable job and derive the D-157 diagnostics. */
export function buildJobRelationFacts(
  graph: ModuleGraph,
  jobs: readonly JobFact[],
  tables: readonly TableFact[],
  views: readonly ViewFact[],
): JobRelationsScan {
  const index = createRelationIndex(tables, views);
  const relations: Record<string, JobRelationsFact> = {};
  const diagnostics: Diagnostic[] = [];
  for (const job of jobs) {
    const file = graph.file(job.sourceFile);
    const call = file === undefined ? null : resolveJobCall(file);
    const run = file !== undefined && call !== null ? runFunction(graph, file, call) : undefined;
    if (file === undefined || run === undefined) {
      // The definition warning is the finding; an empty usage avoids a false unused warning.
      relations[job.name] = EMPTY_JOB_RELATIONS;
      continue;
    }
    const usage = toJobRelations(scanFunctionUsage(graph, file, run, index, JOB_SEED));
    relations[job.name] = usage;
    diagnostics.push(...jobRelationDiagnostics(job, usage));
  }
  return { jobs, relations, diagnostics: sortDiagnostics(diagnostics) };
}
