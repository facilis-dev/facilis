import { describe, expect, it, vi } from "vitest";
import {
  fetchManifest,
  fetchRevision,
  manifestBaseUrl,
  parseEnvelope,
  parseRevision,
} from "./manifest-client";

function jsonResponse(body: unknown, init: { status?: number; etag?: string } = {}): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.etag) headers.set("etag", init.etag);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

const ENVELOPE = {
  revision: "df32e068dce9b707154a097016a00885ffdebc8b",
  generatedAt: "2026-10-27T00:00:00.000Z",
  sections: ["config", "routes"],
  manifest: { config: { name: "facilis-ts-app" } },
  warnings: [{ message: "schema failed", code: "schema_error", section: "schema" }, { nope: true }],
};

describe("manifestBaseUrl", () => {
  it("strips trailing slashes from a preview proxy base", () => {
    expect(manifestBaseUrl("http://127.0.0.1:5199/preview/3000/")).toBe(
      "http://127.0.0.1:5199/preview/3000",
    );
  });

  it("keeps an empty base empty so endpoints stay root-relative", () => {
    expect(manifestBaseUrl("   ")).toBe("");
  });

  it("drops the preview URL's query (kernel token, cache-bust) and hash", () => {
    expect(manifestBaseUrl("http://127.0.0.1:5199/preview/3000/?__vv_kernel=abc123")).toBe(
      "http://127.0.0.1:5199/preview/3000",
    );
    expect(manifestBaseUrl("http://127.0.0.1:5199/preview/3000/?t=1793435422669#/x")).toBe(
      "http://127.0.0.1:5199/preview/3000",
    );
  });
});

describe("parseEnvelope", () => {
  it("keeps the envelope and drops malformed warnings", () => {
    const envelope = parseEnvelope(ENVELOPE);
    expect(envelope?.revision).toBe(ENVELOPE.revision);
    expect(envelope?.warnings).toEqual([
      { message: "schema failed", code: "schema_error", section: "schema" },
    ]);
  });

  it("accepts a partial manifest with no sections", () => {
    const envelope = parseEnvelope({
      revision: "abc",
      generatedAt: "x",
      sections: [],
      manifest: {},
      warnings: [],
    });
    expect(envelope?.manifest).toEqual({});
  });

  it("rejects a body without a revision", () => {
    expect(
      parseEnvelope({ generatedAt: "x", sections: [], manifest: {}, warnings: [] }),
    ).toBeNull();
    expect(parseEnvelope(null)).toBeNull();
  });
});

describe("parseRevision", () => {
  it("requires a non-empty revision", () => {
    expect(parseRevision({ revision: "abc", generatedAt: "x" })?.revision).toBe("abc");
    expect(parseRevision({ revision: "", generatedAt: "x" })).toBeNull();
  });
});

describe("fetchManifest", () => {
  it("requests the proxy-prefixed endpoint and parses the envelope", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse(ENVELOPE, { etag: 'W/"abc"' }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchManifest("http://127.0.0.1:5199/preview/3000/", {
      sections: ["routes", "schema"],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:5199/preview/3000/__facilis/manifest?sections=routes%2Cschema",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.revision).toBe(ENVELOPE.revision);
    expect(result.etag).toBe('W/"abc"');
    vi.unstubAllGlobals();
  });

  it("passes the summary format through", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(ENVELOPE));
    vi.stubGlobal("fetch", fetchMock);
    await fetchManifest("http://host/preview/3000", { format: "summary" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://host/preview/3000/__facilis/manifest?format=summary",
    );
    vi.unstubAllGlobals();
  });

  it("reports a 404 as unreachable rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL) =>
        jsonResponse({ error: "not found" }, { status: 404 }),
      ),
    );
    const result = await fetchManifest("http://host/preview/3000");
    expect(result).toEqual({ ok: false, status: 404, error: "HTTP 404" });
    vi.unstubAllGlobals();
  });

  it("reports a network failure with status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL) => {
        throw new Error("connection refused");
      }),
    );
    const result = await fetchManifest("");
    expect(result).toEqual({ ok: false, status: 0, error: "connection refused" });
    vi.unstubAllGlobals();
  });

  it("rejects a 200 with an unexpected body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL) => jsonResponse({ hello: "world" })),
    );
    const result = await fetchManifest("http://host/preview/3000");
    expect(result).toEqual({ ok: false, status: 200, error: "invalid manifest envelope" });
    vi.unstubAllGlobals();
  });
});

describe("fetchRevision", () => {
  it("polls the revision endpoint", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({ revision: "abc", generatedAt: "x" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchRevision("http://host/preview/3000/");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://host/preview/3000/__facilis/manifest/revision",
    );
    expect(result).toEqual({ ok: true, revision: "abc", generatedAt: "x" });
    vi.unstubAllGlobals();
  });

  it("rejects a body without a revision", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL) => jsonResponse({ generatedAt: "x" })),
    );
    const result = await fetchRevision("http://host/preview/3000");
    expect(result).toEqual({ ok: false, status: 200, error: "invalid revision body" });
    vi.unstubAllGlobals();
  });
});
