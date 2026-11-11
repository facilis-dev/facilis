import { describe, expect, it } from "vitest";
import { defineConfig, summarizeManifest } from "@facilis.dev/core";

import type { RouteMetadata, RouteMetadataMap } from "../types.ts";
import { buildManifestData, flattenRouteMetadata, toRouteMeta } from "./manifest-data.ts";

const config = defineConfig({
  auth: {
    permissions: ["todos:read", "todos:write"],
    roles: { admin: ["*"], user: ["todos:read"] },
    defaultRole: "user",
  },
});

function route(overrides: Partial<RouteMetadata>): RouteMetadata {
  return {
    method: "GET",
    path: "/api/todos",
    dbTables: [],
    dbColumns: [],
    unresolved: [],
    warnings: [],
    ...overrides,
  };
}

describe("toRouteMeta", () => {
  it("maps the AST metadata onto the manifest route contract", () => {
    expect(
      toRouteMeta(
        route({
          method: "POST",
          permission: "todos:write",
          dbTables: ["todos"],
          dbColumns: ["todos.title"],
          description: "Create a todo.",
          sourceFile: "server/routes/api/todos/index.post.ts",
        }),
      ),
    ).toEqual({
      method: "POST",
      path: "/api/todos",
      summary: "Create a todo.",
      description: "Create a todo.",
      permission: "todos:write",
      rawSql: false,
      dbTables: ["todos"],
      dbColumns: ["todos.title"],
      security: "required",
      sourceFile: "server/routes/api/todos/index.post.ts",
    });
  });

  it("exposes crossSite only when the route declares it", () => {
    expect(toRouteMeta(route({ crossSite: true })).crossSite).toBe(true);
    expect(toRouteMeta(route({})).crossSite).toBeUndefined();
  });

  it("maps rawSql and omits an unreadable flag", () => {
    expect(toRouteMeta(route({ rawSql: true })).rawSql).toBe(true);
    expect(toRouteMeta(route({ rawSql: false })).rawSql).toBe(false);
    expect(toRouteMeta(route({ rawSql: false, unresolved: ["rawSql"] })).rawSql).toBeUndefined();
  });

  it("classifies public, required and unknown routes", () => {
    expect(toRouteMeta(route({ permission: [] })).security).toBe("public");
    expect(toRouteMeta(route({})).security).toBe("public");
    expect(toRouteMeta(route({ permission: "todos:read" })).security).toBe("required");
    expect(toRouteMeta(route({ unresolved: ["permission"] })).security).toBe("unknown");
  });
});

describe("flattenRouteMetadata", () => {
  it("orders routes by path then method", () => {
    const metadata: RouteMetadataMap = {
      "/b": { get: route({ path: "/b" }) },
      "/a": {
        post: route({ path: "/a", method: "POST" }),
        get: route({ path: "/a" }),
      },
    };
    expect(flattenRouteMetadata(metadata).map((entry) => `${entry.method} ${entry.path}`)).toEqual([
      "GET /a",
      "POST /a",
      "GET /b",
    ]);
  });
});

describe("buildManifestData", () => {
  it("builds a complete manifest and no warnings", () => {
    const result = buildManifestData({
      config,
      routeMetadata: { "/api/todos": { get: route({ dbTables: ["todos"] }) } },
      catalogs: { en: { "todos.title": "Title" } },
      coreVersion: "1.2.3",
      nitroVersion: "3.0.0",
    });

    expect(result.partial).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.manifest.framework).toEqual({ coreVersion: "1.2.3", nitroVersion: "3.0.0" });
    expect(result.manifest.routes).toHaveLength(1);
    expect(result.manifest.schema).toEqual({ tables: [] });
    expect(result.manifest.i18n).toEqual({
      defaultLocale: "en",
      catalogs: { en: { "todos.title": "Title" } },
    });
  });

  it("surfaces route warnings and a failed schema as a partial", () => {
    const failure = {
      code: "schema_unavailable",
      message: "boom",
      section: "schema" as const,
    };
    const result = buildManifestData({
      config,
      routeMetadata: {
        "/api/todos": {
          get: route({
            unresolved: ["dbTables"],
            warnings: [{ code: "meta-not-static", message: "x" }],
          }),
        },
      },
      schemaFailure: failure,
    });

    expect(result.partial).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "meta-not-static",
      "schema_unavailable",
    ]);
  });

  it("produces a bounded summary (SPEC §14.1-11)", () => {
    const result = buildManifestData({ config, routeMetadata: {} });
    const summary = summarizeManifest(result.manifest);
    expect(JSON.stringify(summary).length).toBeLessThan(2000);
  });
});
