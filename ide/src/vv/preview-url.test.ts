import { describe, expect, it } from "vitest";
import { parsePreviewAddress, previewSrcFor, previewPathSuffix } from "./preview-url";

describe("parsePreviewAddress", () => {
  it("takes a bare port and keeps the root path", () => {
    expect(parsePreviewAddress(5173, "3000")).toEqual({
      address: { url: "localhost:3000", port: 3000, path: "/" },
    });
  });

  it("keeps the tab's port for a bare path", () => {
    expect(parsePreviewAddress(5173, "/api/health")).toEqual({
      address: { url: "localhost:5173/api/health", port: 5173, path: "/api/health" },
    });
  });

  it("parses localhost:port with a path, stripping any scheme", () => {
    const parsed = parsePreviewAddress(null, "http://localhost:8080/todos");
    expect(parsed).toEqual({
      address: { url: "localhost:8080/todos", port: 8080, path: "/todos" },
    });
  });

  it("refuses a non-local host", () => {
    expect(parsePreviewAddress(3000, "example.com")).toEqual({
      error: "Only local URLs are supported for now",
    });
  });

  it("refuses an empty or portless entry", () => {
    expect(parsePreviewAddress(null, "   ")).toHaveProperty("error");
    expect(parsePreviewAddress(null, "/todos")).toHaveProperty("error");
  });
});

describe("previewSrcFor", () => {
  const bridge = {
    previewUrlFor: (port: number, path: string) => `/preview/${port}${path}`,
  } as unknown as Parameters<typeof previewSrcFor>[0];

  it("is about:blank for an unbound tab", () => {
    expect(previewSrcFor(bridge, { port: null, path: "/", nonce: 1 })).toBe("about:blank");
  });

  it("adds the cache-bust only after the first load", () => {
    expect(previewSrcFor(bridge, { port: 80, path: "/", nonce: 1 })).toBe("/preview/80/");
    expect(previewSrcFor(bridge, { port: 80, path: "/a?x=1", nonce: 2 })).toBe(
      "/preview/80/a?x=1&t=2",
    );
  });
});

describe("previewPathSuffix", () => {
  it("strips the proxy prefix, cache-bust and kernel token", () => {
    expect(previewPathSuffix("/preview/80/todos?t=2&__vv_kernel=abc")).toBe("/todos");
  });
});
