import { describe, expect, it } from "vitest";

import { buildProjectContext } from "./index.ts";
import { CONFIG, makeContext, manifest, SCHEMA } from "./testing/fixtures.ts";

describe("buildProjectContext", () => {
  it("parses the config's roles, permissions and migrations dir", () => {
    const context = makeContext();
    expect(context.config.hasAuth).toBe(true);
    expect(context.config.permissions).toEqual(["todos:read", "todos:write"]);
    expect(context.config.roles.user).toEqual(["todos:read", "todos:write"]);
    expect(context.config.defaultRole).toBe("user");
    expect(context.config.migrationsDir).toBe("db/migrations");
    expect(context.config.blocksPackages).toEqual(["@facilis/blocks"]);
  });

  it("parses the drizzle schema into tables, columns and policies", () => {
    const tables = makeContext().schema.tables;
    const todos = tables.find((table) => table.name === "todos");
    expect(todos).toMatchObject({ rlsEnabled: true, scoped: true, source: "schema" });
    expect(todos?.columns).toEqual(["id", "tenantId", "ownerId", "title", "done"]);
    expect(todos?.policies).toEqual(["tenantIsolationPolicy", "ownerIsolationPolicy"]);
  });

  it("falls back to the manifest when the config source is missing", () => {
    const context = buildProjectContext({
      files: ["db/schema.ts"],
      sources: { "db/schema.ts": SCHEMA },
      manifest: manifest(),
    });
    expect(context.config.permissions).toEqual(["todos:read", "todos:write"]);
    expect(context.routes).toHaveLength(1);
    expect(context.blocks.map((block) => block.name)).toEqual(["DataTable", "ResourceForm"]);
  });

  it("merges the manifest catalogue with the source catalogue", () => {
    const context = makeContext();
    expect(context.locales["app.title"]).toBe("Facilis todos");
    expect(context.locales["todos.title"]).toBe("Todos");
  });

  it("derives packages and aliases from the project files", () => {
    const context = makeContext();
    expect(context.packages).toContain("@facilis/core");
    expect(context.packages).toContain("react");
    expect(context.aliases).toContainEqual({ prefix: "~/", target: "" });
  });

  it("keeps the config source authoritative over the manifest", () => {
    const context = buildProjectContext({
      files: ["facilis.config.ts", "db/schema.ts"],
      sources: { "facilis.config.ts": CONFIG, "db/schema.ts": SCHEMA },
      manifest: {
        ...(manifest() as Record<string, unknown>),
        project: { config: { auth: { permissions: ["other:read"], roles: {}, defaultRole: "x" } } },
      },
    });
    expect(context.config.permissions).toEqual(["todos:read", "todos:write"]);
  });
});
