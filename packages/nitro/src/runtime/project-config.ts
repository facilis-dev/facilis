import type { FacilisConfig, ManifestWarning } from "@facilis/core";
import config, { configError } from "#facilis/config";

import { isFacilisConfig } from "./config.ts";

/**
 * Reads and validates the project's virtual config module.
 *
 * A broken config is a warning, never a boot failure: the rest of the bootstrap still runs
 * (contracts §8), and the caller degrades to "no config" with a partial manifest.
 */
export function readProjectConfig(warnings: ManifestWarning[]): FacilisConfig | null {
  if (configError !== undefined) {
    warnings.push({ code: "config_load_failed", message: configError });
    return null;
  }
  if (!isFacilisConfig(config)) {
    warnings.push({
      code: "config_invalid",
      message: "facilis.config.ts must export defineConfig({ auth, db, i18n, ... }).",
    });
    return null;
  }
  return config;
}
