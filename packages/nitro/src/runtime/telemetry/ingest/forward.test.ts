import { afterEach, describe, expect, it, vi } from "vitest";

import { forwardToCollector } from "./forward.ts";

const ENDPOINT = "https://otel.acme.example:4318";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("forwardToCollector", () => {
  it("POSTs the payload to the collector's traces path as JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const payload = { resourceSpans: [] };
    const result = await forwardToCollector(ENDPOINT, payload);
    expect(result).toEqual({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENDPOINT + "/v1/traces");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify(payload));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a collector rejection without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    expect(await forwardToCollector(ENDPOINT, {})).toEqual({ ok: false, status: 503 });
  });

  it("contains a network failure or timeout as status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    expect(await forwardToCollector(ENDPOINT, {})).toEqual({ ok: false, status: 0 });
  });
});
