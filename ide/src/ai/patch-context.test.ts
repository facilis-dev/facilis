import { afterEach, describe, expect, it, vi } from "vitest";

import { analyzeSources } from "./analysis-fixtures";
import { loadProjectContext, type PatchContextHost } from "./patch-context";

const ANALYSIS = analyzeSources(new Map());

const SOURCES: Record<string, string> = {
  "package.json": JSON.stringify({ dependencies: { react: "19.3.1" } }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "~/*": ["./*"] } } }),
  "facilis.config.ts": "export default {};\n",
};

function host(overrides: Partial<PatchContextHost> = {}): PatchContextHost {
  return {
    files: () => ["facilis.config.ts", "db/schema.ts", "src/app.tsx"],
    read: async (path) => SOURCES[path] ?? "",
    manifestBase: () => null,
    syntaxChecker: () => ({ check: async () => [] }),
    analyze: async () => ({ before: ANALYSIS, after: ANALYSIS }),
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
  it("reads only the two raw sources the analyzer does not model", async () => {
    const loaded = await loadProjectContext(host());
    expect(Object.keys(loaded.sources).sort()).toEqual(["package.json", "tsconfig.json"]);
    expect(loaded.sources["package.json"]).toContain("react");
    expect(loaded.manifest).toBeUndefined();
    expect(loaded.checker).not.toBeNull();
  });

  it("passes the live manifest through when the project is running", async () => {
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
    expect(loaded.manifest).toMatchObject({ blocks: [{ name: "DataTable" }] });
  });

  it("treats an unreadable project as empty base material", async () => {
    const loaded = await loadProjectContext(
      host({
        files: () => [],
        read: async () => {
          throw new Error("missing");
        },
      }),
    );
    expect(loaded.sources).toEqual({});
    expect(loaded.checker).not.toBeNull();
  });
});
