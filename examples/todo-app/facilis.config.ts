import { defineConfig } from "@facilis.dev/core";

export default defineConfig({
  release: { ref: "origin/main" },
  db: {
    tenantColumns: ["tenantId", "tenant_id"],
    ownerColumns: ["ownerId", "owner_id", "userId", "user_id"],
  },
  i18n: { defaultLocale: "en", locales: ["en", "it"] },
  auth: {
    permissions: [
      "todos:read",
      "todos:write",
      "users:read",
      // tasks:read/tasks:decide back the manual-task routes (D-135): reading the inbox is a
      // normal permission, recording the decision is the manager's.
      "tasks:read",
      "tasks:decide",
      "api-clients:read",
      "api-clients:write",
      // The queue is RLS-gated by these two permissions (D-145): SELECT needs jobs:read,
      // INSERT/UPDATE/DELETE need jobs:exec.
      "jobs:read",
      "jobs:exec",
    ],
    roles: {
      admin: ["*"],
      manager: [
        "todos:read",
        "todos:write",
        "users:read",
        "tasks:read",
        "tasks:decide",
        "jobs:read",
        "jobs:exec",
      ],
      user: ["todos:read", "todos:write", "jobs:read", "jobs:exec"],
    },
    defaultRole: "user",
    sessionDurationMs: 1000 * 60 * 60 * 24 * 7,
    // Email verification for password accounts (D-156). Delivery is deployment-owned: a
    // production deploy sets FACILIS_EMAIL_WEBHOOK_URL; development/test without a webhook
    // verifies immediately (no mailbox needed for the demo or the IDE smoke run).
    verification: { enabled: true },
    // Programmatic API clients (V3a): the client-credentials endpoint and the management
    // routes exist only when enabled; tokens live one hour, so a leaked token is short-lived.
    apiClients: { enabled: true, tokenTtlMs: 3_600_000 },
  },
  // Background jobs (D-107): every key is shown once; a definition may override
  // maxAttempts/timeoutMs, the rest is queue-wide.
  jobs: {
    maxConcurrent: 2,
    maxAttempts: 2,
    retryDelayMs: 1000,
    timeoutMs: 10_000,
    pollIntervalMs: 500,
    persist: true,
  },
  // Workflows (D-135): a chain is durable rows advanced by this tick; an approval step
  // reuses the manual tasks and waits on a task row, never on a job body.
  workflows: {
    tickIntervalMs: 500,
    persist: true,
    defaultTaskTtlMs: null,
  },
  // Operator logging (D-119): every key is shown once. Entries are JSON Lines files under
  // <project>/.facilis/logs in development (open them in the IDE editor) and stdout in
  // production; the sink itself is environment-owned (FACILIS_LOG_SINK/DIR/MAX_BYTES/KEEP).
  logging: {
    access: true,
    errors: true,
    includeUserAgent: false,
  },
  // Binary uploads (D-053, SPEC §5.10): the limits are build-time, the target is runtime.
  // Dev writes to <project>/.facilis/binary; production builds an S3-compatible driver from
  // the FACILIS_S3_* environment variables. Tokens are short-lived HMAC download URLs.
  storage: {
    maxUploadBytes: 5 * 1024 * 1024,
    tokenTtlSeconds: 300,
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
  // Opt-in prerendering (D-202): only the public, unguarded /public-stats page is declared.
  // /todos stays an auth-gated SPA (the negative example). Replace origin with your own.
  prerender: { routes: ["/public-stats"], origin: "https://todo.example.com" },
});
