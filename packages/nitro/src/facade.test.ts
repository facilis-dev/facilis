import { describe, expect, it } from "vitest";

import {
  buildOpenApiFacadeResponse,
  mergeOpenApiMetadata,
  NATIVE_OPENAPI_ROUTE,
  type OpenApiDocument,
} from "./facade.ts";
import type { RouteMetadata, RouteMetadataMap } from "./types.ts";

function routeMetadata(overrides: Partial<RouteMetadata>): RouteMetadata {
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

function metadataMap(overrides: Partial<RouteMetadata> = {}): RouteMetadataMap {
  const route = routeMetadata(overrides);
  return { [route.path]: { [route.method.toLowerCase()]: route } };
}

/** Shape of the document Nitro v3's internal OpenAPI handler returns. */
function nitroSpec(): OpenApiDocument {
  return {
    openapi: "3.1.0",
    info: { title: "Nitro Server Routes", version: "1.0.0" },
    servers: [{ url: "http://localhost:3000/", description: "Local Development Server" }],
    paths: {
      "/api/todos": {
        get: {
          tags: ["API Routes"],
          parameters: [],
          responses: { "200": { description: "OK" } },
        },
        post: {
          tags: ["API Routes"],
          parameters: [],
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/todos/{id}": {
        patch: {
          tags: ["API Routes"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/health": {
        get: { tags: ["API Routes"], responses: { "200": { description: "OK" } } },
      },
    },
  };
}

describe("mergeOpenApiMetadata", () => {
  it("merges wrapper config into the matching operations", () => {
    const spec = nitroSpec();
    const metadata: RouteMetadataMap = {
      "/api/todos": {
        get: routeMetadata({
          permission: "todos:read",
          dbTables: ["todos"],
          dbColumns: ["todos.title"],
          description: "List todos.",
          sourceFile: "server/routes/api/todos/index.get.ts",
        }),
      },
    };

    const merged = mergeOpenApiMetadata(spec, metadata);
    expect(merged.paths?.["/api/todos"]?.get).toMatchObject({
      description: "List todos.",
      summary: "List todos.",
      "x-permission": "todos:read",
      "x-db-tables": ["todos"],
      "x-db-columns": ["todos.title"],
      "x-facilis-source": "server/routes/api/todos/index.get.ts",
      tags: ["API Routes"],
    });
  });

  it("does not mutate the native document", () => {
    const spec = nitroSpec();
    const snapshot = structuredClone(spec);
    const merged = mergeOpenApiMetadata(
      spec,
      metadataMap({
        permission: "todos:read",
        dbTables: ["todos"],
        description: "List todos.",
      }),
    );
    expect(spec).toEqual(snapshot);
    expect(merged).not.toBe(spec);
    expect(merged.paths?.["/api/todos"]).not.toBe(spec.paths?.["/api/todos"]);
  });

  it("omits non-static fields and publishes an x-facilis-warning", () => {
    const warning = {
      code: "meta-not-static",
      message: "dbTables is not statically resolvable",
      section: "routes" as const,
    };
    const merged = mergeOpenApiMetadata(nitroSpec(), {
      "/api/todos": {
        get: routeMetadata({ unresolved: ["dbTables"], warnings: [warning] }),
      },
    });

    const operation = merged.paths?.["/api/todos"]?.get;
    expect(operation?.["x-db-tables"]).toBeUndefined();
    expect(operation?.["x-facilis-warning"]).toEqual([
      { code: "meta-not-static", message: warning.message },
    ]);
    // dbColumns and permission were readable, so they are still published.
    expect(operation?.["x-db-columns"]).toEqual([]);
  });

  it("publishes x-cross-site only for a crossSite route", () => {
    const crossSite = mergeOpenApiMetadata(nitroSpec(), metadataMap({ crossSite: true }));
    expect(crossSite.paths?.["/api/todos"]?.get?.["x-cross-site"]).toBe(true);

    const sameOrigin = mergeOpenApiMetadata(nitroSpec(), metadataMap({}));
    expect(sameOrigin.paths?.["/api/todos"]?.get?.["x-cross-site"]).toBeUndefined();
  });

  it("declares bearerAuth and operation security for a cross-site authenticated route", () => {
    const spec: OpenApiDocument = {
      openapi: "3.1.0",
      paths: { "/api/todos": { get: { responses: {} } } },
    };
    const merged = mergeOpenApiMetadata(
      spec,
      metadataMap({ crossSite: true, permission: "todos:read" }),
    );

    expect(merged.components?.securitySchemes).toEqual({
      bearerAuth: { type: "http", scheme: "bearer" },
    });
    expect(merged.paths?.["/api/todos"]?.get?.["security"]).toEqual([{ bearerAuth: [] }]);
  });

  it("omits bearerAuth for a public cross-site route and for a same-origin permission", () => {
    const publicCrossSite = mergeOpenApiMetadata(nitroSpec(), metadataMap({ crossSite: true }));
    expect(publicCrossSite.components).toBeUndefined();
    expect(publicCrossSite.paths?.["/api/todos"]?.get?.["security"]).toBeUndefined();

    const sameOrigin = mergeOpenApiMetadata(nitroSpec(), metadataMap({ permission: "todos:read" }));
    expect(sameOrigin.components).toBeUndefined();
    expect(sameOrigin.paths?.["/api/todos"]?.get?.["security"]).toBeUndefined();
  });

  it("keeps native security schemes when adding bearerAuth", () => {
    const spec: OpenApiDocument = {
      openapi: "3.1.0",
      components: { securitySchemes: { basic: { type: "http", scheme: "basic" } } },
      paths: { "/api/todos": { get: { responses: {} } } },
    };
    const merged = mergeOpenApiMetadata(
      spec,
      metadataMap({ crossSite: true, permission: "todos:read" }),
    );
    expect(merged.components?.securitySchemes).toEqual({
      basic: { type: "http", scheme: "basic" },
      bearerAuth: { type: "http", scheme: "bearer" },
    });
  });

  it("handles multiple permissions (array) and keeps array order", () => {
    const merged = mergeOpenApiMetadata(
      nitroSpec(),
      metadataMap({ permission: ["todos:write", "todos:read"], dbTables: ["todos"] }),
    );
    expect(merged.paths?.["/api/todos"]?.get?.["x-permission"]).toEqual([
      "todos:write",
      "todos:read",
    ]);
  });

  it("ignores metadata for paths/methods that are not in the native spec", () => {
    const spec = nitroSpec();
    const merged = mergeOpenApiMetadata(spec, {
      "/not/in/spec": { get: routeMetadata({ path: "/not/in/spec", dbTables: ["todos"] }) },
      "/api/todos": { delete: routeMetadata({ method: "DELETE", dbTables: ["todos"] }) },
    });
    expect(merged.paths).toEqual(spec.paths);
  });

  it("sets a facilis tag only when the operation has none", () => {
    const spec: OpenApiDocument = {
      openapi: "3.1.0",
      paths: { "/api/health": { get: { responses: {} } } },
    };
    const merged = mergeOpenApiMetadata(
      spec,
      metadataMap({ path: "/api/health", dbTables: [], description: "Health." }),
    );
    expect(merged.paths?.["/api/health"]?.get?.tags).toEqual(["facilis"]);
  });
});

describe("buildOpenApiFacadeResponse", () => {
  it("is a 404 in production", async () => {
    let fetched = false;
    const result = await buildOpenApiFacadeResponse({
      metadata: metadataMap(),
      isProduction: () => true,
      fetchNativeSpec: async () => {
        fetched = true;
        return nitroSpec();
      },
    });
    expect(result.status).toBe(404);
    expect(fetched).toBe(false);
  });

  it("returns a merged document on success", async () => {
    const result = await buildOpenApiFacadeResponse({
      metadata: metadataMap({ permission: "todos:read", dbTables: ["todos"] }),
      isProduction: () => false,
      fetchNativeSpec: async () => nitroSpec(),
    });
    expect(result.status).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-cache");
    const body = result.body as OpenApiDocument;
    expect(body.paths?.["/api/todos"]?.get?.["x-db-tables"]).toEqual(["todos"]);
  });

  it("degrades to an empty spec plus warning when Nitro's generator is off", async () => {
    const result = await buildOpenApiFacadeResponse({
      metadata: metadataMap(),
      isProduction: () => false,
      fetchNativeSpec: async () => null,
    });
    expect(result.status).toBe(200);
    const body = result.body as OpenApiDocument;
    expect(body.paths).toEqual({});
    expect(body["x-facilis-warning"]).toEqual([
      expect.objectContaining({ code: "openapi-unavailable" }),
    ]);
    expect(NATIVE_OPENAPI_ROUTE).toBe("/_facilis/openapi.json");
  });

  it("treats a rejecting fetcher as unavailable", async () => {
    const result = await buildOpenApiFacadeResponse({
      metadata: {},
      isProduction: () => false,
      fetchNativeSpec: async () => {
        throw new Error("boom");
      },
    });
    expect(result.status).toBe(200);
  });
});
