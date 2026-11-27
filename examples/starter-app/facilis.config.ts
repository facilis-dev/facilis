import { defineConfig } from "@facilis.dev/core";

export default defineConfig({
  release: { ref: "origin/main" },
  db: {
    tenantColumns: ["tenantId", "tenant_id"],
    ownerColumns: ["ownerId", "owner_id", "userId", "user_id"],
  },
  i18n: { defaultLocale: "en", locales: ["en", "it"] },
  // The template's whole surface is login management: accounts, sessions and the two roles
  // every Facilis project starts from. Grow this block as the app grows (SPEC §8.4.1).
  auth: {
    permissions: ["users:read"],
    roles: {
      admin: ["*"],
      user: [],
    },
    defaultRole: "user",
    sessionDurationMs: 1000 * 60 * 60 * 24 * 7,
  },
  // Operator logging (D-119): entries are JSON Lines files under <project>/.facilis/logs in
  // development and stdout in production; the sink itself is environment-owned.
  logging: {
    access: true,
    errors: true,
    includeUserAgent: false,
  },
  // Deployment surface (D-224). Every key a system package reads is declared here: the file
  // owns the values, a FACILIS_<KEY> in the environment overrides one at boot, and a variable
  // whose key is not declared here stops the boot. Secrets are `{ secret: true }` — the source is
  // the environment, never the repository. This list is the framework's whole surface: keep it in
  // sync with `runtimeRequirements` when a package starts reading a new key.
  runtime: {
    // database (D-068): production refuses PGlite, so set FACILIS_DATABASE_URL there
    databaseMode: "pglite",
    databaseUrl: { secret: true },
    // operator logging (D-119)
    logLevel: "info",
    logSink: "auto",
    logDir: null,
    logMaxBytes: 10 * 1024 * 1024,
    logKeep: 5,
    logTrustProxy: false,
    // binary storage (D-053, D-117): local in development, S3-compatible in production
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
    // deployment identity
    publicOrigin: null,
    tenantId: "00000000-0000-0000-0000-000000000000",
    deploymentId: null,
    // auth bootstrap and email verification (D-150, D-156)
    initialAdmin: null,
    initialAdminToken: { secret: true },
    emailWebhookUrl: null,
    emailWebhookToken: { secret: true },
    // telemetry (D-203, D-209): opt-in, production only
    telemetryEnabled: false,
    telemetryEndpoint: null,
    telemetryOrigins: [],
    telemetrySampling: 1,
    telemetryService: "facilis-app",
    telemetrySpansPerMin: 24,
    telemetryTenantKey: { secret: true },
    // development only
    stateDir: null,
  },
});
