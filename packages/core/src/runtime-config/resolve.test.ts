import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import { KNOWN_RUNTIME_KEYS, RUNTIME_CANONICAL } from "./defaults.ts";
import {
  assertNoRuntimeProblems,
  envNameFor,
  installRuntimeConfig,
  peekRuntimeConfig,
  resolvePublicConfig,
  resolveRuntimeConfig,
  runtimeEnv,
} from "./resolve.ts";
import { publicSectionSchema, runtimeSectionSchema } from "./schema.ts";
import { SecretString } from "./secret-string.ts";

describe("envNameFor", () => {
  it("is one flat key to one variable", () => {
    expect(envNameFor("logMaxBytes")).toBe("FACILIS_LOG_MAX_BYTES");
    expect(envNameFor("logTrustProxy")).toBe("FACILIS_LOG_TRUST_PROXY");
    expect(envNameFor("appName", "FACILIS_PUBLIC_")).toBe("FACILIS_PUBLIC_APP_NAME");
  });
});

describe("resolveRuntimeConfig", () => {
  it("keeps the declared value when the environment is silent", () => {
    const { runtime, problems } = resolveRuntimeConfig({ runtime: { logLevel: "info" }, env: {} });
    expect(runtime["logLevel"]).toBe("info");
    expect(problems).toEqual([]);
  });

  it("lets the environment win over the declaration, with the declared type as the codec", () => {
    const { runtime, problems } = resolveRuntimeConfig({
      runtime: { logTrustProxy: false, logMaxBytes: 10 * 1024 * 1024 },
      env: { FACILIS_LOG_TRUST_PROXY: "1", FACILIS_LOG_MAX_BYTES: "2048" },
    });
    expect(runtime["logTrustProxy"]).toBe(true);
    expect(runtime["logMaxBytes"]).toBe(2048);
    expect(problems).toEqual([]);
  });

  it("parses booleans strictly instead of trusting truthiness", () => {
    const { problems } = resolveRuntimeConfig({
      runtime: { logTrustProxy: false },
      env: { FACILIS_LOG_TRUST_PROXY: "yes" },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.code).toBe("invalid-env");
  });

  it("parses a JSON array for an array declaration", () => {
    const { runtime, problems } = resolveRuntimeConfig({
      runtime: { telemetryOrigins: [] },
      env: { FACILIS_TELEMETRY_ORIGINS: '["https://a.test","https://b.test"]' },
    });
    expect(runtime["telemetryOrigins"]).toEqual(["https://a.test", "https://b.test"]);
    expect(problems).toEqual([]);
  });

  it("boxes a secret and keeps it out of every string form", () => {
    const secret = "super-secret-value";
    const { runtime, problems } = resolveRuntimeConfig({
      runtime: { databaseUrl: { secret: true } },
      env: { FACILIS_DATABASE_URL: secret },
    });
    expect(problems).toEqual([]);
    const box = runtime["databaseUrl"];
    expect(box).toBeInstanceOf(SecretString);
    expect((box as SecretString).reveal()).toBe(secret);
    expect(JSON.stringify(runtime)).not.toContain(secret);
    expect(String(box)).not.toContain(secret);
    expect(inspect(box)).not.toContain(secret);
  });

  it("leaves an absent secret as null instead of guessing", () => {
    const { runtime } = resolveRuntimeConfig({ runtime: { databaseUrl: { secret: true } }, env: {} });
    expect(runtime["databaseUrl"]).toBeNull();
  });

  it("refuses a secret exported empty", () => {
    const { problems } = resolveRuntimeConfig({
      runtime: { databaseUrl: { secret: true } },
      env: { FACILIS_DATABASE_URL: "   " },
    });
    expect(problems.map((entry) => entry.code)).toEqual(["empty-secret"]);
  });

  it("reports an unknown variable with the nearest known name", () => {
    const { problems } = resolveRuntimeConfig({
      runtime: { logLevel: "info" },
      env: { FACILIS_LOG_LEVL: "debug" },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.code).toBe("unknown-env");
    expect(problems[0]?.message).toContain("FACILIS_LOG_LEVEL");
  });

  it("ignores build-only switches and public variables at boot", () => {
    const { problems } = resolveRuntimeConfig({
      runtime: { logLevel: "info" },
      env: { FACILIS_DEV_METRICS: "0", FACILIS_PUBLIC_APP_NAME: "My app" },
    });
    expect(problems).toEqual([]);
  });

  it("refuses to invent a value for a key the app never declared", () => {
    const { runtime } = resolveRuntimeConfig({ runtime: {}, env: { FACILIS_LOG_LEVEL: "debug" } });
    expect(runtime).not.toHaveProperty("logLevel");
  });

  it("reports provenance per key, declared or environment", () => {
    const { runtime, sources } = resolveRuntimeConfig({
      runtime: { logLevel: "info", logTrustProxy: false, databaseUrl: { secret: true } },
      env: { FACILIS_LOG_TRUST_PROXY: "1", FACILIS_DATABASE_URL: "postgres://a.test/db" },
    });
    expect(sources).toEqual({ logLevel: "declared", logTrustProxy: "env", databaseUrl: "env" });
    expect(Object.keys(sources).toSorted()).toEqual(Object.keys(runtime).toSorted());
  });

  it("reports declared provenance for an absent secret", () => {
    const { sources } = resolveRuntimeConfig({ runtime: { databaseUrl: { secret: true } }, env: {} });
    expect(sources).toEqual({ databaseUrl: "declared" });
  });

  it("leaves an invalid environment value out of provenance", () => {
    const { runtime, sources } = resolveRuntimeConfig({
      runtime: { logMaxBytes: 1024 },
      env: { FACILIS_LOG_MAX_BYTES: "nope" },
    });
    expect(runtime).not.toHaveProperty("logMaxBytes");
    expect(sources).not.toHaveProperty("logMaxBytes");
  });
});

describe("resolvePublicConfig", () => {
  it("overrides a baked value at build time only", () => {
    const { public: values, sources: publicSources, problems } = resolvePublicConfig({
      public: { appName: "My app", features: { comments: true } },
      env: { FACILIS_PUBLIC_APP_NAME: "Deployed app" },
    });
    expect(values["appName"]).toBe("Deployed app");
    expect(values["features"]).toEqual({ comments: true });
    expect(problems).toEqual([]);
    expect(publicSources).toEqual({ appName: "env", features: "declared" });
  });

  it("reports an unknown public variable", () => {
    const { problems } = resolvePublicConfig({
      public: { appName: "My app" },
      env: { FACILIS_PUBLIC_APPNME: "x" },
    });
    expect(problems[0]?.code).toBe("unknown-env");
  });
});

describe("assertNoRuntimeProblems", () => {
  it("throws one aggregated report", () => {
    const { problems } = resolveRuntimeConfig({
      runtime: { logLevel: "info" },
      env: { FACILIS_LOG_LEVEL: "verbose", FACILIS_LOG_KEP: "3" },
    });
    expect(() => assertNoRuntimeProblems(problems)).toThrow(/FATAL runtime env[\s\S]*FACILIS_LOG_KEP/);
  });
});

describe("runtimeEnv", () => {
  it("refuses to answer before the boot installs it", () => {
    expect(() => runtimeEnv()).toThrow(/not installed/);
  });

  it("peeks an empty, frozen config before the boot installs it", () => {
    const empty = peekRuntimeConfig();
    expect(empty).toEqual({});
    expect(Object.isFrozen(empty)).toBe(true);
  });

  it("returns the same frozen object once installed", () => {
    const { runtime } = resolveRuntimeConfig({ runtime: { logLevel: "warn" }, env: {} });
    installRuntimeConfig(runtime);
    expect(runtimeEnv()).toBe(runtime);
    expect(Object.isFrozen(runtime)).toBe(true);
  });
});

describe("section schemas", () => {
  it("rejects a secret marker under public", () => {
    expect(() => publicSectionSchema.parse({ appName: { secret: true } })).toThrow(/can never be a secret/);
  });

  it("rejects a key that would produce an ambiguous variable name", () => {
    expect(() => runtimeSectionSchema.parse({ LogLevel: "info" })).toThrow();
  });

  it("accepts an app-defined key alongside the framework's", () => {
    expect(runtimeSectionSchema.parse({ logLevel: "info", supportEmail: "help@a.test" })).toEqual({
      logLevel: "info",
      supportEmail: "help@a.test",
    });
  });
});

describe("canonical tooling values", () => {
  it("cover exactly the known keys", () => {
    expect(Object.keys(RUNTIME_CANONICAL).toSorted()).toEqual([...KNOWN_RUNTIME_KEYS].toSorted());
  });

  it("declare a source for every secret and a literal for the rest", () => {
    for (const [key, value] of Object.entries(RUNTIME_CANONICAL)) {
      const isMarker = typeof value === "object" && value !== null && "secret" in value;
      expect(isMarker || value !== undefined, key).toBe(true);
    }
  });
});
