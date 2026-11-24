import { describe, expect, it } from "vitest";

import { readTelemetryConfig, TELEMETRY_ENV } from "./config.ts";

describe("readTelemetryConfig", () => {
  it("is off by default", () => {
    expect(readTelemetryConfig({ NODE_ENV: "production" })).toEqual({ enabled: false });
  });

  it('turns on only for an explicit "on" in production', () => {
    expect(readTelemetryConfig({ NODE_ENV: "production", [TELEMETRY_ENV]: "on" })).toEqual({
      enabled: true,
    });
    expect(readTelemetryConfig({ NODE_ENV: "production", [TELEMETRY_ENV]: "1" })).toEqual({
      enabled: false,
    });
    expect(readTelemetryConfig({ NODE_ENV: "production", [TELEMETRY_ENV]: "on " })).toEqual({
      enabled: true,
    });
  });

  it("stays off in dev and test even when the flag leaked into the process", () => {
    // D-200: inside the WebContainer/preview no telemetry leaves the machine.
    for (const nodeEnv of ["development", "test"]) {
      expect(readTelemetryConfig({ NODE_ENV: nodeEnv, [TELEMETRY_ENV]: "on" })).toEqual({
        enabled: false,
      });
    }
    // Fail-closed (D-146): an unset NODE_ENV counts as production, not as dev.
    expect(readTelemetryConfig({ [TELEMETRY_ENV]: "on" })).toEqual({ enabled: true });
  });
});
