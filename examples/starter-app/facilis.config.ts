import { defineConfig } from "@facilis.dev/core";

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
    level: "info",
    access: true,
    errors: true,
    includeUserAgent: false,
    trustProxy: false,
  },
});
