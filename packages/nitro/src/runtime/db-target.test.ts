import { defineConfig, type DbMode, type FacilisConfig } from "@facilis/core";
import { describe, expect, it } from "vitest";

import { resolveDbTarget } from "./db-target.ts";

function projectConfig(mode: DbMode): FacilisConfig {
  return defineConfig({
    db: { mode },
    auth: { permissions: ["todos:read"], roles: { user: ["todos:read"] }, defaultRole: "user" },
  });
}

const PRODUCTION: NodeJS.ProcessEnv = { NODE_ENV: "production" };

describe("resolveDbTarget", () => {
  it("defaults to in-memory pglite in development", () => {
    expect(resolveDbTarget(projectConfig("pglite"), { NODE_ENV: "development" })).toEqual({
      target: { driver: "pglite" },
      warnings: [],
    });
  });

  it("treats a missing config as the pglite default", () => {
    expect(resolveDbTarget(null, { NODE_ENV: "development" })).toEqual({
      target: { driver: "pglite" },
      warnings: [],
    });
  });

  it("lets a connection string mean postgres, whatever the config says", () => {
    expect(resolveDbTarget(projectConfig("pglite"), { DATABASE_URL: "postgres://db/app" })).toEqual(
      {
        target: { driver: "postgres", url: "postgres://db/app" },
        warnings: [],
      },
    );
  });

  it("prefers FACILIS_DATABASE_URL over DATABASE_URL", () => {
    const resolved = resolveDbTarget(projectConfig("postgres"), {
      FACILIS_DATABASE_URL: "postgres://db/facilis",
      DATABASE_URL: "postgres://db/other",
    });
    expect(resolved.target).toEqual({ driver: "postgres", url: "postgres://db/facilis" });
  });

  it("treats a blank connection string as not configured", () => {
    // A platform panel can define the variable with an empty value; that must behave like
    // "unset" instead of failing later with an opaque connection error.
    expect(
      resolveDbTarget(projectConfig("pglite"), { NODE_ENV: "development", DATABASE_URL: "   " }),
    ).toEqual({
      target: { driver: "pglite" },
      warnings: [],
    });
    expect(
      resolveDbTarget(projectConfig("postgres"), { DATABASE_URL: "" }).warnings.map((e) => e.code),
    ).toEqual(["db_url_missing"]);
  });

  it("refuses in-memory pglite in production", () => {
    const resolved = resolveDbTarget(projectConfig("pglite"), PRODUCTION);
    expect(resolved.target).toBeNull();
    expect(resolved.warnings.map((entry) => entry.code)).toEqual(["db_pglite_in_production"]);
  });

  it("fails closed on a missing config in production too", () => {
    const resolved = resolveDbTarget(null, PRODUCTION);
    expect(resolved.target).toBeNull();
    expect(resolved.warnings.map((entry) => entry.code)).toEqual(["db_pglite_in_production"]);
  });

  it("refuses postgres mode without a connection string", () => {
    for (const env of [{}, PRODUCTION]) {
      const resolved = resolveDbTarget(projectConfig("postgres"), env);
      expect(resolved.target).toBeNull();
      expect(resolved.warnings.map((entry) => entry.code)).toEqual(["db_url_missing"]);
    }
  });

  it("refuses the json mode", () => {
    const resolved = resolveDbTarget(projectConfig("json"), {});
    expect(resolved.target).toBeNull();
    expect(resolved.warnings.map((entry) => entry.code)).toEqual(["db_mode_unsupported"]);
  });

  it("resolves postgres from a url in production", () => {
    const resolved = resolveDbTarget(projectConfig("pglite"), {
      ...PRODUCTION,
      DATABASE_URL: "postgres://db/app",
    });
    expect(resolved).toEqual({
      target: { driver: "postgres", url: "postgres://db/app" },
      warnings: [],
    });
  });
});
