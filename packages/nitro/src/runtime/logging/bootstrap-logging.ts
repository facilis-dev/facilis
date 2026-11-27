import {
  DEFAULT_LOGGING_CONFIG,
  type FacilisLoggingConfig,
  type FacilisRuntimeConfig,
  type ManifestWarning,
} from "@facilis.dev/core";

import { resolveLogSettings } from "./log-settings.ts";
import { createLoggingRuntime, type LoggingRuntime } from "./runtime.ts";

/**
 * Boot-time logging construction (D-119).
 *
 * Logging is built from the project config plus the environment BEFORE the database is opened:
 * a database boot failure must still leave the process with a working access/error stream, and
 * logging itself must never be the reason a project fails to boot. When `facilis.config.ts`
 * did not load, the documented defaults are used.
 */
export interface BootstrapLoggingInput {
  /** The project's `logging` section, or null when the project config failed to load. */
  readonly loggingConfig: FacilisLoggingConfig | null;
  readonly runtime: FacilisRuntimeConfig;
  readonly env: NodeJS.ProcessEnv;
  readonly projectRoot: string;
  /** Test seam: override the NODE_ENV-derived production detection. */
  readonly production?: boolean;
  /** Test seam: collect stdout lines instead of writing to the process stream. */
  readonly writeStdout?: (line: string) => void;
}

export interface BootstrapLogging {
  readonly logging: LoggingRuntime;
  readonly config: FacilisLoggingConfig;
  readonly warnings: readonly ManifestWarning[];
}

export function createBootstrapLogging(input: BootstrapLoggingInput): BootstrapLogging {
  const resolved = resolveLogSettings({
    runtime: input.runtime,
    env: input.env,
    projectRoot: input.projectRoot,
    ...(input.production === undefined ? {} : { production: input.production }),
  });
  const config = input.loggingConfig ?? DEFAULT_LOGGING_CONFIG;
  const runtime = createLoggingRuntime({
    config,
    settings: resolved.settings,
    ...(input.writeStdout === undefined ? {} : { writeStdout: input.writeStdout }),
  });
  return {
    logging: runtime,
    config,
    warnings: [...resolved.warnings, ...runtime.warnings],
  };
}
