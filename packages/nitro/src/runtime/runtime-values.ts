import { SecretString, type FacilisRuntimeConfig, type JsonValue } from "@facilis.dev/core";

/**
 * Typed reads over a resolved runtime section (D-224).
 *
 * The resolver already validates the declaration's type; these helpers keep consumers from
 * spreading ad-hoc casts, and they never fall back to `process.env`.
 */
export function runtimeString(runtime: FacilisRuntimeConfig, key: string): string | null {
  const value = runtime[key];
  return typeof value === "string" ? value : null;
}

/** A secret box or a literal string, revealed only at the point that needs a plain value. */
export function runtimeSecret(runtime: FacilisRuntimeConfig, key: string): string | null {
  const value = runtime[key];
  if (value instanceof SecretString) return value.reveal();
  return typeof value === "string" ? value : null;
}

export function runtimeBoolean(runtime: FacilisRuntimeConfig, key: string): boolean | null {
  const value = runtime[key];
  return typeof value === "boolean" ? value : null;
}

export function runtimeNumber(runtime: FacilisRuntimeConfig, key: string): number | null {
  const value = runtime[key];
  return typeof value === "number" ? value : null;
}

export function runtimeJson(runtime: FacilisRuntimeConfig, key: string): JsonValue | null {
  const value = runtime[key];
  return value === undefined || value instanceof SecretString ? null : value;
}
