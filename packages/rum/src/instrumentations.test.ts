import { describe, expect, it } from "vitest";
import type { RumConfig } from "./config.ts";
import { buildInstrumentations } from "./instrumentations.ts";

const CONFIG: RumConfig = {
  tenantKey: "pub_write_only_1",
  endpoint: "/__facilis/telemetry/v1/traces",
  sampling: 1,
  serviceName: "acme-shop",
  deploymentId: null,
};
const ORIGIN = "https://app.example";

function propagationRegexes(configs: ReturnType<typeof buildInstrumentations>): RegExp[] {
  const urls = configs.fetch.propagateTraceHeaderCorsUrls;
  if (!Array.isArray(urls)) throw new Error("expected an array of URL patterns");
  return urls.filter((url): url is RegExp => url instanceof RegExp);
}

describe("buildInstrumentations — own-origin restriction", () => {
  it("propagates traceparent to the app's own origin only", () => {
    const configs = buildInstrumentations(CONFIG, ORIGIN);
    for (const regex of propagationRegexes(configs)) {
      expect(regex.test(ORIGIN + "/api/items")).toBe(true);
      expect(regex.test("https://evil.example/api")).toBe(false);
      // The escaped dot and the anchor: a lookalike origin must not match.
      expect(regex.test("https://app.example.evil.com/api")).toBe(false);
      expect(regex.test("https://appXexample/api")).toBe(false);
    }
  });

  it("applies the same restriction to XHR", () => {
    const configs = buildInstrumentations(CONFIG, ORIGIN);
    const urls = configs.xhr.propagateTraceHeaderCorsUrls;
    if (!Array.isArray(urls)) throw new Error("expected an array of URL patterns");
    const regex = urls[0];
    if (!(regex instanceof RegExp)) throw new Error("expected a RegExp");
    expect(regex.test(ORIGIN + "/api/items")).toBe(true);
    expect(regex.test("https://third-party.example/api")).toBe(false);
  });

  it("handles an origin with a port (localhost dev-preview shape)", () => {
    const configs = buildInstrumentations(CONFIG, "http://localhost:5173");
    for (const regex of propagationRegexes(configs)) {
      expect(regex.test("http://localhost:5173/api/items")).toBe(true);
      expect(regex.test("http://localhost:5174/api/items")).toBe(false);
    }
  });
});

describe("buildInstrumentations — export endpoint ignored", () => {
  it("ignores the ingestion path and its absolute form, but not the API", () => {
    const configs = buildInstrumentations(CONFIG, ORIGIN);
    const ignoreUrls = configs.fetch.ignoreUrls ?? [];
    const exportUrl = ORIGIN + CONFIG.endpoint;
    expect(ignoreUrls.some((pattern) => pattern instanceof RegExp && pattern.test(exportUrl))).toBe(
      true,
    );
    expect(
      ignoreUrls.some((pattern) => pattern instanceof RegExp && pattern.test(CONFIG.endpoint)),
    ).toBe(true);
    for (const pattern of ignoreUrls) {
      if (pattern instanceof RegExp) {
        expect(pattern.test(ORIGIN + "/api/items")).toBe(false);
      }
    }
  });

  it("ignores the export endpoint for XHR too", () => {
    const configs = buildInstrumentations(CONFIG, ORIGIN);
    const ignoreUrls = configs.xhr.ignoreUrls ?? [];
    expect(
      ignoreUrls.some(
        (pattern) => pattern instanceof RegExp && pattern.test(ORIGIN + CONFIG.endpoint),
      ),
    ).toBe(true);
  });

  it("ships a document-load config alongside fetch and xhr", () => {
    const configs = buildInstrumentations(CONFIG, ORIGIN);
    expect(configs.documentLoad).toEqual({});
  });
});
