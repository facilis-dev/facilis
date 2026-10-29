import { defineConfig } from "@facilis/core";

export default defineConfig({
  release: { ref: "origin/main" },
  db: {
    mode: "pglite",
    migrationsDir: "db/migrations",
    tenantColumns: ["tenantId"],
    ownerColumns: ["ownerId"],
  },
  i18n: { defaultLocale: "en", locales: ["en"] },
  blocks: { packages: [] },
  auth: {
    permissions: ["todos:read", "todos:write"],
    roles: { admin: ["*"], user: ["todos:read"] },
    defaultRole: "user",
    sessionDurationMs: 60_480_000,
  },
  // Nitro options live in this file (D-034); the loader must merge them over the defaults.
  nitro: { devServer: { runner: "self" } },
});
