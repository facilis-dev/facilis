import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
// The /config subpath keeps the Vite config phase from loading @facilis/core's entry, which
// re-exports the route/db runtime: the plugin only needs the schema and its types here.
import {
  facilisConfigSchema,
  type FacilisConfig,
  type FacilisNitroOptions,
} from "@facilis/core/config";
import type { NitroConfig } from "nitro/types";

/**
 * The project config file the Vite plugin reads (SPEC §2.3, D-034).
 *
 * A Facilis project commits ONE config: Nitro options live in its `nitro` section, so
 * there is no `nitro.config.ts` and the project's `vite.config.ts` never names Nitro.
 */
export const PROJECT_CONFIG_FILE = "facilis.config.ts";

/**
 * Facilis defaults for Nitro (SPEC §4.1/§4.2).
 *
 * The framework owns these two: the server directory is always `./server` and the native
 * OpenAPI document is always generated (the `/_openapi.json` facade augments it). A
 * project only declares what it changes, in `facilis.config.ts`'s `nitro` section.
 */
// `satisfies` keeps this list honest against Nitro's own option type, while the exported
// value stays an indexable record for the merge.
const FACILIS_NITRO_DEFAULTS = {
  serverDir: "./server",
  experimental: { openAPI: true },
} as const satisfies NitroConfig;

/** The defaults as the merge sees them; tests assert against this value. */
export const DEFAULT_NITRO_OPTIONS: Readonly<Record<string, unknown>> = FACILIS_NITRO_DEFAULTS;

/**
 * Merge the project's `nitro` section over the Facilis defaults.
 *
 * Deep for plain objects so `nitro.experimental.openAPI: false` only flips that switch
 * instead of replacing the whole `experimental` block; arrays are Nitro lists authored
 * whole, so they replace rather than concatenate.
 */
export function mergeNitroOptions(project: FacilisNitroOptions | undefined): NitroConfig {
  // The merged record is exactly the shape Nitro's own config loader accepted before D-034
  // (it originates from facilis.config.ts, typed NitroConfig at the authoring site).
  return mergePlainObjects(DEFAULT_NITRO_OPTIONS, project ?? {}) as NitroConfig;
}

/**
 * Load `<root>/facilis.config.ts` with the project's native ESM loader.
 *
 * `null` when the file is absent: the framework degrades to its defaults and the Nitro
 * runtime reports the missing config as a manifest warning (it must not brick the dev
 * server). A file that exists but cannot be imported or validated is an authoring error
 * and fails the start with the file path in the message.
 */
export async function loadFacilisConfig(root: string): Promise<FacilisConfig | null> {
  const configPath = join(root, PROJECT_CONFIG_FILE);
  if (!existsSync(configPath)) return null;

  let module: unknown;
  try {
    module = await import(pathToFileURL(configPath).href);
  } catch (error) {
    throw new Error(`[facilis] failed to load ${configPath}`, { cause: error });
  }

  // The file usually default-exports defineConfig(...), which has already validated and
  // filled the defaults; parsing again also accepts a bare object and reports the same
  // schema error a runtime `defineConfig` would.
  const parsed = facilisConfigSchema.safeParse(defaultExport(module));
  if (!parsed.success) {
    throw new Error(`[facilis] invalid ${configPath}: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** The Nitro options Nitro should boot with, given the project root. */
export async function loadNitroOptions(root: string): Promise<NitroConfig> {
  const config = await loadFacilisConfig(root);
  return mergeNitroOptions(config?.nitro);
}

function mergePlainObjects(
  base: Readonly<Record<string, unknown>>,
  override: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const source of [base, override]) {
    for (const [key, value] of Object.entries(source)) {
      const existing = merged[key];
      merged[key] = isPlainObject(value)
        ? mergePlainObjects(isPlainObject(existing) ? existing : {}, value)
        : value;
    }
  }
  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultExport(module: unknown): unknown {
  if (typeof module !== "object" || module === null || !("default" in module)) return undefined;
  return module.default;
}
