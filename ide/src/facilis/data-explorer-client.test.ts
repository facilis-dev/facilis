import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDataExplorer } from "./data-explorer-client";
import { parseRoutes, parseSchemaPayload } from "./data-explorer-parse";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SCHEMA_PAYLOAD = {
  code: {
    tables: [
      {
        name: "todos",
        rlsEnabled: true,
        scopeColumn: { name: "tenant_id", kind: "tenant" },
        columns: [
          { name: "id", type: "uuid", notNull: true, default: null, isPrimaryKey: true },
          {
            name: "title",
            type: "varchar(120)",
            notNull: true,
            default: null,
            isPrimaryKey: false,
          },
        ],
        policies: [
          {
            name: "tenant_isolation",
            command: "ALL",
            using: '"tenant_id" = x',
            withCheck: '"tenant_id" = x',
            sql: 'CREATE POLICY "tenant_isolation" ON "todos" AS RESTRICTIVE FOR ALL USING (x);',
          },
        ],
        foreignKeys: [],
      },
    ],
  },
  live: {
    tables: [
      {
        name: "todos",
        rlsEnabled: true,
        columns: [{ name: "id", type: "uuid", notNull: true, default: null, isPrimaryKey: true }],
        policies: [
          {
            name: "tenant_isolation",
            command: "ALL",
            restrictive: true,
            using: "(x)",
            withCheck: "(x)",
          },
        ],
      },
    ],
  },
  drift: [
    {
      kind: "column_type",
      table: "todos",
      column: "title",
      expected: "varchar(120)",
      actual: "text",
    },
    { kind: "not_a_kind", table: "todos" },
    { kind: "table_extra", table: "ghost" },
  ],
  warnings: [{ code: "config_invalid", message: "broken" }, { nope: true }],
};

const MANIFEST = {
  revision: "abc",
  generatedAt: "2026-11-02T00:00:00.000Z",
  sections: ["routes"],
  manifest: {
    routes: [
      {
        method: "GET",
        path: "/api/todos",
        dbTables: ["todos"],
        dbColumns: ["todos.title"],
        sourceFile: "server/routes/api/todos/index.get.ts",
      },
      { path: "/broken" },
    ],
  },
  warnings: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseSchemaPayload", () => {
  it("narrows the code, live, drift and warning halves", () => {
    const payload = parseSchemaPayload(SCHEMA_PAYLOAD);
    expect(payload).not.toBeNull();
    if (payload === null) return;
    expect(payload.codeTables).toHaveLength(1);
    expect(payload.codeTables[0]).toMatchObject({
      name: "todos",
      scoped: true,
      policies: [{ name: "tenant_isolation", restrictive: true }],
    });
    expect(payload.liveTables[0]?.columns[0]).toMatchObject({ name: "id", primaryKey: true });
    expect(payload.drift.map((entry) => entry.kind)).toEqual(["column_type", "table_extra"]);
    expect(payload.warnings).toEqual([{ code: "config_invalid", message: "broken" }]);
  });

  it("rejects a body that is not a schema payload", () => {
    expect(parseSchemaPayload({ hello: "world" })).toBeNull();
    expect(parseSchemaPayload(null)).toBeNull();
  });
});

describe("parseRoutes", () => {
  it("keeps complete route entries and skips malformed ones", () => {
    const routes = parseRoutes(MANIFEST.manifest.routes);
    expect(routes).toEqual([
      {
        method: "GET",
        path: "/api/todos",
        sourceFile: "server/routes/api/todos/index.get.ts",
        dbTables: ["todos"],
        dbColumns: ["todos.title"],
      },
    ]);
    expect(parseRoutes(undefined)).toEqual([]);
  });
});

describe("fetchDataExplorer", () => {
  it("fetches the schema through the preview base and joins the manifest routes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.endsWith("/__facilis/dev/schema")
        ? jsonResponse(SCHEMA_PAYLOAD)
        : jsonResponse(MANIFEST);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDataExplorer("http://127.0.0.1:5199/preview/3000/");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:5199/preview/3000/__facilis/dev/schema",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://127.0.0.1:5199/preview/3000/__facilis/manifest?sections=routes",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.drift).toHaveLength(2);
    expect(result.data.routes).toHaveLength(1);
  });

  it("reports db_unavailable from a 503 instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "db_unavailable" }, 503)),
    );
    const result = await fetchDataExplorer("http://host/preview/3000");
    expect(result).toEqual({
      ok: false,
      status: 503,
      error: "HTTP 503",
      code: "db_unavailable",
    });
  });

  it("reports a network failure with status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );
    const result = await fetchDataExplorer("");
    expect(result).toEqual({ ok: false, status: 0, error: "connection refused" });
  });

  it("rejects a 200 with an unexpected body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ hello: "world" })),
    );
    const result = await fetchDataExplorer("http://host/preview/3000");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid schema payload");
  });

  it("still returns the schema when the manifest route fetch fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/__facilis/dev/schema")
        ? jsonResponse(SCHEMA_PAYLOAD)
        : jsonResponse({ code: "not_found" }, 404),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchDataExplorer("http://host/preview/3000");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.routes).toEqual([]);
  });
});
