import { describe, expect, it, vi } from "vitest";
import { PtcToolError } from "./ptc/protocol";
import { createWebAccess, type WebPorts } from "./web-access";
import type { WebPolicy } from "@/deploy/web-policy";

const PAGE = "https://studio.acme.example";
const OPEN: WebPolicy = { kind: "open" };
const HOSTS: WebPolicy = { kind: "hosts", origins: ["https://api.example"] };

function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/plain" }, ...init });
}

/** A Response whose final URL is set, the way a redirecting fetch reports its landing URL. */
function landed(response: Response, url: string): Response {
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function makePorts(overrides: Partial<WebPorts> = {}): Required<WebPorts> & {
  fetchApi: ReturnType<typeof vi.fn>;
} {
  const ports = {
    policy: OPEN,
    pageOrigin: PAGE,
    fetchApi: vi.fn(async () => textResponse("hello")),
    writeAsset: vi.fn(async () => undefined),
    ...overrides,
  };
  return ports as Required<WebPorts> & { fetchApi: ReturnType<typeof vi.fn> };
}

describe("createWebAccess.read", () => {
  it("applies the policy before any request", async () => {
    const ports = makePorts({ policy: HOSTS });
    const web = createWebAccess(ports);
    await expect(web.read("https://evil.example/", 1_000)).rejects.toBeInstanceOf(PtcToolError);
    await expect(web.read("https://evil.example/", 1_000)).rejects.toMatchObject({
      kind: "capability",
    });
    expect(ports.fetchApi).not.toHaveBeenCalled();
  });

  it("omits credentials and never sends headers or a body", async () => {
    const ports = makePorts();
    const web = createWebAccess(ports);
    await web.read("https://api.example/page", 1_000);
    expect(ports.fetchApi).toHaveBeenCalledTimes(1);
    expect(ports.fetchApi.mock.calls[0]?.[0]).toBe("https://api.example/page");
    const init = ports.fetchApi.mock.calls[0]?.[1];
    expect(init).toEqual({ credentials: "omit", redirect: "follow" });
  });

  it("returns the status, content type and bytes", async () => {
    const ports = makePorts({
      fetchApi: vi.fn(async () =>
        landed(
          textResponse("hello", { status: 201, headers: { "content-type": "text/html" } }),
          "https://api.example/hello",
        ),
      ),
    });
    const web = createWebAccess(ports);
    const result = await web.read("https://api.example/hello", 1_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(201);
    expect(result.contentType).toBe("text/html");
    expect(new TextDecoder().decode(result.bytes)).toBe("hello");
  });

  it("refuses a redirect that lands on a host the deployment never allowed", async () => {
    const ports = makePorts({
      policy: HOSTS,
      fetchApi: vi.fn(async () => landed(textResponse("secret"), "https://evil.example/taken")),
    });
    const web = createWebAccess(ports);
    await expect(web.read("https://api.example/", 1_000)).rejects.toMatchObject({
      kind: "capability",
    });
  });

  it("allows a redirect that stays on an allowed origin", async () => {
    const ports = makePorts({
      policy: HOSTS,
      fetchApi: vi.fn(async () => landed(textResponse("ok"), "https://api.example/v2")),
    });
    const web = createWebAccess(ports);
    const result = await web.read("https://api.example/", 1_000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("https://api.example/v2");
  });

  it("refuses a body that passes the read cap while streaming", async () => {
    const ports = makePorts({
      fetchApi: vi.fn(async () => textResponse("x".repeat(64))),
    });
    const web = createWebAccess(ports);
    const result = await web.read("https://api.example/", 10);
    expect(result).toMatchObject({ ok: false, reason: "capability" });
    // The bytes already streamed are reported so the program's budget can be charged for them.
    if (!result.ok) expect(result.bytesRead).toBeGreaterThan(10);
  });

  it("accepts a body exactly at the read cap", async () => {
    const ports = makePorts({ fetchApi: vi.fn(async () => textResponse("0123456789")) });
    const web = createWebAccess(ports);
    const result = await web.read("https://api.example/", 10);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bytes.byteLength).toBe(10);
  });

  it("reports a thrown fetch (CORS, DNS) as a network failure", async () => {
    const ports = makePorts({
      fetchApi: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    const web = createWebAccess(ports);
    const result = await web.read("https://api.example/", 1_000);
    expect(result).toMatchObject({ ok: false, reason: "network", bytesRead: 0 });
    if (!result.ok) expect(result.detail).toContain("Failed to fetch");
  });

  it("returns the deployment policy it was built with", () => {
    expect(createWebAccess(makePorts({ policy: HOSTS })).policy).toEqual(HOSTS);
  });
});

describe("createWebAccess.writeAsset", () => {
  it("delegates to the project writer with the path unchanged", async () => {
    const ports = makePorts();
    const web = createWebAccess(ports);
    const bytes = new Uint8Array([1, 2, 3]);
    await web.writeAsset("public/logo.png", bytes);
    expect(ports.writeAsset).toHaveBeenCalledWith("public/logo.png", bytes);
  });
});

describe("createWebAccess images", () => {
  it("keeps at most two images per program and drains them", () => {
    const web = createWebAccess(makePorts());
    expect(web.addImage("data:image/png;base64,AA")).toBe(true);
    expect(web.addImage("data:image/png;base64,BB")).toBe(true);
    expect(web.addImage("data:image/png;base64,CC")).toBe(false);
    expect(web.takeImages()).toEqual(["data:image/png;base64,AA", "data:image/png;base64,BB"]);
    expect(web.takeImages()).toEqual([]);
  });
});
