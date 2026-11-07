import { afterEach, describe, expect, it, vi } from "vitest";

import type { FilePatch } from "@facilis/ai";

import { analyzeHostFiles } from "../analysis-fixtures";
import type { PatchValidationHost } from "../patch-validation";
import { isPtcToolError } from "./protocol";
import { createToolRouter } from "./tools";

const CONFIG = `import { defineConfig } from "@facilis/core";

export default defineConfig({
  auth: {
    permissions: ["todos:read", "todos:write"],
    roles: { admin: ["*"], user: ["todos:read"] },
    defaultRole: "user",
  },
});
`;

const SCHEMA = `import { pgTable, text, uuid } from "drizzle-orm/pg-core";

export const todos = pgTable("todos", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
});
`;

const ROUTE = `import { defineAuthorizedHandler } from "@facilis/core";

export default defineAuthorizedHandler(
  { permission: ["todos:read"], dbTables: ["todos"] },
  async () => null,
);
`;

const ROUTE_PATH = "server/routes/api/todos.get.ts";
const PING_PATH = "server/routes/api/ping.get.ts";
const SECRETS = `export const password = "hunter2";\nexport const label = "keep";\n`;
const LINES = Array(450).fill("line").join("\n");
const LONG_LINE = 'export const data = "' + "x".repeat(40_000) + '";\n';

const SOURCES: Record<string, string> = {
  "facilis.config.ts": CONFIG,
  "db/schema.ts": SCHEMA,
  [ROUTE_PATH]: ROUTE,
  "src/App.tsx": "export function App() {\n  return null;\n}\n",
  "src/lines.ts": LINES,
  "src/long.ts": LONG_LINE,
  "config/secrets.ts": SECRETS,
  ".env": "API_KEY=sk-live-123\n",
  "locales/en.json": JSON.stringify({ "app.title": "Facilis" }),
  "package.json": JSON.stringify({ dependencies: { "@facilis/core": "workspace:*" } }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "~/*": ["./*"] } } }),
};

function host(overrides: Partial<PatchValidationHost> = {}): PatchValidationHost {
  const base = {
    files: () => Object.keys(SOURCES),
    read: async (path: string) => SOURCES[path] ?? "",
    manifestBase: () => null,
    syntaxChecker: () => ({ check: async () => [] }),
    ...overrides,
  };
  return {
    ...base,
    analyze: overrides.analyze ?? ((patches) => analyzeHostFiles(base.files(), base.read, patches)),
  };
}

async function call<T>(
  name: string,
  args: unknown,
  overrides: Partial<PatchValidationHost> = {},
): Promise<T> {
  return (await createToolRouter(host(overrides)).execute({ name, args }, {})) as T;
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (isPtcToolError(error)) return error;
    throw error;
  }
  throw new Error("expected the tool call to be refused");
}

function patch(path: string, content: string): FilePatch {
  return { path, action: "create", content };
}

afterEach(() => vi.unstubAllGlobals());

describe("createToolRouter", () => {
  it("advertises the read-only tools and refuses unknown calls", async () => {
    const specs = createToolRouter(host()).specs();
    const names = specs.map((entry) => entry.name);
    expect(names).toHaveLength(9);
    expect(names).toContain("validate");
    for (const entry of specs) expect(entry.signature).toContain(entry.name);
    expect((await refusal(call("delete_everything", {}))).message).toContain("unknown tool");
    expect((await refusal(call("list_files", null))).message).toContain("JSON object");
  });
});

describe("list_files", () => {
  it("lists readable files with dir/glob filters and refuses traversal", async () => {
    const all = await call<{ files: string[] }>("list_files", {});
    expect(all.files).toEqual(expect.arrayContaining(["db/schema.ts", ROUTE_PATH]));
    expect(all.files).not.toContain(".env");
    expect(await call("list_files", { dir: "server/routes/" })).toEqual({
      files: [ROUTE_PATH],
      truncated: false,
    });
    expect(await call("list_files", { glob: "schema.ts" })).toEqual({
      files: ["db/schema.ts"],
      truncated: false,
    });
    expect((await refusal(call("list_files", { dir: "../../" }))).message).toContain(
      "project-relative",
    );
    expect((await refusal(call("list_files", { glob: "../**/*.ts" }))).message).toContain("glob");
  });
});

describe("read_file", () => {
  it("reads a 1-based window and caps at 400 lines / 32k characters", async () => {
    const window = await call<{ content: string }>("read_file", {
      path: "src/lines.ts",
      startLine: 401,
      endLine: 450,
    });
    expect(window.content.split("\n")).toHaveLength(50);
    expect(await call("read_file", { path: "src/lines.ts" })).toMatchObject({
      endLine: 400,
      totalLines: 450,
      truncated: true,
    });
    expect(
      (await call<{ content: string }>("read_file", { path: "src/long.ts" })).content,
    ).toHaveLength(32_000);
  });

  it("redacts secrets and refuses excluded or traversing paths", async () => {
    const content = (await call<{ content: string }>("read_file", { path: "config/secrets.ts" }))
      .content;
    expect(content).not.toContain("hunter2");
    expect(content).toContain("[redacted]");
    expect(content).toContain("keep");
    expect((await refusal(call("read_file", { path: ".env" }))).message).toContain("excluded");
    expect((await refusal(call("read_file", { path: "../outside.ts" }))).message).toContain(
      "project-relative",
    );
    expect((await refusal(call("read_file", {}))).message).toContain("path is required");
  });
});

describe("search", () => {
  it("searches case-insensitively, skips excluded files and honours globs and caps", async () => {
    const matches = await call<{ matches: { path: string; line: number; preview: string }[] }>(
      "search",
      { query: "PGTABLE" },
    );
    const schemaMatch = matches.matches.find((entry) => entry.path === "db/schema.ts");
    expect(schemaMatch?.line).toBe(1);
    expect(schemaMatch?.preview).toContain("pgTable");
    expect(await call("search", { query: "sk-live-123" })).toEqual({
      matches: [],
      truncated: false,
    });
    const routesOnly = await call<{ matches: { path: string }[] }>("search", {
      query: "defineAuthorizedHandler",
      glob: "server/**",
    });
    expect(new Set(routesOnly.matches.map((entry) => entry.path))).toEqual(new Set([ROUTE_PATH]));
    expect(await call("search", { query: "line", maxResults: 1 })).toMatchObject({
      matches: [expect.any(Object)],
      truncated: true,
    });
    expect((await refusal(call("search", { query: "ab" }))).message).toContain("at least 3");
  });
});

describe("fact tools", () => {
  it("reads analyzer table and route facts", async () => {
    const schema = await call<{ tables: { name: string; columns: { name: string }[] }[] }>(
      "get_schema",
      {},
    );
    expect(schema.tables.map((table) => table.name)).toEqual(["todos"]);
    expect(schema.tables[0]?.columns.map((column) => column.name)).toEqual(["id", "title"]);
    expect(await call("get_schema", { table: "ghosts" })).toEqual({ tables: [], truncated: false });
    const routes = await call<{ routes: { method: string; path: string; permission: string[] }[] }>(
      "get_routes",
      {},
    );
    expect(routes.routes).toEqual([
      expect.objectContaining({
        method: "GET",
        path: "/api/todos",
        permission: ["todos:read"],
        dbTables: ["todos"],
      }),
    ]);
    expect(await call("get_routes", { prefix: "/admin" })).toEqual({
      routes: [],
      truncated: false,
    });
  });

  it("reads config facts and summarises the project", async () => {
    const config = await call<{ permissions: string[]; roles: Record<string, string[]> }>(
      "get_config",
      {},
    );
    expect(config.permissions).toEqual(["todos:read", "todos:write"]);
    expect(config.roles["admin"]).toEqual(["*"]);
    const summary = await call<{ routes: number; names: { tables: string[]; routes: string[] } }>(
      "get_project_summary",
      {},
    );
    expect(summary.routes).toBe(1);
    expect(summary.names.tables).toEqual(["todos"]);
    expect(summary.names.routes).toEqual(["GET /api/todos"]);
  });
});

describe("get_manifest", () => {
  it("fails safe when nothing runs or the endpoint errors", async () => {
    expect(await call("get_manifest", {})).toEqual({ available: false });
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    const failed = await call<{ available: boolean }>(
      "get_manifest",
      {},
      {
        manifestBase: () => "http://preview.test",
      },
    );
    expect(failed.available).toBe(false);
  });

  it("returns the live envelope when the project answers", async () => {
    const envelope = {
      revision: "rev-1",
      generatedAt: "2026-11-07T00:00:00.000Z",
      sections: ["blocks"],
      manifest: { blocks: [{ name: "todo-list" }] },
      warnings: [],
    };
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(envelope), { status: 200 }));
    const live = await call<{
      available: boolean;
      revision: string;
      manifest: { blocks: { name: string }[] };
    }>("get_manifest", {}, { manifestBase: () => "http://preview.test" });
    expect(live.available).toBe(true);
    expect(live.revision).toBe("rev-1");
    expect(live.manifest.blocks[0]?.name).toBe("todo-list");
  });
});

describe("validate", () => {
  it("returns the same verdict the final gate would", async () => {
    const accepted = await call<{ ok: boolean; errors: unknown[] }>("validate", {
      patches: [patch(PING_PATH, ROUTE)],
    });
    expect(accepted).toMatchObject({ ok: true, errors: [], warnings: [] });
    const rejected = await call<{ ok: boolean; errors: { rule: string }[] }>("validate", {
      patches: [patch(PING_PATH, "export default async () => null;\n")],
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.errors.map((entry) => entry.rule)).toContain("route-security");
  });

  it("refuses malformed patch arguments", async () => {
    expect((await refusal(call("validate", { patches: [] }))).message).toContain("non-empty");
    const malformed = await refusal(
      call("validate", { patches: [{ path: "x.ts", action: "rename" }] }),
    );
    expect(malformed.message).toContain("action must be");
  });
});
