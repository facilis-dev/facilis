import { describe, expect, it } from "vitest";
import { exampleProjectFiles } from "./example-template";
import { mergeRouteMetadata, parseManifestRoutes, routesFromFiles } from "./release-routes";

const TEMPLATE_ROUTES = "server/routes/api/todos/index.get.ts";

describe("routesFromFiles", () => {
  it("derives every route of the template from its file name", () => {
    const routes = routesFromFiles(Object.keys(exampleProjectFiles()));
    expect(routes).toHaveLength(18);
    expect(routes.map((route) => route.method + " " + route.path)).toEqual([
      "DELETE /api/auth/clients/:id",
      "DELETE /api/jobs/:id",
      "DELETE /api/todos/:id",
      "DELETE /api/todos/:id/files/:fileId",
      "GET /api/auth/clients",
      "GET /api/auth/session",
      "GET /api/auth/verify-email",
      "GET /api/files/:id",
      "GET /api/jobs/:id",
      "GET /api/todos",
      "PATCH /api/todos/:id",
      "POST /api/auth/clients",
      "POST /api/auth/login",
      "POST /api/auth/logout",
      "POST /api/auth/register",
      "POST /api/jobs",
      "POST /api/todos",
      "POST /api/todos/:id/files",
    ]);
    const list = routes.find((route) => route.path === "/api/todos" && route.method === "GET");
    expect(list?.sourceFile).toBe(TEMPLATE_ROUTES);
    expect(list?.permission).toBeUndefined();
    expect(list?.dbTables).toBeUndefined();
  });

  it("maps [param] to :param and a catch-all to :param*", () => {
    const routes = routesFromFiles([
      "server/routes/index.get.ts",
      "server/routes/docs/[...slug].get.ts",
      "server/routes/users/[id]/[tab].patch.ts",
    ]);
    expect(routes.map((route) => route.path)).toEqual(["/", "/docs/:slug*", "/users/:id/:tab"]);
  });

  it("ignores files that are not Nitro method routes", () => {
    const routes = routesFromFiles([
      "server/routes/_middleware.ts",
      "server/routes/api/todos/index.ts",
      "server/middleware/auth.ts",
      "db/schema.ts",
    ]);
    expect(routes).toEqual([]);
  });
});

describe("parseManifestRoutes", () => {
  it("narrows the manifest route entries and skips malformed ones", () => {
    const routes = parseManifestRoutes([
      {
        method: "get",
        path: "/api/todos",
        sourceFile: TEMPLATE_ROUTES,
        permission: ["todos:read"],
        dbTables: ["todos"],
        dbColumns: ["todos.title"],
      },
      { method: "post" },
      "nope",
    ]);
    expect(routes).toEqual([
      {
        method: "GET",
        path: "/api/todos",
        sourceFile: TEMPLATE_ROUTES,
        permission: ["todos:read"],
        dbTables: ["todos"],
        dbColumns: ["todos.title"],
      },
    ]);
    expect(parseManifestRoutes(undefined)).toEqual([]);
  });
});

describe("mergeRouteMetadata", () => {
  it("fills the manifest metadata onto the file-derived routes and keeps manifest-only ones", () => {
    const derived = routesFromFiles([TEMPLATE_ROUTES]);
    const metadata = parseManifestRoutes([
      {
        method: "GET",
        path: "/api/todos",
        sourceFile: TEMPLATE_ROUTES,
        permission: "todos:read",
        dbTables: ["todos"],
      },
      { method: "GET", path: "/api/health" },
    ]);
    const merged = mergeRouteMetadata(derived, metadata);
    expect(merged.map((route) => route.path)).toEqual(["/api/health", "/api/todos"]);
    const todos = merged.find((route) => route.path === "/api/todos");
    expect(todos).toMatchObject({
      permission: "todos:read",
      dbTables: ["todos"],
      sourceFile: TEMPLATE_ROUTES,
    });
    expect(merged.find((route) => route.path === "/api/health")?.permission).toBeUndefined();
  });
});
