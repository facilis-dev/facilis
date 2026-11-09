import { defineConfig } from "@facilis/core";

export default defineConfig({
  release: { ref: "main" },
  db: {
    mode: "pglite",
    migrationsDir: "db/migrations",
    tenantColumns: ["tenantId"],
    ownerColumns: ["ownerId"],
  },
  i18n: { defaultLocale: "en", locales: ["en", "it"] },
  auth: {
    permissions: ["todos:read", "todos:write"],
    roles: {
      admin: ["*"],
      user: ["todos:read", "todos:write"],
    },
    defaultRole: "user",
  },
});
