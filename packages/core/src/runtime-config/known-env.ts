/**
 * The framework's own keys seen from the environment (D-224).
 *
 * A `FACILIS_*` variable whose name maps to a key a system package reads is a different mistake
 * from a typo: the key exists, the project just does not declare it. The boot says so and prints
 * the exact line, instead of claiming that no key maps to the name.
 */
import { RUNTIME_CANONICAL } from "./defaults.ts";
import { envNameFor } from "./env-names.ts";
import { isSecretMarker } from "./schema.ts";

const KNOWN_ENV_TO_KEY: ReadonlyMap<string, string> = new Map(
  Object.keys(RUNTIME_CANONICAL).map((key) => [envNameFor(key), key]),
);

/** The runtime key a variable name maps to, or null when the name is genuinely unknown. */
export function knownKeyForEnvName(name: string): string | null {
  return KNOWN_ENV_TO_KEY.get(name) ?? null;
}

/** The line to paste into the `runtime` section, taken from the canonical tooling values. */
export function runtimeDeclarationLine(key: string): string {
  const canonical: Readonly<Record<string, unknown>> = RUNTIME_CANONICAL;
  return key + ": " + formatValue(canonical[key]) + ",";
}

function formatValue(value: unknown): string {
  if (value === undefined) return "null";
  if (isSecretMarker(value)) return "{ secret: true }";
  return JSON.stringify(value) ?? "null";
}
