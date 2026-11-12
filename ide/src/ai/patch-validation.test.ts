import { describe, expect, it } from "vitest";

import type { FilePatch } from "@facilis.dev/ai";
import { analyzeHostFiles } from "./analysis-fixtures";
import { validatePatchesWithHost, type PatchValidationHost } from "./patch-validation";

const CONFIG = `import { defineConfig } from "@facilis.dev/core";

export default defineConfig({
  auth: {
    permissions: ["todos:read"],
    roles: { admin: ["*"], user: ["todos:read"] },
    defaultRole: "user",
  },
});
`;

const SCHEMA = `import { pgTable, text, uuid } from "drizzle-orm/pg-core";

export const todos = pgTable("todos", { id: uuid("id").primaryKey(), title: text("title").notNull() });
`;

const SOURCES: Record<string, string> = {
  "facilis.config.ts": CONFIG,
  "db/schema.ts": SCHEMA,
  "package.json": JSON.stringify({ dependencies: { "@facilis.dev/core": "workspace:*" } }),
  "locales/en.json": JSON.stringify({ "app.title": "Facilis" }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "~/*": ["./*"] } } }),
};

type HostBase = Omit<PatchValidationHost, "analyze">;

function host(overrides: Partial<PatchValidationHost> = {}): PatchValidationHost {
  const base: HostBase = {
    files: () => [
      "facilis.config.ts",
      "db/schema.ts",
      "package.json",
      "locales/en.json",
      "tsconfig.json",
      "src/app.tsx",
    ],
    read: async (path) => SOURCES[path] ?? "",
    manifestBase: () => null,
    syntaxChecker: () => ({ check: async () => [] }),
    ...overrides,
  };
  return {
    ...base,
    // The fixture host is a VFS, not a worker: analyze what it would read at call time.
    analyze: overrides.analyze ?? ((patches) => analyzeHostFiles(base.files(), base.read, patches)),
  };
}

const ROUTE = "server/routes/api/ping.get.ts";

function route(permission: string): string {
  return (
    'import { defineAuthorizedHandler } from "@facilis.dev/core";\n\n' +
    "export default defineAuthorizedHandler(\n" +
    '  { permission: ["' +
    permission +
    '"], dbTables: ["todos"] },\n' +
    "  async () => null,\n" +
    ");\n"
  );
}

function patch(path: string, content: string): FilePatch {
  return { path, action: "create", content };
}

describe("validatePatchesWithHost", () => {
  it("blocks a route that does not use defineAuthorizedHandler", async () => {
    const result = await validatePatchesWithHost(
      [patch(ROUTE, "export default async () => null;\n")],
      host(),
    );
    expect(result.validation.ok).toBe(false);
    expect(result.validation.errors.map((entry) => entry.rule)).toContain("route-security");
    expect(result.context?.syntax.status).toBe("checked");
  });

  it("accepts a well-formed route", async () => {
    const result = await validatePatchesWithHost([patch(ROUTE, route("todos:read"))], host());
    expect(result.validation.errors).toEqual([]);
    expect(result.validation.ok).toBe(true);
  });

  it("turns parser findings into rule-1 errors", async () => {
    const result = await validatePatchesWithHost(
      [patch("src/feature.ts", "export const value = ;\n")],
      host({
        syntaxChecker: () => ({
          check: async () => [{ line: 1, column: 22, message: "Unexpected token" }],
        }),
      }),
    );
    expect(result.validation.errors).toEqual([
      expect.objectContaining({ rule: "ts-parse", file: "src/feature.ts", line: 1, column: 22 }),
    ]);
  });

  it("fails closed when no parser is injected", async () => {
    const result = await validatePatchesWithHost(
      [patch("src/feature.ts", "export const value = 1;\n")],
      host({ syntaxChecker: () => null }),
    );
    expect(result.validation.errors[0]?.rule).toBe("ts-parse");
  });

  it("fails closed with a blocking result when the analyzer is unavailable", async () => {
    const result = await validatePatchesWithHost(
      [patch("src/feature.ts", "export const value = 1;\n")],
      host({
        analyze: async () => {
          throw new Error("analyzer worker did not become ready within 30s");
        },
      }),
    );
    expect(result.context).toBeNull();
    expect(result.validation.ok).toBe(false);
    expect(result.validation.errors).toEqual([
      expect.objectContaining({
        rule: "project-analysis",
        severity: "error",
        file: "<project>",
        message: expect.stringContaining("analyzer worker did not become ready"),
        infrastructure: true,
      }),
    ]);
    expect(result.validation.errors[0]?.fix_hint).toContain("patches are not validated");
  });

  it("forwards the write policy to rule 11", async () => {
    const ci = patch(".github/workflows/ci.yml", "name: ci\n");
    const open = await validatePatchesWithHost([ci], host(), { writePolicy: "open" });
    expect(open.validation.errors.map((entry) => entry.rule)).not.toContain("file-path-allowed");

    const managed = await validatePatchesWithHost([ci], host(), { writePolicy: "managed" });
    expect(managed.validation.errors.map((entry) => entry.rule)).toContain("file-path-allowed");
  });
});
