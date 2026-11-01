import type { FacilisConfig, ManifestWarning } from "@facilis/core";

import { isProductionEnvironment } from "./env.ts";

/** Driver a booting project can open; mirrors @facilis/db's `DbDriver`. */
export type DbTargetDriver = "pglite" | "postgres";

/** The database the runtime must open. `url` is set for a postgres target only. */
export interface DbTarget {
  readonly driver: DbTargetDriver;
  readonly url?: string;
}

export interface ResolvedDbTarget {
  readonly target: DbTarget | null;
  readonly warnings: readonly ManifestWarning[];
}

/**
 * Decide which database the runtime opens (SPEC §5.2/§7.1, D-068).
 *
 * A connection string wins over the project config so a deployment can point any project at
 * its Postgres without editing source. Every refusal returns a null target plus a warning:
 * the boot then degrades to "no database" (manifest warning, no session) instead of crashing
 * or, worse, silently writing a production app to the in-memory PGlite cluster.
 */
export function resolveDbTarget(
  config: FacilisConfig | null,
  env: NodeJS.ProcessEnv,
): ResolvedDbTarget {
  // A hosting panel that defines the variable but leaves it blank is "not configured": an
  // empty URL would otherwise reach the driver and surface as a confusing connection error.
  const url = readUrl(env["FACILIS_DATABASE_URL"]) ?? readUrl(env["DATABASE_URL"]);
  if (url !== undefined) {
    return { target: { driver: "postgres", url }, warnings: [] };
  }

  const mode = config?.db.mode ?? "pglite";

  if (mode === "pglite") {
    if (isProductionEnvironment(env)) {
      return {
        target: null,
        warnings: [
          warning(
            "db_pglite_in_production",
            "Production refuses the in-memory PGlite driver: set FACILIS_DATABASE_URL (or DATABASE_URL) to a Postgres connection string.",
          ),
        ],
      };
    }
    return { target: { driver: "pglite" }, warnings: [] };
  }

  if (mode === "postgres") {
    return {
      target: null,
      warnings: [
        warning(
          "db_url_missing",
          'db.mode is "postgres" but neither FACILIS_DATABASE_URL nor DATABASE_URL is set.',
        ),
      ],
    };
  }

  // "json" is a declared config mode (SPEC §7.1) with no runtime driver yet.
  return {
    target: null,
    warnings: [
      warning(
        "db_mode_unsupported",
        `db.mode "${mode}" has no runtime driver; use "pglite" or "postgres".`,
      ),
    ],
  };
}

/** Trimmed connection string, or undefined when unset or blank. */
function readUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function warning(code: string, message: string): ManifestWarning {
  return { code, message };
}