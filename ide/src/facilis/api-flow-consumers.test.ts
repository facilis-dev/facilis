import { describe, expect, it } from "vitest";
import type { ApiMethod, ApiOperation } from "./api-flow-client";
import type { ApiConsumerRef, ApiFlowConsumers, ApiFlowSourceFile } from "./api-flow-consumers";
import { scanApiConsumers } from "./api-flow-consumers";

/** Minimal ApiOperation: only method/path matter to the consumer scan. */
function operation(method: ApiMethod, path: string): ApiOperation {
  return {
    method,
    path,
    summary: null,
    description: null,
    permission: [],
    dbTables: [],
    dbColumns: [],
    sourceFile: null,
    warnings: [],
  };
}

function file(path: string, text: string): ApiFlowSourceFile {
  return { path, text };
}

function consumersOf(result: ApiFlowConsumers, routeId: string): readonly ApiConsumerRef[] {
  return result.byRoute[routeId] ?? [];
}

const TODO_ROUTE = "route:GET /api/todos";

describe("scanApiConsumers", () => {
  it("links a direct URL literal, ignoring query and static-segment case", () => {
    const result = scanApiConsumers(
      [file("src/pages/todos.tsx", `fetch("/api/todos")`)],
      [operation("GET", "/api/TODOS")],
    );
    expect(result.byRoute).toEqual({
      "route:GET /api/TODOS": [{ path: "src/pages/todos.tsx", kind: "page", via: null }],
    });
    expect(result.unusedRoutes).toEqual([]);
  });

  it("takes the static prefix of a dynamic template literal", () => {
    const result = scanApiConsumers(
      [file("src/lib/todos.ts", "const url = `/api/todos/${id}`;")],
      [operation("GET", "/api/todos/{id}")],
    );
    expect(consumersOf(result, "route:GET /api/todos/{id}")).toEqual([
      { path: "src/lib/todos.ts", kind: "lib", via: null },
    ]);
  });

  it("matches dynamic route segments :id, [id] and *", () => {
    const result = scanApiConsumers(
      [
        file("src/pages/todo.tsx", `fetch("/api/todos/42")`),
        file("src/pages/doc.tsx", `fetch("/api/files/readme.md")`),
        file("src/pages/asset.tsx", `fetch("/api/assets/logo.png")`),
      ],
      [
        operation("GET", "/api/todos/:id"),
        operation("GET", "/api/files/[name]"),
        operation("GET", "/api/assets/*"),
      ],
    );
    expect(result.byRoute).toEqual({
      "route:GET /api/assets/*": [{ path: "src/pages/asset.tsx", kind: "page", via: null }],
      "route:GET /api/files/[name]": [{ path: "src/pages/doc.tsx", kind: "page", via: null }],
      "route:GET /api/todos/:id": [{ path: "src/pages/todo.tsx", kind: "page", via: null }],
    });
    expect(result.unusedRoutes).toEqual([]);
  });

  it("accepts a reference as a route prefix only when missing segments are dynamic", () => {
    const result = scanApiConsumers(
      [file("src/lib/http.ts", `fetch("/api/todos/")`)],
      [operation("GET", "/api/todos/:id"), operation("GET", "/api/todos/:id/comments")],
    );
    expect(Object.keys(result.byRoute)).toEqual(["route:GET /api/todos/:id"]);
    expect(result.unusedRoutes).toEqual(["route:GET /api/todos/:id/comments"]);
  });

  it("adds importers through the @/ alias with via set to the URL module", () => {
    const files = [
      file("src/lib/todos.ts", `export const list = () => fetch("/api/todos")`),
      file("src/pages/todos.tsx", `import { list } from "@/lib/todos";`),
    ];
    const result = scanApiConsumers(files, [operation("GET", "/api/todos")]);
    expect(result.byRoute[TODO_ROUTE]).toEqual([
      { path: "src/pages/todos.tsx", kind: "page", via: "src/lib/todos.ts" },
      { path: "src/lib/todos.ts", kind: "lib", via: null },
    ]);
  });

  it("resolves relative imports, index modules and does not split by method", () => {
    const files = [
      file("src/pages/todos.tsx", `import { list } from "../lib/todos";`),
      file("src/lib/todos.ts", `fetch("/api/todos")`),
      file("src/components/todo-form.tsx", `import { save } from "./todo-api";`),
      file("src/components/todo-api/index.ts", `fetch("/api/todos", { method: "POST" })`),
    ];
    const operations = [operation("GET", "/api/todos"), operation("POST", "/api/todos")];
    const result = scanApiConsumers(files, operations);
    const expected = [
      { path: "src/pages/todos.tsx", kind: "page", via: "src/lib/todos.ts" },
      { path: "src/components/todo-api/index.ts", kind: "component", via: null },
      {
        path: "src/components/todo-form.tsx",
        kind: "component",
        via: "src/components/todo-api/index.ts",
      },
      { path: "src/lib/todos.ts", kind: "lib", via: null },
    ];
    expect(result.byRoute["route:GET /api/todos"]).toEqual(expected);
    expect(result.byRoute["route:POST /api/todos"]).toEqual(expected);
    expect(result.unusedRoutes).toEqual([]);
  });

  it("lists routes without consumers in operations order", () => {
    const result = scanApiConsumers(
      [file("src/lib/todos.ts", `fetch("/api/todos")`)],
      [
        operation("GET", "/api/todos"),
        operation("POST", "/api/users"),
        operation("DELETE", "/api/users/:id"),
      ],
    );
    expect(result.byRoute[TODO_ROUTE]).toEqual([
      { path: "src/lib/todos.ts", kind: "lib", via: null },
    ]);
    expect(result.unusedRoutes).toEqual(["route:POST /api/users", "route:DELETE /api/users/:id"]);
  });

  it("ignores server, db, locales and node_modules files", () => {
    const result = scanApiConsumers(
      [
        file("server/routes/todos.get.ts", `fetch("/api/todos")`),
        file("db/seed.ts", `fetch("/api/todos")`),
        file("locales/en.json", `{"api": "/api/todos"}`),
        file("node_modules/lib/index.js", `fetch("/api/todos")`),
      ],
      [operation("GET", "/api/todos")],
    );
    expect(result.byRoute).toEqual({});
    expect(result.unusedRoutes).toEqual([TODO_ROUTE]);
  });

  it("deduplicates repeated URLs and keeps the direct hit over the indirect one", () => {
    const files = [
      file("src/lib/todos.ts", `fetch("/api/todos"); fetch("/api/todos");`),
      file("src/pages/todos.tsx", `import { list } from "../lib/todos"; fetch("/api/todos");`),
    ];
    const result = scanApiConsumers(files, [operation("GET", "/api/todos")]);
    expect(result.byRoute[TODO_ROUTE]).toEqual([
      { path: "src/pages/todos.tsx", kind: "page", via: null },
      { path: "src/lib/todos.ts", kind: "lib", via: null },
    ]);
  });

  it("does not link an importer when the imported module holds no URL", () => {
    const result = scanApiConsumers(
      [
        file("src/lib/format.ts", `export const format = (value: number) => String(value);`),
        file("src/pages/home.tsx", `import { format } from "@/lib/format";`),
      ],
      [operation("GET", "/api/todos")],
    );
    expect(result.byRoute).toEqual({});
    expect(result.unusedRoutes).toEqual([TODO_ROUTE]);
  });
});
