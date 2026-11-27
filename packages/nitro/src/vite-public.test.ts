import { describe, expect, it } from "vitest";

import { defineConfig } from "@facilis.dev/core";

import { PUBLIC_CONFIG_DEFINE, publicConfigDefine } from "./vite-public.ts";

const AUTH = {
  permissions: [],
  roles: { user: [] },
  defaultRole: "user",
  sessionDurationMs: 1000,
};

const CONFIG = defineConfig({
  auth: AUTH,
  runtime: { databaseMode: "pglite" },
  public: { appName: "My app", features: { comments: true } },
});

describe("publicConfigDefine (D-224)", () => {
  it("bakes the declared public values under the define name", () => {
    const define = publicConfigDefine(CONFIG, {});
    expect(Object.keys(define)).toEqual([PUBLIC_CONFIG_DEFINE]);
    expect(PUBLIC_CONFIG_DEFINE).toBe("__FACILIS_PUBLIC_CONFIG__");
    expect(JSON.parse(define[PUBLIC_CONFIG_DEFINE] ?? "null")).toEqual({
      appName: "My app",
      features: { comments: true },
    });
  });

  it("lets the build environment override a declared value", () => {
    const define = publicConfigDefine(CONFIG, { FACILIS_PUBLIC_APP_NAME: "Deployed app" });
    expect(JSON.parse(define[PUBLIC_CONFIG_DEFINE] ?? "null")).toMatchObject({
      appName: "Deployed app",
      features: { comments: true },
    });
  });

  it("bakes an empty object when the project declares nothing", () => {
    expect(JSON.parse(publicConfigDefine(null, {})[PUBLIC_CONFIG_DEFINE] ?? "null")).toEqual({});
  });

  it("fails the build by name on a public variable the section does not declare", () => {
    expect(() => publicConfigDefine(CONFIG, { FACILIS_PUBLIC_APPNME: "x" })).toThrow(
      /FACILIS_PUBLIC_APPNME/,
    );
  });

  it("never bakes a runtime key: the two surfaces stay separate", () => {
    const define = publicConfigDefine(CONFIG, { FACILIS_DATABASE_MODE: "postgres" });
    const baked = JSON.parse(define[PUBLIC_CONFIG_DEFINE] ?? "null") as Record<string, unknown>;
    expect(Object.keys(baked).toSorted()).toEqual(["appName", "features"]);
  });
});
