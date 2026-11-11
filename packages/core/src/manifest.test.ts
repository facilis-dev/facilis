import { describe, expect, it } from "vitest";

import { defineConfig } from "./config.ts";
import {
  buildManifest,
  isManifestSection,
  MANIFEST_SECTIONS,
  summarizeManifest,
  type BlockManifest,
  type RouteMeta,
  type SchemaSnapshot,
} from "./manifest.ts";

const config = defineConfig({
  i18n: { defaultLocale: "en", locales: ["en", "fr"] },
  auth: {
    permissions: ["todos:read", "todos:write", "users:read"],
    roles: {
      admin: ["*"],
      user: ["todos:read", "todos:write"],
      viewer: ["todos:read"],
    },
    defaultRole: "user",
  },
});

const schema: SchemaSnapshot = {
  tables: [
    {
      name: "todos",
      rlsEnabled: true,
      columns: [
        {
          name: "id",
          type: "uuid",
          notNull: true,
          default: "gen_random_uuid()",
          isPrimaryKey: true,
          isUnique: true,
        },
        {
          name: "title",
          type: "text",
          notNull: true,
          default: null,
          isPrimaryKey: false,
          isUnique: false,
        },
        {
          name: "tenant_id",
          type: "uuid",
          notNull: true,
          default: null,
          isPrimaryKey: false,
          isUnique: false,
        },
      ],
      foreignKeys: [],
      policies: [
        {
          name: "todos_tenant_isolation",
          command: "ALL",
          using: "tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid",
          withCheck: null,
          sql: "CREATE POLICY todos_tenant_isolation ON todos",
        },
      ],
      scopeColumn: { name: "tenant_id", kind: "tenant" },
    },
    {
      name: "users",
      rlsEnabled: true,
      columns: [
        {
          name: "id",
          type: "uuid",
          notNull: true,
          default: null,
          isPrimaryKey: true,
          isUnique: true,
        },
      ],
      foreignKeys: [],
      policies: [],
    },
  ],
};

const blocks: readonly BlockManifest[] = [
  {
    name: "DataTable",
    version: "0.0.0",
    category: "data",
    description: "Paginated data table",
    propsSchema: { type: "object", properties: { resource: { type: "string" } } },
    requiredPermissions: ["todos:read"],
  },
  {
    name: "ResourceForm",
    version: "0.0.0",
    category: "form",
    description: "Schema-driven form",
    propsSchema: { type: "object" },
  },
];

const routes: readonly RouteMeta[] = [
  {
    method: "GET",
    path: "/api/todos",
    permission: "todos:read",
    dbTables: ["todos"],
    dbColumns: ["todos.title"],
    security: "required",
    sourceFile: "server/routes/api/todos/index.get.ts",
  },
  {
    method: "POST",
    path: "/api/todos",
    permission: ["todos:write"],
    rawSql: true,
    dbTables: ["todos"],
    dbColumns: [],
    security: "required",
  },
  {
    method: "POST",
    path: "/api/auth/session",
    permission: [],
    crossSite: true,
    dbTables: [],
    dbColumns: [],
    security: "public",
  },
];

const catalogs = {
  en: { "todos.title": "Todos" },
  fr: { "todos.title": "Tâches" },
};

describe("buildManifest", () => {
  it("returns a complete manifest with empty sections by default", () => {
    const manifest = buildManifest({ config });

    expect(manifest).toEqual({
      framework: { coreVersion: "0.0.0", nitroVersion: "0.0.0" },
      project: { config },
      blocks: [],
      routes: [],
      schema: { tables: [] },
      i18n: { defaultLocale: "en", catalogs: {} },
    });
  });

  it("assembles the provided sections and versions without mutation", () => {
    const manifest = buildManifest({
      config,
      coreVersion: "0.0.0",
      nitroVersion: "3.0.260903-beta",
      blocks,
      routes,
      schema,
      catalogs,
    });

    expect(manifest.framework.nitroVersion).toBe("3.0.260903-beta");
    expect(manifest.blocks).toBe(blocks);
    expect(manifest.routes).toBe(routes);
    expect(manifest.schema).toBe(schema);
    expect(manifest.i18n).toEqual({ defaultLocale: "en", catalogs });
  });

  it("keeps the optional rawSql derogation on the route", () => {
    const manifest = buildManifest({ config, routes });

    expect(manifest.routes[1]?.rawSql).toBe(true);
    expect(manifest.routes[0]?.rawSql).toBeUndefined();
  });

  it("keeps the optional crossSite flag on the route", () => {
    const manifest = buildManifest({ config, routes });

    expect(manifest.routes.find((route) => route.path === "/api/auth/session")?.crossSite).toBe(
      true,
    );
    expect(manifest.routes[0]?.crossSite).toBeUndefined();
  });
});

describe("summarizeManifest", () => {
  const manifest = buildManifest({
    config,
    coreVersion: "0.0.0",
    nitroVersion: "3.0.260903-beta",
    blocks,
    routes,
    schema,
    catalogs,
  });
  const summary = summarizeManifest(manifest);

  it("counts sections and schema objects", () => {
    expect(summary.counts).toEqual({
      blocks: 2,
      routes: 3,
      tables: 2,
      columns: 4,
      policies: 1,
      locales: 2,
      permissions: 3,
      roles: 3,
    });
    expect(summary.project).toEqual({ dbMode: "pglite", releaseRef: "main", defaultLocale: "en" });
  });

  it("lists sorted identifiers only", () => {
    expect(summary.blocks).toEqual(["DataTable", "ResourceForm"]);
    expect(summary.tables).toEqual(["todos", "users"]);
    expect(summary.locales).toEqual(["en", "fr"]);
  });

  it("stays under the 500-token budget (< 2000 characters, SPEC §14.1-11)", () => {
    expect(JSON.stringify(summary).length).toBeLessThan(2000);
  });
});

describe("manifest sections", () => {
  it("declares the six query sections of SPEC §6.1", () => {
    expect(MANIFEST_SECTIONS).toEqual(["config", "blocks", "routes", "schema", "i18n", "meta"]);
  });

  it("narrows unknown section values", () => {
    expect(isManifestSection("schema")).toBe(true);
    expect(isManifestSection("secrets")).toBe(false);
    expect(isManifestSection(42)).toBe(false);
  });
});
