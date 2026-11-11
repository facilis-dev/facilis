import { defineConfig } from "@facilis/core";

export default defineConfig({
  release: { ref: "origin/main" },
  // Dev default. Production refuses in-memory PGlite: set FACILIS_DATABASE_URL (or
  // DATABASE_URL) and the runtime opens Postgres instead (D-068).
  db: {
    mode: "pglite",
    migrationsDir: "db/migrations",
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
    level: "info",
    access: true,
    errors: true,
    includeUserAgent: false,
    trustProxy: false,
  },
  // Binary uploads (D-053, SPEC §5.10): every key is shown once. Dev writes to
  // <project>/.facilis/binary; production builds an S3-compatible driver from the
  // FACILIS_S3_* environment variables. Tokens are short-lived HMAC download URLs.
  storage: {
    driver: "local",
    maxUploadBytes: 5 * 1024 * 1024,
    tokenTtlSeconds: 300,
  },
});
