import { SecretString, type FacilisRuntimeConfig } from "@facilis.dev/core";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SERVICE_NAME,
  DEFAULT_SPANS_PER_MINUTE,
  readTelemetryConfig,
} from "./config.ts";

const COLLECTOR = "http://collector.internal:4318";
const PRODUCTION = { NODE_ENV: "production" };

describe("readTelemetryConfig", () => {
  it("is off by default", () => {
    expect(readTelemetryConfig({}, PRODUCTION)).toEqual({
      enabled: false,
      endpoint: null,
      sampling: 1,
      serviceName: DEFAULT_SERVICE_NAME,
      deploymentId: null,
      allowedOrigins: [],
      tenantKey: null,
      spansPerMinute: DEFAULT_SPANS_PER_MINUTE,
    });
  });

  it("turns on only for an explicit boolean in production", () => {
    expect(
      readTelemetryConfig({ telemetryEnabled: true }, PRODUCTION).enabled,
    ).toBe(true);
    expect(
      readTelemetryConfig({ telemetryEnabled: "true" }, PRODUCTION).enabled,
    ).toBe(false);
  });

  it("stays off in dev and test even when the flag leaked into the process", () => {
    // D-200: inside the WebContainer/preview no telemetry leaves the machine.
    for (const nodeEnv of ["development", "test"]) {
      expect(
        readTelemetryConfig({ telemetryEnabled: true }, { NODE_ENV: nodeEnv }).enabled,
      ).toBe(false);
    }
    // Fail-closed (D-146): an unset NODE_ENV counts as production, not as dev.
    expect(readTelemetryConfig({ telemetryEnabled: true }, {}).enabled).toBe(true);
  });
});

describe("telemetry export target", () => {
  it("reads the collector base URL and drops a trailing slash", () => {
    expect(readTelemetryConfig({ telemetryEndpoint: COLLECTOR + "/" }).endpoint).toBe(COLLECTOR);
  });

  it("keeps a path prefix so a collector can sit behind a gateway", () => {
    expect(
      readTelemetryConfig({ telemetryEndpoint: "https://gw.example/otel//" }).endpoint,
    ).toBe("https://gw.example/otel");
  });

  it("rejects a target the exporter could not use", () => {
    for (const value of [
      null,
      "",
      "   ",
      "collector.internal:4318",
      "ftp://collector.internal",
      "https://collector.internal/?tenant=acme",
      "https://collector.internal/#fragment",
    ]) {
      expect(readTelemetryConfig({ telemetryEndpoint: value }).endpoint).toBeNull();
    }
  });

  it("keeps everything unless a valid ratio is given", () => {
    expect(readTelemetryConfig({ telemetrySampling: 0.25 }).sampling).toBe(0.25);
    expect(readTelemetryConfig({ telemetrySampling: 0 }).sampling).toBe(0);
    for (const value of [undefined, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "half"]) {
      expect(readTelemetryConfig({ telemetrySampling: value }).sampling).toBe(1);
    }
  });

  it("reads the service name and the optional deployment id", () => {
    const config = readTelemetryConfig({
      telemetryService: " acme-shop ",
      deploymentId: "dep-42",
    });
    expect(config.serviceName).toBe("acme-shop");
    expect(config.deploymentId).toBe("dep-42");
    expect(readTelemetryConfig({ telemetryService: "  " }).serviceName).toBe(DEFAULT_SERVICE_NAME);
    expect(readTelemetryConfig({ deploymentId: " " }).deploymentId).toBeNull();
  });
});

describe("ingestion settings (spec §8.8)", () => {
  it("reduces allowlist entries to exact origins and drops the rest", () => {
    const config = readTelemetryConfig({
      telemetryOrigins: [
        "https://app.acme.example/",
        "http://localhost:5173/path",
        "https://app.acme.example",
        "*",
        "null",
        "ftp://x.example",
        "not a url",
      ],
    });
    expect(config.allowedOrigins).toEqual(["https://app.acme.example", "http://localhost:5173"]);
  });

  it("keeps the allowlist empty when unset (own-origin fallback lives in the route)", () => {
    expect(readTelemetryConfig({}).allowedOrigins).toEqual([]);
    expect(readTelemetryConfig({ telemetryOrigins: [] }).allowedOrigins).toEqual([]);
  });

  it("reads the public tenant key and treats a blank or whitespace key as unset", () => {
    expect(
      readTelemetryConfig({ telemetryTenantKey: new SecretString("pub_write_only_1") }).tenantKey,
    ).toBe("pub_write_only_1");
    for (const value of ["", "   ", "has space", "tab\tkey"]) {
      expect(readTelemetryConfig({ telemetryTenantKey: value }).tenantKey).toBeNull();
    }
  });

  it("falls back to the default span/min cap on anything unparsable or non-positive", () => {
    expect(readTelemetryConfig({ telemetrySpansPerMin: 120 }).spansPerMinute).toBe(120);
    for (const value of [undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY, "many"]) {
      expect(readTelemetryConfig({ telemetrySpansPerMin: value }).spansPerMinute).toBe(
        DEFAULT_SPANS_PER_MINUTE,
      );
    }
  });
});

describe("runtime config typing", () => {
  it("accepts a full declared shape", () => {
    const runtime: FacilisRuntimeConfig = {
      telemetryEnabled: false,
      telemetryEndpoint: null,
      telemetryOrigins: [],
      telemetrySampling: 1,
      telemetryService: "facilis-app",
      telemetrySpansPerMin: 24,
      telemetryTenantKey: new SecretString("key"),
    };
    expect(readTelemetryConfig(runtime).serviceName).toBe("facilis-app");
  });
});
