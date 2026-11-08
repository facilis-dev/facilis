import { describe, expect, it } from "vitest";

import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import { buildConfigFacts, emptyConfigFacts } from "./config.ts";
import { routeLocationFromFile } from "./route-location.ts";
import { buildRouteFacts } from "./routes.ts";
import { loadFixtureProject } from "../../test-fixtures/load.ts";

const CORE_IMPORT = 'import { defineAuthorizedHandler } from "@facilis/core";\n';

function graphOf(files: Record<string, string>) {
  return createModuleGraph({ files: new Map(Object.entries(files)), parser: createOxcParser() });
}

function fixtureRoutes() {
  const graph = createModuleGraph({ files: loadFixtureProject(), parser: createOxcParser() });
  return buildRouteFacts(graph, buildConfigFacts(graph).facts);
}

function routesOf(files: Record<string, string>, config = emptyConfigFacts()) {
  return buildRouteFacts(graphOf(files), config);
}

/** A valid wrapped handler with a minimal config, for the direct-DB warning tests. */
function wrapped(handler: string): string {
  return (
    CORE_IMPORT +
    "export default defineAuthorizedHandler({ permission: [], dbTables: [] }, " +
    handler +
    ");\n"
  );
}

describe("routeLocationFromFile", () => {
  it("derives Nitro locations, including the extra methods and method-less ALL", () => {
    expect(routeLocationFromFile("index.get.ts")).toEqual({ method: "GET", path: "/" });
    expect(routeLocationFromFile("api/todos/index.post.ts")).toEqual({
      method: "POST",
      path: "/api/todos",
    });
    expect(routeLocationFromFile("api/todos/[id].patch.ts")).toEqual({
      method: "PATCH",
      path: "/api/todos/{id}",
    });
    expect(routeLocationFromFile("api/health.ts")).toEqual({ method: "ALL", path: "/api/health" });
    expect(routeLocationFromFile("files/[...path].get.ts")).toEqual({
      method: "GET",
      path: "/files/{*path}",
    });
    expect(routeLocationFromFile("api/todos/[id].head.ts")?.method).toBe("HEAD");
    expect(routeLocationFromFile("api/x.options.ts")?.method).toBe("OPTIONS");
    expect(routeLocationFromFile("api/x.trace.ts")?.method).toBe("TRACE");
    expect(routeLocationFromFile("api/x.connect.ts")?.method).toBe("CONNECT");
  });

  it("drops route groups and env suffixes", () => {
    expect(routeLocationFromFile("(admin)/users/[id].delete.prod.ts")).toEqual({
      method: "DELETE",
      path: "/users/{id}",
    });
  });

  it("returns undefined for unparseable names", () => {
    expect(routeLocationFromFile("")).toBeUndefined();
    expect(routeLocationFromFile(".get.ts")).toBeUndefined();
  });
});

describe("buildRouteFacts", () => {
  it("reads the fixture routes deterministically", () => {
    const { routes, diagnostics } = fixtureRoutes();
    expect(routes.map((route) => route.method + " " + route.path)).toEqual([
      "GET /api/todos",
      "POST /api/todos",
      "PATCH /api/todos/{id}",
      "GET /api/unsafe",
    ]);
    expect(diagnostics.map((item) => item.code)).toEqual(["route-wrapper"]);
  });

  it("reads the direct wrapper form", () => {
    const route = fixtureRoutes().routes[0];
    expect(route?.wrapper).toBe("valid");
    expect(route?.sourceFile).toBe("server/routes/api/todos/index.get.ts");
    expect(route?.permission).toEqual(["todos:read"]);
    expect(route?.dbTables).toEqual(["todos"]);
    expect(route?.dbColumns).toEqual(["todos.title", "todos.done", "todos.ownerId"]);
    expect(route?.description).toBe("List todos");
    expect(route?.input).toEqual({ body: false, form: false, query: true, params: false });
    expect(route?.unknown).toEqual([]);
  });

  it("reads the const-then-export form and an imported dbTables const", () => {
    const route = fixtureRoutes().routes[1];
    expect(route?.wrapper).toBe("valid");
    expect(route?.permission).toEqual(["todos:write"]);
    expect(route?.dbTables).toEqual(["todos"]);
    expect(route?.dbColumns).toEqual([]);
    expect(route?.description).toBe("Create a todo");
    expect(route?.input).toEqual({ body: true, form: false, query: false, params: false });
    expect(route?.handlerBodyRead).toBe(true);
  });

  it("flags only handlers that read the request body", () => {
    const routes = fixtureRoutes().routes;
    expect(routes[0]?.handlerBodyRead).toBe(false);
    expect(routes[3]?.handlerBodyRead).toBe(false);
  });

  it("reads a multipart form schema and a handler that reads the form", () => {
    const { routes } = routesOf({
      "server/routes/api/todos/upload.post.ts":
        'import { z } from "zod";\n' +
        CORE_IMPORT +
        "export default defineAuthorizedHandler(\n" +
        "  { permission: [], form: z.object({ file: z.any() }), dbTables: [] },\n" +
        "  async (_event, { form }) => form,\n" +
        ");",
    });
    expect(routes[0]?.input).toEqual({ body: false, form: true, query: false, params: false });
    expect(routes[0]?.handlerFormRead).toBe(true);
    expect(routes[0]?.handlerBodyRead).toBe(false);
  });

  it("marks form present even when the schema is not statically readable", () => {
    const { routes } = routesOf({
      "server/routes/api/todos/upload.post.ts":
        CORE_IMPORT +
        "const formSchema = loadSchema();\n" +
        "export default defineAuthorizedHandler(\n" +
        "  { permission: [], form: formSchema, dbTables: [] },\n" +
        "  async () => null,\n" +
        ");",
    });
    expect(routes[0]?.input.form).toBe(true);
    expect(routes[0]?.handlerFormRead).toBe(false);
  });

  it("keeps an unwrapped route with wrapper invalid", () => {
    const { routes, diagnostics } = fixtureRoutes();
    const route = routes[3];
    expect(route?.wrapper).toBe("invalid");
    expect(route?.permission).toBeNull();
    expect(route?.dbTables).toBeNull();
    expect(route?.unknown).toHaveLength(1);
    expect(diagnostics[0]?.source?.file).toBe("server/routes/api/unsafe.get.ts");
  });

  it("scans server/api files and method-less files as ALL", () => {
    const { routes } = routesOf({
      "server/api/ping.ts":
        CORE_IMPORT +
        "export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async () => null);",
    });
    expect(routes.map((route) => route.method + " " + route.path)).toEqual(["ALL /ping"]);
  });

  it("reports a config via a same-file const and a default re-export", () => {
    const { routes } = routesOf({
      "server/routes/items.get.ts":
        CORE_IMPORT +
        'const config = { permission: [], dbTables: [], description: "x" } as const;\n' +
        "const handler = defineAuthorizedHandler(config, async () => null);\nexport { handler as default };",
    });
    expect(routes[0]?.wrapper).toBe("valid");
    expect(routes[0]?.description).toBe("x");
  });

  it("reports missing permission and dbTables", () => {
    const { routes, diagnostics } = routesOf({
      "server/routes/x.get.ts":
        CORE_IMPORT +
        'export default defineAuthorizedHandler({ description: "x" }, async () => null);',
    });
    expect(routes[0]?.permission).toBeNull();
    expect(routes[0]?.dbTables).toBeNull();
    expect(diagnostics.map((item) => item.code)).toEqual([
      "db-tables-present",
      "route-config-static",
    ]);
  });

  it("validates a route permission against the config", () => {
    const { diagnostics } = routesOf({
      "server/routes/x.get.ts":
        CORE_IMPORT +
        'export default defineAuthorizedHandler({ permission: ["todos:read"], dbTables: [] }, async () => null);',
    });
    expect(diagnostics.map((item) => item.code)).toEqual(["permission-declared"]);
  });

  it("rejects a locally shadowed wrapper", () => {
    const { routes, diagnostics } = routesOf({
      "server/routes/x.get.ts":
        "function defineAuthorizedHandler(value: unknown): unknown { return value; }\n" +
        "export default defineAuthorizedHandler({ permission: [], dbTables: [] });",
    });
    expect(routes[0]?.wrapper).toBe("invalid");
    expect(diagnostics[0]?.code).toBe("route-wrapper");
  });

  describe("route-direct-db warnings", () => {
    const MESSAGE =
      "Direct DB access bypasses the policy-scoped client; use ctx.db for user-scoped work and ctx.system/ctx.sudo for audited system operations (not recommended).";

    it("warns on event.context.facilis.db access", () => {
      const { diagnostics } = routesOf({
        "server/routes/x.get.ts": wrapped("async (event) => event.context.facilis.db.select()"),
      });
      const warnings = diagnostics.filter((item) => item.code === "route-direct-db");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        severity: "warning",
        message: MESSAGE,
        source: { file: "server/routes/x.get.ts", line: 2 },
      });
    });

    it("warns on the raw createDb import, including an aliased one", () => {
      const direct = routesOf({
        "server/routes/x.get.ts":
          'import { createDb } from "@facilis/db";\n' + wrapped("async () => null"),
      });
      expect(direct.diagnostics.filter((item) => item.code === "route-direct-db")).toHaveLength(1);
      const aliased = routesOf({
        "server/routes/x.get.ts":
          'import { createDb as rawDb } from "@facilis/db";\n' + wrapped("async () => null"),
      });
      expect(aliased.diagnostics.filter((item) => item.code === "route-direct-db")).toHaveLength(1);
    });

    it("does not warn for the policy-scoped ctx.db", () => {
      for (const handler of [
        "async (_event, { db }) => db.select()",
        "async (_event, ctx) => ctx.db.select()",
      ]) {
        const { diagnostics } = routesOf({ "server/routes/x.get.ts": wrapped(handler) });
        expect(diagnostics.map((item) => item.code)).not.toContain("route-direct-db");
      }
    });

    it("does not warn for a .db chain outside the facilis context", () => {
      const { diagnostics } = routesOf({
        "server/routes/x.get.ts": wrapped("async (event) => event.context.db.select()"),
      });
      expect(diagnostics.map((item) => item.code)).not.toContain("route-direct-db");
    });

    it("keeps the fixture routes clean", () => {
      expect(fixtureRoutes().diagnostics.map((item) => item.code)).toEqual(["route-wrapper"]);
    });
  });

  it("resolves routes under a non-empty project root", () => {
    const routeGraph = createModuleGraph({
      files: new Map([
        [
          "project/server/routes/a.get.ts",
          CORE_IMPORT +
            "export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async () => null);",
        ],
      ]),
      parser: createOxcParser(),
      root: "project",
    });
    const { routes } = buildRouteFacts(routeGraph, emptyConfigFacts());
    expect(routes.map((route) => route.path)).toEqual(["/a"]);
  });
});
