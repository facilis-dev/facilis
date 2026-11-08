import { z } from "zod";

import { LOG_LEVELS, type LogLevel } from "./logging.ts";

/**
 * The `logging` section of facilis.config.ts (D-119).
 *
 * Only the request-facing defaults are project config. Where entries GO is a deployment
 * concern and lives in the environment (FACILIS_LOG_SINK/DIR/...), exactly like the database
 * target and storage credentials: a project must not be able to redirect an operator's audit
 * trail. Entries are written to append-only files (dev: under `.facilis/logs`, readable from
 * the IDE's editor) and/or stdout (the deploy's log platform); the framework exposes NO HTTP
 * endpoint that serves them (D-119).
 */
export interface FacilisLoggingConfig {
  /** Minimum level for app/access entries; audit entries ignore it (they are never sampled). */
  readonly level: LogLevel;
  /** Write one access entry per authorized request. */
  readonly access: boolean;
  /** Write server-side error entries. */
  readonly errors: boolean;
  /** Include the User-Agent header in access entries (off by default: less PII). */
  readonly includeUserAgent: boolean;
  /** Trust X-Forwarded-For for the client IP (off unless a proxy sets it). */
  readonly trustProxy: boolean;
}

export type FacilisLoggingConfigInput = Partial<FacilisLoggingConfig>;

export const DEFAULT_LOGGING_CONFIG: FacilisLoggingConfig = {
  level: "info",
  access: true,
  errors: true,
  includeUserAgent: false,
  trustProxy: false,
};

export const facilisLoggingConfigSchema: z.ZodType<FacilisLoggingConfig> = z
  .strictObject({
    level: z.enum(LOG_LEVELS).default("info"),
    access: z.boolean().default(true),
    errors: z.boolean().default(true),
    includeUserAgent: z.boolean().default(false),
    trustProxy: z.boolean().default(false),
  })
  .default(() => DEFAULT_LOGGING_CONFIG);
