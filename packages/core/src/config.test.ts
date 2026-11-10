import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOGGING_CONFIG,
  DEFAULT_STORAGE_CONFIG,
  defineConfig,
  facilisConfigSchema,
  type FacilisConfig,
} from "./config.ts";

const SPEC_AUTH = {
  permissions: ["todos:read", "todos:write", "users:read", "users:manage", "admin:*"],
  roles: {
    admin: ["*"],
    manager: ["todos:read", "todos:write", "users:read"],
    user: ["todos:read", "todos:write"],
    viewer: ["todos:read"],
  },
  defaultRole: "user",
  sessionDurationMs: 1000 * 60 * 60 * 24 * 7,
  sso: { providers: [], failureRedirect: "/login", stateTtlMs: 10 * 60 * 1000 },
} as const;

const FULL_CONFIG: FacilisConfig = {
  release: { ref: "main" },
  db: {
    mode: "pglite",
    migrationsDir: "./drizzle",
    tenantColumns: ["tenantId"],
    ownerColumns: ["ownerId"],
  },
  i18n: { defaultLocale: "en", locales: ["en", "fr"] },
  auth: SPEC_AUTH,
  jobs: {
    maxConcurrent: 3,
    maxAttempts: 2,
    retryDelayMs: 500,
    timeoutMs: 5000,
    pollIntervalMs: 500,
    persist: false,
  },
  workflows: { tickIntervalMs: 750, persist: false, defaultTaskTtlMs: 60_000 },
  storage: {
    driver: "s3",
    bucket: "facilis-files",
    region: "auto",
    endpoint: "https://example.r2.cloudflarestorage.com",
    forcePathStyle: true,
    maxUploadBytes: 5 * 1024 * 1024,
    tokenTtlSeconds: 120,
    encryption: { enabled: true },
  },
  logging: DEFAULT_LOGGING_CONFIG,
  nitro: { serverDir: "./backend" },
};

describe("defineConfig", () => {
  it("accepts the SPEC §8.4.1 auth declaration on its own", () => {
    const config = defineConfig({ auth: SPEC_AUTH });

    expect(config.auth.roles.admin).toEqual(["*"]);
    expect(config.auth.defaultRole).toBe("user");
  });

  it("resolves the full config shape when sections are omitted", () => {
    const config = defineConfig({ auth: SPEC_AUTH });

    expect(config.release).toEqual({ ref: "main" });
    expect(config.db).toEqual({
      mode: "pglite",
      migrationsDir: "./drizzle",
      tenantColumns: ["tenantId"],
      ownerColumns: ["ownerId"],
    });
    expect(config.i18n).toEqual({ defaultLocale: "en", locales: ["en"] });
    expect(config.auth.sessionDurationMs).toBe(1000 * 60 * 60 * 24 * 7);
    // The queue is safe by default: two slots, no retry, persisted (D-107).
    expect(config.jobs).toEqual({
      maxConcurrent: 2,
      maxAttempts: 1,
      retryDelayMs: 5000,
      timeoutMs: 30_000,
      pollIntervalMs: 1000,
      persist: true,
    });
    // Uploads are safe by default in dev: local driver, 10 MiB, five-minute tokens.
    expect(config.storage).toEqual(DEFAULT_STORAGE_CONFIG);
    expect(config.nitro).toEqual({});
  });

  it("passes the project's Nitro options through untouched", () => {
    const nitro = {
      serverDir: "./backend",
      experimental: { openAPI: false },
      devServer: { runner: "self" },
    };

    // Any Nitro option is legal here: Facilis does not narrow or strip the section.
    const config = defineConfig({ auth: SPEC_AUTH, nitro });

    expect(config.nitro).toEqual(nitro);
  });

  it("rejects a Nitro section that is not an object", () => {
    expect(() => defineConfig({ auth: SPEC_AUTH, nitro: ["server"] as never })).toThrow(/nitro/);
  });

  it("returns an explicit full config unchanged", () => {
    const config = defineConfig(FULL_CONFIG);

    expect(config).toEqual(FULL_CONFIG);
  });

  it("accepts a wildcard role permission but not a wildcard permission declaration", () => {
    expect(() => defineConfig({ auth: SPEC_AUTH })).not.toThrow();

    expect(() =>
      defineConfig({
        auth: {
          ...SPEC_AUTH,
          permissions: [...SPEC_AUTH.permissions, "*"],
        },
      }),
    ).toThrow(/only valid inside auth\.roles/);
  });

  it("rejects a role that references an undeclared permission", () => {
    expect(() =>
      defineConfig({
        auth: {
          permissions: ["todos:read"],
          roles: { user: ["todos:read", "todos:delete"] },
          defaultRole: "user",
        },
      }),
    ).toThrow(/role "user" references unknown permission "todos:delete"/);
  });

  it("rejects a defaultRole that is not declared in roles", () => {
    expect(() =>
      defineConfig({
        auth: {
          permissions: ["todos:read"],
          roles: { viewer: ["todos:read"] },
          defaultRole: "user",
        },
      }),
    ).toThrow(/defaultRole "user" is not a key of auth\.roles/);
  });

  it("rejects duplicate permissions inside a role and in the permission list", () => {
    expect(() =>
      defineConfig({
        auth: {
          permissions: ["todos:read"],
          roles: { user: ["todos:read", "todos:read"] },
          defaultRole: "user",
        },
      }),
    ).toThrow(/repeats "todos:read"/);

    expect(() =>
      defineConfig({
        auth: {
          permissions: ["todos:read", "todos:read"],
          roles: { user: [] },
          defaultRole: "user",
        },
      }),
    ).toThrow(/duplicate permission "todos:read"/);
  });

  it("validates the jobs section and rejects an unknown key", () => {
    expect(() => defineConfig({ auth: SPEC_AUTH, jobs: { maxConcurrent: 0 } as never })).toThrow(
      /maxConcurrent/,
    );
    expect(() =>
      defineConfig({
        auth: SPEC_AUTH,
        jobs: { concurrency: 2 } as unknown as FacilisConfig["jobs"],
      }),
    ).toThrow(/Unrecognized key/);
  });

  it("parses the storage encryption switch and rejects unknown storage keys", () => {
    const config = defineConfig({ auth: SPEC_AUTH, storage: { encryption: { enabled: true } } });

    expect(config.storage.encryption).toEqual({ enabled: true });
    expect(() =>
      defineConfig({ auth: SPEC_AUTH, storage: { encryption: { algorithm: "aes" } } as never }),
    ).toThrow(/Unrecognized key/);
  });

  it("rejects an invalid database mode", () => {
    expect(() =>
      defineConfig({ ...FULL_CONFIG, db: { ...FULL_CONFIG.db, mode: "sqlite" } as never }),
    ).toThrow(/mode/);
  });

  it("rejects a non-positive session duration", () => {
    expect(() => defineConfig({ auth: { ...SPEC_AUTH, sessionDurationMs: 0 } })).toThrow(
      /sessionDurationMs/,
    );
  });

  it("rejects a default locale that is not listed", () => {
    expect(() =>
      defineConfig({ ...FULL_CONFIG, i18n: { defaultLocale: "de", locales: ["en"] } }),
    ).toThrow(/defaultLocale "de" must be listed/);
  });

  it("rejects unknown top-level sections instead of silently dropping them", () => {
    expect(() =>
      defineConfig({ ...FULL_CONFIG, releaseRef: "main" } as unknown as FacilisConfig),
    ).toThrow(/Unrecognized key/);
  });

  it("reports every issue through the schema without throwing", () => {
    const result = facilisConfigSchema.safeParse({
      auth: {
        permissions: ["todos:read"],
        roles: { user: ["todos:delete"] },
        defaultRole: "admin",
      },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const messages = result.error.issues.map((issue) => issue.message);
    expect(messages.some((message) => message.includes("unknown permission"))).toBe(true);
    expect(messages.some((message) => message.includes("defaultRole"))).toBe(true);
  });
});
