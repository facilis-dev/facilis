import { afterEach, describe, expect, it, vi } from "vitest";
import { createDevView, parseDevQueryData, runDevQuery } from "./dev-query-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const BASE = "/preview/5173/?__vv_kernel=tok";

const OK_BODY = {
  columns: [
    { name: "id", pgType: "uuid" },
    { name: "done", pgType: "bool" },
  ],
  rows: [
    ["019", false],
    ["020", true],
  ],
  rowCount: 2,
  elapsedMs: 7,
  truncated: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseDevQueryData", () => {
  it("narrows the response body and rejects malformed rows", () => {
    expect(parseDevQueryData(OK_BODY)).toEqual({
      columns: [
        { name: "id", pgType: "uuid" },
        { name: "done", pgType: "bool" },
      ],
      rows: [
        ["019", false],
        ["020", true],
      ],
      rowCount: 2,
      elapsedMs: 7,
      truncated: false,
    });
    expect(parseDevQueryData({ ...OK_BODY, rows: [["only-one-cell"]] })).toBeNull();
    expect(parseDevQueryData({ ...OK_BODY, rows: [[Symbol("not-json")]] })).toBeNull();
    expect(parseDevQueryData({ ...OK_BODY, columns: [{ name: 1 }] })).toBeNull();
    expect(parseDevQueryData(null)).toBeNull();
  });

  it("accepts nested json/jsonb values and returns them as JSON", () => {
    const body = {
      ...OK_BODY,
      columns: [{ name: "data", pgType: "jsonb" }],
      rows: [[{ a: [1, "x", { b: null }] }]],
      rowCount: 1,
    };
    const parsed = parseDevQueryData(body);
    expect(parsed?.rows[0]?.[0]).toEqual({ a: [1, "x", { b: null }] });
    expect(parseDevQueryData({ ...body, rows: [[{ a: [undefined] }]] })).toBeNull();
  });
});

describe("runDevQuery", () => {
  it("POSTs the SQL behind the kernel token and returns the rows", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(OK_BODY),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await runDevQuery(BASE, "select * from todos", { limit: 50 });
    expect(result).toEqual({ ok: true, data: OK_BODY });
    const call = fetchMock.mock.calls[0];
    if (call === undefined) throw new Error("fetch was not called");
    expect(call[0]).toBe("/preview/5173/__facilis/dev/query?__vv_kernel=tok");
    expect(call[1]).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(String(call[1]?.body))).toEqual({ sql: "select * from todos", limit: 50 });
  });

  it("surfaces a 400 code without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "invalid_sql", message: "syntax error" }, 400)),
    );
    const result = await runDevQuery(BASE, "nope");
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "HTTP 400",
      code: "invalid_sql",
      message: "syntax error",
    });
  });

  it("reports a network failure with status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );
    const result = await runDevQuery(BASE, "select 1");
    expect(result).toEqual({ ok: false, status: 0, error: "connection refused" });
  });

  it("rejects a 200 with an unexpected body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ hello: "world" })),
    );
    const result = await runDevQuery(BASE, "select 1");
    expect(result).toEqual({ ok: false, status: 200, error: "invalid query payload" });
  });
});

describe("createDevView", () => {
  it("POSTs the name and SQL and returns the created name", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ name: "active_todos" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await createDevView(BASE, "active_todos", "select 1");
    expect(result).toEqual({ ok: true, name: "active_todos" });
    const call = fetchMock.mock.calls[0];
    if (call === undefined) throw new Error("fetch was not called");
    expect(call[0]).toBe("/preview/5173/__facilis/dev/view?__vv_kernel=tok");
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      name: "active_todos",
      sql: "select 1",
    });
  });

  it("sends a chosen permission and omits it otherwise", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ name: "stats" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await createDevView(BASE, "stats", "select 1", { permission: "stats:read" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      name: "stats",
      sql: "select 1",
      permission: "stats:read",
    });
    await createDevView(BASE, "stats", "select 1", { permission: null });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      name: "stats",
      sql: "select 1",
    });
  });

  it("surfaces an undeclared permission", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "invalid_permission" }, 400)),
    );
    expect(await createDevView(BASE, "stats", "select 1", { permission: "nope:read" })).toEqual({
      ok: false,
      status: 400,
      error: "HTTP 400",
      code: "invalid_permission",
    });
  });

  it("surfaces invalid_name and network failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "invalid_name" }, 400)),
    );
    expect(await createDevView(BASE, "Active", "select 1")).toEqual({
      ok: false,
      status: 400,
      error: "HTTP 400",
      code: "invalid_name",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await createDevView(BASE, "active", "select 1")).toEqual({
      ok: false,
      status: 0,
      error: "offline",
    });
  });
});
