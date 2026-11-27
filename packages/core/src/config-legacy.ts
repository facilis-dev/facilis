/**
 * Removed config keys and where each one went (D-224).
 *
 * A project that still declares one of these used to fail with Zod's "Unrecognized key", which
 * names the symptom and not the fix. The breaking move is deliberate, so the error has to carry
 * the replacement line and the environment variable that overrides it.
 */
export interface LegacyConfigKey {
  readonly path: readonly string[];
  readonly replacement: string;
  readonly env: string;
}

export const LEGACY_CONFIG_KEYS: readonly LegacyConfigKey[] = [
  { path: ["db", "mode"], replacement: "runtime.databaseMode", env: "FACILIS_DATABASE_MODE" },
  { path: ["logging", "level"], replacement: "runtime.logLevel", env: "FACILIS_LOG_LEVEL" },
  {
    path: ["logging", "trustProxy"],
    replacement: "runtime.logTrustProxy",
    env: "FACILIS_LOG_TRUST_PROXY",
  },
  {
    path: ["storage", "driver"],
    replacement: "runtime.storageDriver",
    env: "FACILIS_STORAGE_DRIVER",
  },
  { path: ["storage", "bucket"], replacement: "runtime.s3Bucket", env: "FACILIS_S3_BUCKET" },
  { path: ["storage", "region"], replacement: "runtime.s3Region", env: "FACILIS_S3_REGION" },
  {
    path: ["storage", "endpoint"],
    replacement: "runtime.s3Endpoint",
    env: "FACILIS_S3_ENDPOINT",
  },
  {
    path: ["storage", "forcePathStyle"],
    replacement: "runtime.s3ForcePathStyle",
    env: "FACILIS_S3_FORCE_PATH_STYLE",
  },
];

/** Every removed key the input still declares, as ready-to-print lines. */
export function legacyConfigProblems(input: unknown): string[] {
  const problems: string[] = [];
  for (const entry of LEGACY_CONFIG_KEYS) {
    if (!declares(input, entry.path)) continue;
    problems.push(
      "  " +
        entry.path.join(".") +
        " has moved to " +
        entry.replacement +
        " (D-224); declare it in the runtime section or set " +
        entry.env +
        ".",
    );
  }
  return problems;
}

function declares(input: unknown, path: readonly string[]): boolean {
  let current: unknown = input;
  for (const segment of path) {
    if (typeof current !== "object" || current === null) return false;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return true;
}
