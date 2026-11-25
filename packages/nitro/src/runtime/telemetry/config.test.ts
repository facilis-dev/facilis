import { describe, expect, it } from "vitest";

import {
  DEFAULT_SERVICE_NAME,
  DEFAULT_SPANS_PER_MINUTE,
  DEPLOYMENT_ID_ENV,
  readTelemetryConfig,
  TELEMETRY_ENDPOINT_ENV,
  TELEMETRY_ENV,
  TELEMETRY_ORIGINS_ENV,
  TELEMETRY_SAMPLING_ENV,
  TELEMETRY_SERVICE_ENV,
  TELEMETRY_SPANS_PER_MIN_ENV,
  TELEMETRY_TENANT_KEY_ENV,
} from "./config.ts";

const COLLECTOR = "http://collector.internal:4318";

describe("readTelemetryConfig", () => {
  it("is off by default", () => {
    expect(readTelemetryConfig({ NODE_ENV: "production" })).toEqual({
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

  it('turns on only for an explicit "on" in production', () => {
    expect(readTelemetryConfig({ NODE_ENV: "production", [TELEMETRY_ENV]: "on" }).enabled).toBe(
      true,
    );
    expect(readTelemetryConfig({ NODE_ENV: "production", [TELEMETRY_ENV]: "1" }).enabled).toBe(
      false,
    );
    expect(readTelemetryConfig({ NODE_ENV: "production", [TELEMETRY_ENV]: "on " }).enabled).toBe(
      true,
    );
  });

  it("stays off in dev and test even when the flag leaked into the process", () => {
    // D-200: inside the WebContainer/preview no telemetry leaves the machine.
    for (const nodeEnv of ["development", "test"]) {
      expect(readTelemetryConfig({ NODE_ENV: nodeEnv, [TELEMETRY_ENV]: "on" }).enabled).toBe(false);
    }
    // Fail-closed (D-146): an unset NODE_ENV counts as production, not as dev.
    expect(readTelemetryConfig({ [TELEMETRY_ENV]: "on" }).enabled).toBe(true);
  });
});

describe("telemetry export target", () => {
  it("reads the collector base URL and drops a trailing slash", () => {
    const config = readTelemetryConfig({ [TELEMETRY_ENDPOINT_ENV]: COLLECTOR + "/" });
    expect(config.endpoint).toBe(COLLECTOR);
  });

  it("keeps a path prefix so a collector can sit behind a gateway", () => {
    const config = readTelemetryConfig({ [TELEMETRY_ENDPOINT_ENV]: "https://gw.example/otel//" });
    expect(config.endpoint).toBe("https://gw.example/otel");
  });

  it("rejects a target the exporter could not use", () => {
    for (const value of [
      "",
      "   ",
      "collector.internal:4318",
      "ftp://collector.internal",
      "https://collector.internal/?tenant=acme",
      "https://collector.internal/#fragment",
    ]) {
      expect(readTelemetryConfig({ [TELEMETRY_ENDPOINT_ENV]: value }).endpoint).toBeNull();
    }
  });

  it("keeps everything unless a valid ratio is given", () => {
    expect(readTelemetryConfig({ [TELEMETRY_SAMPLING_ENV]: "0.25" }).sampling).toBe(0.25);
    expect(readTelemetryConfig({ [TELEMETRY_SAMPLING_ENV]: "0" }).sampling).toBe(0);
    for (const value of ["", "  ", "-1", "1.5", "half", "NaN"]) {
      expect(readTelemetryConfig({ [TELEMETRY_SAMPLING_ENV]: value }).sampling).toBe(1);
    }
  });

  it("reads the service name and the optional deployment id", () => {
    const config = readTelemetryConfig({
      [TELEMETRY_SERVICE_ENV]: " acme-shop ",
      [DEPLOYMENT_ID_ENV]: "dep-42",
    });
    expect(config.serviceName).toBe("acme-shop");
    expect(config.deploymentId).toBe("dep-42");
    expect(readTelemetryConfig({ [TELEMETRY_SERVICE_ENV]: "  " }).serviceName).toBe(
      DEFAULT_SERVICE_NAME,
    );
    expect(readTelemetryConfig({ [DEPLOYMENT_ID_ENV]: " " }).deploymentId).toBeNull();
  });
});

describe("ingestion settings (spec §8.8)", () => {
  it("reduces allowlist entries to exact origins and drops the rest", () => {
    const config = readTelemetryConfig({
      [TELEMETRY_ORIGINS_ENV]:
        "https://app.acme.example/, http://localhost:5173/path, https://app.acme.example, *, null, ftp://x.example, not a url",
    });
    expect(config.allowedOrigins).toEqual(["https://app.acme.example", "http://localhost:5173"]);
  });

  it("keeps the allowlist empty when unset (own-origin fallback lives in the route)", () => {
    expect(readTelemetryConfig({}).allowedOrigins).toEqual([]);
    expect(readTelemetryConfig({ [TELEMETRY_ORIGINS_ENV]: " , " }).allowedOrigins).toEqual([]);
  });

  it("reads the public tenant key and treats a blank or whitespace key as unset", () => {
    expect(
      readTelemetryConfig({ [TELEMETRY_TENANT_KEY_ENV]: "pub_write_only_1" }).tenantKey,
    ).toBe("pub_write_only_1");
    for (const value of ["", "   ", "has space", "tab\tkey"]) {
      expect(readTelemetryConfig({ [TELEMETRY_TENANT_KEY_ENV]: value }).tenantKey).toBeNull();
    }
  });

  it("falls back to the default span/min cap on anything unparsable or non-positive", () => {
    expect(readTelemetryConfig({ [TELEMETRY_SPANS_PER_MIN_ENV]: "120" }).spansPerMinute).toBe(120);
    for (const value of ["", "  ", "0", "-5", "many", "NaN", "Infinity"]) {
      expect(readTelemetryConfig({ [TELEMETRY_SPANS_PER_MIN_ENV]: value }).spansPerMinute).toBe(
        DEFAULT_SPANS_PER_MINUTE,
      );
    }
  });
});
