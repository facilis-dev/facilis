import { isJobDefinition, type JobDefinition, type ManifestWarning } from "@facilis.dev/core";

import type { JobModule } from "./contracts.ts";

/** The project's job definitions plus the manifest warnings raised while indexing them. */
export interface JobRegistry {
  readonly definitions: ReadonlyMap<string, JobDefinition<unknown, unknown>>;
  readonly warnings: ManifestWarning[];
}

/**
 * Indexes the modules behind `#facilis/jobs` (docs/JOBS.md §5).
 *
 * An invalid or duplicate definition must never break boot: it becomes a manifest warning
 * and the module (or the later duplicate) is skipped.
 */
export function buildJobRegistry(modules: readonly JobModule[]): JobRegistry {
  const definitions = new Map<string, JobDefinition<unknown, unknown>>();
  const warnings: ManifestWarning[] = [];

  for (const module of modules) {
    if (!isJobDefinition(module.definition)) {
      warnings.push({
        code: "job_definition_invalid",
        message: `${module.file} must default-export defineJob({...}); the module was skipped.`,
        sourceFile: module.file,
      });
      continue;
    }
    if (definitions.has(module.definition.name)) {
      warnings.push({
        code: "job_definition_invalid",
        message: `Duplicate job "${module.definition.name}" in ${module.file}; the first definition wins.`,
        sourceFile: module.file,
      });
      continue;
    }
    definitions.set(module.definition.name, module.definition);
  }

  return { definitions, warnings };
}
