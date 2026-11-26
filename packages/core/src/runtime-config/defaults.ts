import { DEFAULT_TENANT_ID } from "../tenancy.ts";
import type { FacilisPublicConfig, FacilisRuntimeDeclaration } from "./schema.ts";

/**
 * The framework's canonical values, for TOOLING ONLY (D-224).
 *
 * The generator writes them into a new project, the `runtime-key-missing` message prints the line
 * to paste, and the upgrade engine offers a bump. The runtime NEVER merges them: the app's file is
 * the only source of a runtime value, so a deployment's behaviour is readable from the repository.
 */
export const KNOWN_RUNTIME_KEYS = [
  "databaseMode",
  "databaseUrl",
  "logLevel",
  "logSink",
  "logDir",
  "logMaxBytes",
  "logKeep",
  "logTrustProxy",
  "storageDriver",
  "storageSecret",
  "s3Bucket",
  "s3Region",
  "s3Endpoint",
  "s3ForcePathStyle",
  "s3AccessKeyId",
  "s3SecretAccessKey",
  "s3SessionToken",
  "storageEncryptionKey",
  "storageEncryptionKeyId",
  "storageEncryptionRetiredKeys",
  "publicOrigin",
  "tenantId",
  "deploymentId",
  "initialAdmin",
  "initialAdminToken",
  "emailWebhookUrl",
  "emailWebhookToken",
  "telemetryEnabled",
  "telemetryEndpoint",
  "telemetryOrigins",
  "telemetrySampling",
  "telemetryService",
  "telemetrySpansPerMin",
  "telemetryTenantKey",
  "stateDir",
] as const;

export type KnownRuntimeKey = (typeof KNOWN_RUNTIME_KEYS)[number];

export const RUNTIME_CANONICAL = Object.freeze({
  databaseMode: "pglite",
  databaseUrl: { secret: true },
  logLevel: "info",
  logSink: "auto",
  logDir: null,
  logMaxBytes: 10 * 1024 * 1024,
  logKeep: 5,
  logTrustProxy: false,
  storageDriver: "local",
  storageSecret: { secret: true },
  s3Bucket: null,
  s3Region: null,
  s3Endpoint: null,
  s3ForcePathStyle: null,
  s3AccessKeyId: { secret: true },
  s3SecretAccessKey: { secret: true },
  s3SessionToken: { secret: true },
  storageEncryptionKey: { secret: true },
  storageEncryptionKeyId: "primary",
  storageEncryptionRetiredKeys: { secret: true },
  publicOrigin: null,
  tenantId: DEFAULT_TENANT_ID,
  deploymentId: null,
  initialAdmin: null,
  initialAdminToken: { secret: true },
  emailWebhookUrl: null,
  emailWebhookToken: { secret: true },
  telemetryEnabled: false,
  telemetryEndpoint: null,
  telemetryOrigins: [],
  telemetrySampling: 1,
  telemetryService: "facilis-app",
  telemetrySpansPerMin: 24,
  telemetryTenantKey: { secret: true },
  stateDir: null,
} satisfies Record<KnownRuntimeKey, FacilisRuntimeDeclaration>);

/** No framework key is public today: every value here belongs to the app (D-224). */
export const PUBLIC_CANONICAL = Object.freeze({}) satisfies FacilisPublicConfig;
