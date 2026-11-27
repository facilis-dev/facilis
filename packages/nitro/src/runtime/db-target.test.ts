import { defineConfig, type FacilisRuntimeConfig } from "@facilis.dev/core";
import { describe, expect, it } from "vitest";

import { resolveDbTarget } from "./db-target.ts";

const PRODUCTION: NodeJS.ProcessEnv = { NODE_ENV: "production" };

function runtimeWith(databaseMode?: string, databaseUrl?: string): FacilisRuntimeConfig {
  return {
    ...(databaseMode === undefined ? {} : { databaseMode }),
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
  };
}

describe("resolveDbTarget", () => {
  it("opens in-memory pglite when runtime.databaseMode declares it", () => {
    expect(resolveDbTarget(runtimeWith("pglite"), { NODE_ENV: "development" })).toEqual({
      target: { driver: "pglite" },
      warnings: [],
    });
  });

  it("degrades when runtime.databaseMode is not declared", () => {
    const resolved = resolveDbTarget({}, { NODE_ENV: "development" });
    expect(resolved.target).toBeNull();
    expect(resolved.warnings.map((entry) => entry.code)).toEqual(["db_database_mode_missing"]);
    expect(resolved.warnings[0]?.message).toContain("runtime.databaseMode");
    expect(resolved.warnings[0]?.message).toContain("FACILIS_DATABASE_MODE");
  });

  it("lets a declared connection string mean postgres, whatever the mode says", () => {
    expect(
      resolveDbTarget(runtimeWith("pglite", "postgres://db/app"), { NODE_ENV: "development" }),
    ).toEqual({
      target: { driver: "postgres", url: "postgres://db/app" },
      warnings: [],
    });
  });

  it("ignores a host DATABASE_URL: one key, one variable (D-224)", () => {
    const resolved = resolveDbTarget(runtimeWith("postgres"), {
      DATABASE_URL: "postgres://db/app",
    });
    expect(resolved.target).toBeNull();
    expect(resolved.warnings.map((entry) => entry.code)).toEqual(["db_url_missing"]);
    expect(resolved.warnings[0]?.message).toContain("FACILIS_DATABASE_URL");
  });

  it("treats a blank connection string as not configured", () => {
    // A platform panel can define the variable with an empty value; that must behave like
    // "unset" instead of failing later with an opaque connection error.
    expect(
      resolveDbTarget(runtimeWith("pglite", "   "), { NODE_ENV: "development" }),
    ).toEqual({
      target: { driver: "pglite" },
      warnings: [],
    });
    expect(
      resolveDbTarget(runtimeWith("postgres", ""), {}).warnings.map((e) => e.code),
    ).toEqual(["db_url_missing"]);
  });

  it("refuses in-memory pglite in production", () => {
    const resolved = resolveDbTarget(runtimeWith("pglite"), PRODUCTION);
    expect(resolved.target).toBeNull();
    expect(resolved.warnings.map((entry) => entry.code)).toEqual(["db_pglite_in_production"]);
  });

  it("fails closed on an undeclared mode in production too", () => {
    const resolved = resolveDbTarget({}, PRODUCTION);
    expect(resolved.target).toBeNull();
    expect(resolved.warnings.map((entry) => entry.code)).toEqual(["db_database_mode_missing"]);
  });

  it("refuses postgres mode without a connection string", () => {
    for (const env of [{}, PRODUCTION]) {
      const resolved = resolveDbTarget(runtimeWith("postgres"), env);
      expect(resolved.target).toBeNull();
      expect(resolved.warnings.map((entry) => entry.code)).toEqual(["db_url_missing"]);
    }
  });

  it("refuses the json mode", () => {
    const resolved = resolveDbTarget(runtimeWith("json"), {});
    expect(resolved.target).toBeNull();
    expect(resolved.warnings.map((entry) => entry.code)).toEqual(["db_mode_unsupported"]);
  });

  it("resolves postgres from a declared url in production", () => {
    const resolved = resolveDbTarget(runtimeWith("pglite", "postgres://db/app"), PRODUCTION);
    expect(resolved.target).toEqual({ driver: "postgres", url: "postgres://db/app" });
  });

  it("reaches the consumer through the declaration in facilis.config.ts", () => {
    const config = defineConfig({
      auth: { roles: { user: [] }, defaultRole: "user" },
      runtime: { databaseMode: "pglite" },
    });

    expect(config.runtime["databaseMode"]).toBe("pglite");
    expect(resolveDbTarget(config.runtime, { NODE_ENV: "development" })).toEqual({
      target: { driver: "pglite" },
      warnings: [],
    });
  });
});
