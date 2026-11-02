import { describe, expect, it } from "vitest";
import { parseOpenApi } from "./api-flow-parse";

const DOCUMENT = {
  openapi: "3.1.0",
  paths: {
    "/api/todos": {
      get: {
        summary: "List todos",
        description: "Lists the tenant's todos",
        "x-permission": "todos:read",
        "x-db-tables": ["todos"],
        "x-db-columns": ["todos.title"],
        "x-facilis-source": "server/routes/api/todos/index.get.ts",
      },
      post: {
        "x-permission": ["todos:write", "todos:read"],
        "x-db-tables": ["todos"],
        "x-facilis-warning": [
          { code: "meta-not-static", message: "dbTables is not static" },
          { nope: true },
        ],
      },
      parameters: [{ name: "id" }],
    },
    "/api/todos/{id}": {
      delete: {
        "x-db-tables": ["todos"],
        "x-facilis-source": "server/routes/api/todos/[id].delete.ts",
      },
      options: { summary: "CORS preflight" },
    },
    "/api/broken": "not a path item",
  },
  "x-facilis-warning": [{ code: "openapi-unavailable", message: "no spec" }],
};

describe("parseOpenApi", () => {
  it("keeps every operation of a path item and skips non-operation keys", () => {
    const parsed = parseOpenApi(DOCUMENT);
    expect(parsed).not.toBeNull();
    if (parsed === null) return;
    expect(parsed.operations.map((entry) => entry.method + " " + entry.path)).toEqual([
      "GET /api/todos",
      "POST /api/todos",
      "DELETE /api/todos/{id}",
    ]);
  });

  it("flattens the x-* metadata and normalizes a scalar permission", () => {
    const parsed = parseOpenApi(DOCUMENT);
    if (parsed === null) throw new Error("payload was not parsed");
    const get = parsed.operations[0];
    expect(get).toMatchObject({
      method: "GET",
      path: "/api/todos",
      summary: "List todos",
      description: "Lists the tenant's todos",
      permission: ["todos:read"],
      dbTables: ["todos"],
      dbColumns: ["todos.title"],
      sourceFile: "server/routes/api/todos/index.get.ts",
      warnings: [],
    });
    expect(get?.permission).toHaveLength(1);
  });

  it("keeps an array permission and defaults the missing metadata", () => {
    const parsed = parseOpenApi(DOCUMENT);
    if (parsed === null) throw new Error("payload was not parsed");
    const post = parsed.operations[1];
    expect(post?.permission).toEqual(["todos:write", "todos:read"]);
    const remove = parsed.operations[2];
    expect(remove).toMatchObject({
      permission: [],
      dbColumns: [],
      summary: null,
      description: null,
      warnings: [],
    });
  });

  it("collects operation warnings with their route and top-level warnings", () => {
    const parsed = parseOpenApi(DOCUMENT);
    if (parsed === null) throw new Error("payload was not parsed");
    expect(parsed.operations[1]?.warnings).toEqual([
      {
        code: "meta-not-static",
        message: "dbTables is not static",
        method: "POST",
        path: "/api/todos",
      },
    ]);
    expect(parsed.warnings).toEqual([{ code: "openapi-unavailable", message: "no spec" }]);
  });

  it("accepts a single warning object as well as the array", () => {
    const parsed = parseOpenApi({
      paths: { "/api/x": { get: { "x-facilis-warning": { message: "one" } } } },
    });
    if (parsed === null) throw new Error("payload was not parsed");
    expect(parsed.operations[0]?.warnings).toEqual([
      { message: "one", method: "GET", path: "/api/x" },
    ]);
    expect(parseOpenApi({ paths: {} })).toEqual({ operations: [], warnings: [] });
  });

  it("rejects a body that is not an OpenAPI document", () => {
    expect(parseOpenApi(null)).toBeNull();
    expect(parseOpenApi({ hello: "world" })).toBeNull();
    expect(parseOpenApi({ paths: [] })).toBeNull();
  });
});
