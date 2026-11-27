import {
  assertNoRuntimeProblems,
  installRuntimeConfig,
  resolveRuntimeConfig,
  type FacilisConfig,
  type FacilisRuntimeConfig,
  type ManifestWarning,
} from "@facilis.dev/core";

import { readProjectConfig } from "./project-config.ts";

/**
 * One resolution of the runtime section per process (D-224).
 *
 * The project config is read once here so the telemetry plugin can install the value before
 * the first request, and the DB boot can reuse the same resolution and warnings.
 */
export interface ProjectBootConfig {
  readonly config: FacilisConfig | null;
  readonly runtime: FacilisRuntimeConfig;
  readonly warnings: readonly ManifestWarning[];
}

let booted: ProjectBootConfig | undefined;

export function bootProjectConfig(): ProjectBootConfig {
  if (booted !== undefined) return booted;
  const warnings: ManifestWarning[] = [];
  const config = readProjectConfig(warnings);
  // A config that failed to parse has no declarations: the environment cannot be validated
  // against a surface that does not exist, so the degraded boot keeps the documented defaults.
  const resolved = resolveRuntimeConfig({
    runtime: config?.runtime,
    env: config === null ? {} : process.env,
  });
  assertNoRuntimeProblems(resolved.problems);
  installRuntimeConfig(resolved.runtime);
  booted = { config, runtime: resolved.runtime, warnings };
  return booted;
}
