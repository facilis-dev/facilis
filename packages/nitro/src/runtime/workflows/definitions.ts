import {
  isWorkflowDefinition,
  type JobDefinition,
  type ManifestWarning,
  type WorkflowDefinition,
} from "@facilis/core";

import type { WorkflowModule } from "./contracts.ts";

/** The project's workflow definitions plus the manifest warnings raised while indexing them. */
export interface WorkflowRegistry {
  readonly definitions: ReadonlyMap<string, WorkflowDefinition<unknown, unknown>>;
  readonly warnings: ManifestWarning[];
}

/**
 * Indexes the modules behind `#facilis/workflows` (docs/WORKFLOWS.md §6).
 *
 * An invalid, duplicate or dangling definition must never break boot: it becomes a manifest
 * warning and the module is skipped (jobs behaviour, docs/JOBS.md §5).
 */
export function buildWorkflowRegistry(
  modules: readonly WorkflowModule[],
  jobs: ReadonlyMap<string, JobDefinition<unknown, unknown>>,
): WorkflowRegistry {
  const definitions = new Map<string, WorkflowDefinition<unknown, unknown>>();
  const warnings: ManifestWarning[] = [];

  for (const module of modules) {
    if (!isWorkflowDefinition(module.definition)) {
      warnings.push({
        code: "workflow_definition_invalid",
        message: `${module.file} must default-export defineWorkflow({...}); the module was skipped.`,
        sourceFile: module.file,
      });
      continue;
    }
    if (definitions.has(module.definition.name)) {
      warnings.push({
        code: "workflow_definition_invalid",
        message: `Duplicate workflow "${module.definition.name}" in ${module.file}; the first definition wins.`,
        sourceFile: module.file,
      });
      continue;
    }
    const dangling = danglingJob(module.definition, jobs);
    if (dangling !== null) {
      warnings.push({
        code: "workflow_definition_invalid",
        message: `${module.file}: step references unknown job "${dangling}"; the workflow was skipped.`,
        sourceFile: module.file,
      });
      continue;
    }
    // The registry is deliberately input-erased (a project mixes definitions with different
    // inputs); the resolver context is reconstructed from the row at dispatch time (§6).
    definitions.set(
      module.definition.name,
      module.definition as WorkflowDefinition<unknown, unknown>,
    );
  }

  return { definitions, warnings };
}

/** First job step whose name is not in the job registry; null when every step resolves. */
function danglingJob(
  definition: WorkflowDefinition,
  jobs: ReadonlyMap<string, JobDefinition<unknown, unknown>>,
): string | null {
  for (const step of definition.steps) {
    if ("job" in step && !jobs.has(step.job)) return step.job;
  }
  return null;
}
