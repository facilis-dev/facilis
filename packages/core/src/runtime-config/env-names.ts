/**
 * The variable naming rule (D-224): `FACILIS_` + UPPER_SNAKE(key) for `runtime`,
 * `FACILIS_PUBLIC_` + UPPER_SNAKE(key) for `public`. Keys are flat, so the name is a rule
 * over the key, never a computation over a nested path.
 */
export const ENV_PREFIX = "FACILIS_";
export const PUBLIC_ENV_PREFIX = "FACILIS_PUBLIC_";

/** `logMaxBytes` -> `FACILIS_LOG_MAX_BYTES`; one flat key is one variable. */
export function envNameFor(key: string, prefix: string = ENV_PREFIX): string {
  return prefix + key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
}
