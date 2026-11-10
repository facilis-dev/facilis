import { z } from "zod";

/**
 * The `workflows` section of `facilis.config.ts` (D-135, docs/WORKFLOWS.md §10).
 *
 * The workflow runner adds no second scheduler: step jobs keep the `jobs` section's
 * concurrency/retry/timeout, and this section only owns the runner tick, persistence and the
 * default lifetime of an approval task.
 */
export interface FacilisWorkflowsConfig {
  /** Runner tick interval; starts and decisions wake it immediately. */
  readonly tickIntervalMs: number;
  /**
   * Persist runs in `facilis_workflows`. Unlike jobs there is no in-memory fallback: a
   * suspended chain must survive a reload, so `false` (or a missing table) disables the API.
   */
  readonly persist: boolean;
  /** Default approval TTL; `null` means no expiry unless the step sets `ttlMs`. */
  readonly defaultTaskTtlMs: number | null;
}

/** The default `workflows` section; also what a config that omits it resolves to. */
export const DEFAULT_WORKFLOWS_CONFIG: FacilisWorkflowsConfig = {
  tickIntervalMs: 1000,
  persist: true,
  defaultTaskTtlMs: null,
};

/** Zod schema for the authored `workflows` section; `strictObject` rejects unknown keys. */
export const facilisWorkflowsConfigSchema = z
  .strictObject({
    // A tick under 100 ms would busy-loop a browser worker for no benefit.
    tickIntervalMs: z.number().int().min(100).default(DEFAULT_WORKFLOWS_CONFIG.tickIntervalMs),
    persist: z.boolean().default(DEFAULT_WORKFLOWS_CONFIG.persist),
    defaultTaskTtlMs: z.number().int().positive().nullable().default(null),
  })
  .default(() => DEFAULT_WORKFLOWS_CONFIG);

/** Authored form of the section (every key optional). */
export type FacilisWorkflowsConfigInput = z.input<typeof facilisWorkflowsConfigSchema>;
