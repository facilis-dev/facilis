import { defineConfig } from "@facilis/core";

export default defineConfig({
  release: { ref: "origin/main" },
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
});
