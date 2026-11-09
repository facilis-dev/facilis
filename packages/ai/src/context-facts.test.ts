import { describe, expect, it } from "vitest";

import { buildProjectContext } from "./index.ts";
import { CONFIG_IT, makeContext } from "./testing/fixtures.ts";

describe("buildProjectContext", () => {
  it("maps the analyzer config facts", () => {
    const context = makeContext();
    expect(context.config.parsed).toBe(true);
    expect(context.config.permissions).toEqual(["todos:read", "todos:write"]);
    expect(context.config.roles.user).toEqual(["todos:read", "todos:write"]);
    expect(context.config.defaultRole).toBe("user");
    expect(context.config.migrationsDir).toBe("db/migrations");
  });

  it("maps the analyzer schema facts with Drizzle property names", () => {
    const context = makeContext();
    const todos = context.schema.tables.find((table) => table.name === "todos");
    expect(context.schema.parsed).toBe(true);
    expect(todos).toMatchObject({ rlsEnabled: true, scope: { kind: "tenant" } });
    expect(todos?.columns.map((column) => column.property)).toEqual([
      "id",
      "tenantId",
      "ownerId",
      "title",
      "done",
    ]);
    expect(todos?.policies.map((policy) => policy.name)).toEqual([
      "tenant_isolation",
      "owner_isolation",
    ]);
  });

  it("maps the analyzer route facts", () => {
    const routes = makeContext().routes;
    expect(routes.map((route) => route.method + " " + route.path)).toEqual(["GET /api/todos"]);
    expect(routes[0]).toMatchObject({
      wrapper: "valid",
      permission: ["todos:read"],
      dbTables: ["todos"],
      dbColumns: ["todos.title", "todos.done"],
      handlerBodyRead: false,
    });
  });

  it("is a pure mapping: the analysis alone carries the facts", () => {
    const context = makeContext();
    const mapped = buildProjectContext({ files: context.files, analysis: context.analysis });
    expect(mapped.config.permissions).toEqual(["todos:read", "todos:write"]);
    expect(mapped.schema.tables.map((table) => table.name)).toEqual(["todos"]);
    expect(mapped.routes).toHaveLength(1);
    expect(mapped.before).toBe(context.analysis);
  });

  it("merges the manifest catalogue underneath the analyzer catalogue", () => {
    const context = makeContext();
    expect(context.locales["app.title"]).toBe("Facilis todos");
    expect(context.locales["todos.title"]).toBe("Todos");
    expect(context.locales["manifest.only"]).toBe("Manifest fallback");
  });

  it("falls back to the default locale's catalogue when English is absent", () => {
    const context = makeContext([], {
      omit: ["locales/en.json"],
      sources: { "facilis.config.ts": CONFIG_IT },
    });
    expect(context.config.defaultLocale).toBe("it");
    expect(context.locales["app.title"]).toBe("Facilis todos");
    expect(context.locales["manifest.only"]).toBe("Manifest fallback");
  });

  it("reads blocks from the manifest only and tolerates a broken payload", () => {
    expect(makeContext().blocks.map((block) => block.name)).toEqual(["DataTable", "ResourceForm"]);
    expect(makeContext([], { manifest: "broken" }).blocks).toEqual([]);
    expect(makeContext().blocks.map((block) => block.name)).toEqual(["DataTable", "ResourceForm"]);
  });

  it("derives packages and aliases from package.json and tsconfig.json", () => {
    const context = makeContext();
    expect(context.packages).toContain("@facilis/core");
    expect(context.packages).toContain("react");
    expect(context.aliases).toContainEqual({ prefix: "~/", target: "" });
  });

  it("keeps the analyzer config authoritative over the manifest", () => {
    const context = makeContext([], {
      manifest: {
        blocks: [],
        project: { config: { auth: { permissions: ["other:read"], roles: {}, defaultRole: "x" } } },
      },
    });
    expect(context.config.permissions).toEqual(["todos:read", "todos:write"]);
  });

  it("passes the effective and pre-patch analyses through", () => {
    const context = makeContext();
    expect(context.analysis.routes.map((route) => route.sourceFile)).toEqual([
      "server/routes/api/todos/index.get.ts",
    ]);
    expect(context.before.routes.map((route) => route.sourceFile)).toEqual([
      "server/routes/api/todos/index.get.ts",
    ]);
  });
});
