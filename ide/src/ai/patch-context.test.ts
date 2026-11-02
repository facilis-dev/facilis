import { afterEach, describe, expect, it, vi } from "vitest";

import { loadProjectContext, type PatchContextHost } from "./patch-context";

const CONFIG = `import { defineConfig } from "@facilis/core";

export default defineConfig({
  auth: { permissions: ["todos:read"], roles: { admin: ["*"] }, defaultRole: "admin" },
});
`;

const SCHEMA = `import { pgTable, text, uuid } from "drizzle-orm/pg-core";

export const todos = pgTable("todos", { id: uuid("id").primaryKey(), title: text("title").notNull() });
`;

const SOURCES: Record<string, string> = {
  "facilis.config.ts": CONFIG,
  "db/schema.ts": SCHEMA,
  "locales/en.json": JSON.stringify({ "app.title": "Facilis" }),
  "package.json": JSON.stringify({ dependencies: { react: "19.3.1" } }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "~/*": ["./*"] } } }),
};

function host(overrides: Partial<PatchContextHost> = {}): PatchContextHost {
  return {
    files: () => ["facilis.config.ts", "db/schema.ts", "src/app.tsx"],
    read: async (path) => SOURCES[path] ?? "",
    manifestBase: () => null,
    syntaxChecker: () => ({ check: async () => [] }),
    ...overrides,
  };
}

function envelope(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadProjectContext", () => {
  it("parses the project sources into the validator context", async () => {
    const loaded = await loadProjectContext(host());
    expect(loaded.context.config.permissions).toEqual(["todos:read"]);
    expect(loaded.context.schema.tables.map((table) => table.name)).toEqual(["todos"]);
    expect(loaded.context.locales["app.title"]).toBe("Facilis");
    expect(loaded.context.packages).toContain("react");
    expect(loaded.checker).not.toBeNull();
  });

  it("includes the live manifest when the project is running", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        envelope({
          revision: "rev-1",
          generatedAt: "2026-11-02T00:00:00.000Z",
          sections: ["config", "routes", "blocks", "schema", "i18n"],
          manifest: {
            routes: [
              {
                method: "GET",
                path: "/api/todos",
                permission: ["todos:read"],
                dbTables: ["todos"],
                dbColumns: [],
              },
            ],
            blocks: [{ name: "DataTable" }],
            i18n: { defaultLocale: "en", catalogs: { en: { "todos.title": "Todos" } } },
          },
          warnings: [],
        }),
      ),
    );
    const loaded = await loadProjectContext(
      host({ manifestBase: () => "http://127.0.0.1:5199/preview/3000" }),
    );
    expect(loaded.context.routes).toHaveLength(1);
    expect(loaded.context.blocks).toEqual([{ name: "DataTable" }]);
    expect(loaded.context.locales["todos.title"]).toBe("Todos");
  });

  it("treats an unreadable project as an empty context", async () => {
    const loaded = await loadProjectContext(
      host({
        files: () => [],
        read: async () => {
          throw new Error("missing");
        },
      }),
    );
    expect(loaded.context.files).toEqual([]);
    expect(loaded.context.schema.tables).toEqual([]);
    expect(loaded.checker).not.toBeNull();
  });
});
