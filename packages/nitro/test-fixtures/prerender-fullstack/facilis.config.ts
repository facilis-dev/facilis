import { defineConfig } from "@facilis.dev/core";

export default defineConfig({
  db: {
    mode: "pglite",
    tenantColumns: ["tenantId", "tenant_id"],
    ownerColumns: ["ownerId", "owner_id"],
  },
  i18n: { defaultLocale: "en", locales: ["en"] },
  auth: {
    permissions: ["stats:read"],
    roles: { user: ["stats:read"] },
    defaultRole: "user",
  },
  prerender: { routes: ["/", "/stats"], origin: "https://fixture.example" },
});
