/**
 * Framework runtime requirements (D-224).
 *
 * A package that reads a runtime key declares it here, so a project that does not declare the
 * key fails statically instead of decoding a hidden default. Conditions are data over the
 * project's static config values, never a function the analyzer cannot evaluate.
 *
 * `storageDriver` is unconditional: the boot resolves the storage target on every start
 * (`resolveStorage` in the Nitro bootstrap), and an absent key degrades the subsystem with a
 * manifest warning. The S3 details are conditional on that driver, and the credentials are secrets
 * because a bucket without them still refuses storage.
 *
 * Deliberately absent: `storageSecret`. It is required only in production (development falls back
 * to a per-boot secret), and a requirement cannot read `NODE_ENV` without becoming a deployment
 * check. The boot keeps refusing with `storage_secret_missing`.
 */
import type { JsonValue } from "./schema.ts";

/** A condition over the projected static config: the key must hold exactly this JSON value. */
export interface RuntimeRequirementWhen {
  readonly key: string;
  readonly equals: JsonValue;
}

export interface RuntimeRequirement {
  readonly key: string;
  /** `server` maps to the `runtime` section, `public` to the `public` section. */
  readonly surface: "server" | "public";
  /** The declaration must be the `{ secret: true }` marker, never a literal. */
  readonly secret?: boolean;
  readonly when?: RuntimeRequirementWhen;
}

/** The framework-wide requirements, exported by @facilis.dev/core for tooling and the analyzer. */
export const runtimeRequirements: readonly RuntimeRequirement[] = Object.freeze([
  { key: "databaseMode", surface: "server" },
  { key: "logLevel", surface: "server" },
  // The boot always resolves the storage target, even for a project that never uploads.
  { key: "storageDriver", surface: "server" },
  // An "s3" driver cannot work without a bucket, a region and the credentials.
  { key: "s3Bucket", surface: "server", when: { key: "storageDriver", equals: "s3" } },
  { key: "s3Region", surface: "server", when: { key: "storageDriver", equals: "s3" } },
  {
    key: "s3AccessKeyId",
    surface: "server",
    secret: true,
    when: { key: "storageDriver", equals: "s3" },
  },
  {
    key: "s3SecretAccessKey",
    surface: "server",
    secret: true,
    when: { key: "storageDriver", equals: "s3" },
  },
  // Opt-in telemetry without a collector or an ingestion key exports nothing.
  {
    key: "telemetryEndpoint",
    surface: "server",
    when: { key: "telemetryEnabled", equals: true },
  },
  {
    key: "telemetryTenantKey",
    surface: "server",
    secret: true,
    when: { key: "telemetryEnabled", equals: true },
  },
]);
