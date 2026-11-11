import type { AuthConfig } from "@facilis.dev/auth";
import type { FacilisConfig } from "@facilis.dev/core";

export const DEFAULT_SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_MIGRATIONS_DIR = "db/migrations";
export const DEFAULT_LOCALE = "en";

/** Subset of FacilisConfig.auth that may be missing when the virtual module fell back. */
export interface AuthConfigLike {
  permissions?: readonly string[];
  roles?: Readonly<Record<string, readonly string[]>>;
  defaultRole?: string;
  sessionDurationMs?: number;
}

/**
 * Normalise the project auth config into @facilis.dev/auth's AuthConfig. The config is
 * validated by @facilis.dev/core at definition time; defaults here only cover the
 * "config module missing/corrupt" bootstrap path so it degrades to a warning.
 */
export function toAuthConfig(auth: AuthConfigLike | undefined): AuthConfig {
  return {
    permissions: auth?.permissions ?? [],
    roles: auth?.roles ?? {},
    defaultRole: auth?.defaultRole ?? "user",
    sessionDurationMs: auth?.sessionDurationMs ?? DEFAULT_SESSION_DURATION_MS,
  };
}

export function readMigrationsDir(config: FacilisConfig | null | undefined): string {
  return config?.db?.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
}

export function readDefaultLocale(config: FacilisConfig | null | undefined): string {
  return config?.i18n?.defaultLocale ?? DEFAULT_LOCALE;
}

/**
 * Runtime guard for the virtual `#facilis/config` default export.
 *
 * The virtual module falls back to `{}` when the project has no config file, so the
 * bootstrap must not trust the static type at the module boundary.
 */
export function isFacilisConfig(value: unknown): value is FacilisConfig {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FacilisConfig>;
  const { auth, db, i18n } = candidate;
  return (
    typeof auth === "object" &&
    auth !== null &&
    Array.isArray(auth.permissions) &&
    typeof auth.defaultRole === "string" &&
    typeof auth.roles === "object" &&
    auth.roles !== null &&
    typeof db === "object" &&
    db !== null &&
    typeof i18n === "object" &&
    i18n !== null
  );
}
