import { z } from "zod";

/**
 * The `logging` section of facilis.config.ts (D-119, D-224).
 *
 * Only the request-facing defaults are project config. The level and the proxy trust are
 * deployment concerns and live in `runtime` (D-224); where entries GO is an operator concern
 * and comes from the environment (FACILIS_LOG_SINK/DIR/...). A project must not be able to
 * redirect an operator's audit trail. Entries are written to append-only files (dev: under
 * `.facilis/logs`, readable from the IDE's editor) and/or stdout (the deploy's log platform);
 * the framework exposes NO HTTP endpoint that serves them (D-119).
 */
export interface FacilisLoggingConfig {
  /** Write one access entry per authorized request. */
  readonly access: boolean;
  /** Write server-side error entries. */
  readonly errors: boolean;
  /** Include the User-Agent header in access entries (off by default: less PII). */
  readonly includeUserAgent: boolean;
}

export type FacilisLoggingConfigInput = Partial<FacilisLoggingConfig>;

export const DEFAULT_LOGGING_CONFIG: FacilisLoggingConfig = {
  access: true,
  errors: true,
  includeUserAgent: false,
};

export const facilisLoggingConfigSchema: z.ZodType<FacilisLoggingConfig> = z
  .strictObject({
    access: z.boolean().default(true),
    errors: z.boolean().default(true),
    includeUserAgent: z.boolean().default(false),
  })
  .default(() => DEFAULT_LOGGING_CONFIG);
