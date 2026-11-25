import { afterEach, describe, expect, it } from "vitest";
import { bootRum, captureRumError } from "./index.ts";

const GLOBAL = globalThis as Record<string, unknown>;
const KEY = "__FACILIS_RUM_CONFIG__";
const fetchCalls: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  delete GLOBAL["window"];
  delete GLOBAL[KEY];
  globalThis.fetch = originalFetch;
  fetchCalls.length = 0;
});

function stubFetch(): void {
  (globalThis as Record<string, unknown>).fetch = (url: string) => {
    fetchCalls.push(url);
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
}

describe("bootRum — silent unless enabled in a browser", () => {
  it("is a no-op without a window (SSR/prerender), even with a config", () => {
    stubFetch();
    GLOBAL[KEY] = {
      tenantKey: "pub_write_only_1",
      endpoint: "/__facilis/telemetry/v1/traces",
      sampling: 1,
      serviceName: "acme-shop",
      deploymentId: null,
    };
    expect(() => bootRum()).not.toThrow();
    expect(fetchCalls).toHaveLength(0);
    // No zone patching either: the disabled path never loads the SDK.
    expect(GLOBAL["Zone"]).toBeUndefined();
  });

  it("is a no-op with a window but no config (dev build defines null)", () => {
    stubFetch();
    GLOBAL["window"] = { location: { origin: "https://app.example" } };
    GLOBAL[KEY] = null;
    bootRum();
    delete GLOBAL[KEY];
    bootRum();
    expect(fetchCalls).toHaveLength(0);
    expect(GLOBAL["Zone"]).toBeUndefined();
  });

  it("is a no-op with an invalid config literal", () => {
    stubFetch();
    GLOBAL["window"] = { location: { origin: "https://app.example" } };
    GLOBAL[KEY] = {
      tenantKey: "has space",
      endpoint: "/x",
      sampling: 1,
      serviceName: "s",
      deploymentId: null,
    };
    bootRum();
    expect(fetchCalls).toHaveLength(0);
  });

  it("repeated calls stay safe and silent", () => {
    GLOBAL["window"] = { location: { origin: "https://app.example" } };
    bootRum();
    bootRum();
    expect(fetchCalls).toHaveLength(0);
  });

  it("captureRumError is a no-op before an enabled boot", () => {
    expect(() => captureRumError(new Error("x"), "window.onerror")).not.toThrow();
  });
});
