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
  blocks: { packages: [] },
  auth: {
    permissions: ["todos:read", "todos:write", "users:read"],
    roles: {
      admin: ["*"],
      manager: ["todos:read", "todos:write", "users:read"],
      user: ["todos:read", "todos:write"],
    },
    defaultRole: "user",
    sessionDurationMs: 1000 * 60 * 60 * 24 * 7,
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
});
