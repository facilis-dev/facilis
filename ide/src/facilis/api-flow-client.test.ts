import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchApiFlow } from "./api-flow-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const DOCUMENT = {
  openapi: "3.1.0",
  paths: {
    "/api/todos": {
      get: { "x-db-tables": ["todos"], "x-facilis-source": "server/routes/api/todos/index.get.ts" },
    },
  },
  "x-facilis-warning": [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchApiFlow", () => {
  it("fetches /_openapi.json through the preview-proxy base", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(DOCUMENT));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchApiFlow("http://127.0.0.1:5199/preview/3000/");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:5199/preview/3000/_openapi.json");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.operations).toHaveLength(1);
    expect(result.data.operations[0]).toMatchObject({
      method: "GET",
      path: "/api/todos",
      dbTables: ["todos"],
    });
  });

  it("drops the preview URL query and hash before appending the path", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(DOCUMENT));
    vi.stubGlobal("fetch", fetchMock);
    await fetchApiFlow("http://host/preview/3000/?t=2&kernel=abc");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://host/preview/3000/_openapi.json");
  });

  it("fetches the bare path when the preview base is empty", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(DOCUMENT));
    vi.stubGlobal("fetch", fetchMock);
    await fetchApiFlow("");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/_openapi.json");
  });

  it("reports an HTTP failure instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "not_found" }, 404)),
    );
    const result = await fetchApiFlow("http://host/preview/3000");
    expect(result).toEqual({ ok: false, status: 404, error: "HTTP 404" });
  });

  it("reports a network failure with status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );
    const result = await fetchApiFlow("http://host/preview/3000");
    expect(result).toEqual({ ok: false, status: 0, error: "connection refused" });
  });

  it("rejects a 200 with a body that is not an OpenAPI document", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ hello: "world" })),
    );
    const result = await fetchApiFlow("http://host/preview/3000");
    expect(result).toEqual({ ok: false, status: 200, error: "invalid OpenAPI document" });
  });
});
