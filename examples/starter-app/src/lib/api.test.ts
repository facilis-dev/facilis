import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, appBasePath, errorMessageKey } from "./api.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("appBasePath", () => {
  it("keeps the IDE preview prefix and nothing after it", () => {
    expect(appBasePath("/preview/3000")).toBe("/preview/3000");
    expect(appBasePath("/preview/3000/login")).toBe("/preview/3000");
  });

  it("is empty for a standalone deploy", () => {
    expect(appBasePath("/")).toBe("");
    expect(appBasePath("/login")).toBe("");
  });

  it("only understands the exact preview segment", () => {
    expect(appBasePath("/previews/3000")).toBe("");
  });
});

describe("api", () => {
  it("returns the parsed JSON body from a same-origin GET", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ authenticated: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api<{ authenticated: boolean }>("/api/auth/session")).resolves.toEqual({
      authenticated: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/session",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("sends a JSON content type when a body is present", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "user@example.com" }),
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("accept")).toBe("application/json");
  });

  it("does not set a content type when there is no body", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api("/api/auth/logout", { method: "POST" });

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.has("content-type")).toBe(false);
  });

  it("resolves undefined for an empty 204 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    await expect(api("/api/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it("throws ApiError carrying the server code, status and details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "not_found", details: { id: "1" } }, 404)),
    );

    const thrown: unknown = await api("/api/missing").catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).toMatchObject({ code: "not_found", status: 404, details: { id: "1" } });
  });

  it("maps transport failures to network_error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const thrown: unknown = await api("/api/auth/session").catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).toMatchObject({ code: "network_error", status: 0 });
  });

  it("falls back to internal_error when the error body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 })),
    );

    const thrown: unknown = await api("/api/auth/session").catch((error: unknown) => error);

    expect(thrown).toMatchObject({ code: "internal_error", status: 502 });
  });
});

describe("errorMessageKey", () => {
  it("maps a known code to its catalogue key", () => {
    expect(errorMessageKey(new ApiError("conflict", 409))).toBe("errors.conflict");
    expect(errorMessageKey(new ApiError("network_error", 0))).toBe("errors.network_error");
  });

  it("collapses unknown codes and non-API errors to internal_error", () => {
    expect(errorMessageKey(new ApiError("teapot", 418))).toBe("errors.internal_error");
    expect(errorMessageKey(new Error("boom"))).toBe("errors.internal_error");
    expect(errorMessageKey(undefined)).toBe("errors.internal_error");
  });
});
