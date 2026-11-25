import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedTelemetry } from "@/deploy/types";
import { openTelemetryDashboard, telemetryLinkoutTarget } from "./telemetry-linkout";

// A fully-configured enabled policy; each case overrides only the field it exercises.
function telemetry(patch: Partial<ResolvedTelemetry> = {}): ResolvedTelemetry {
  return {
    enabled: true,
    be: { enabled: true },
    fe: { enabled: true },
    exporterEndpoint: "https://collector.example/v1/traces",
    tenantKey: "public-key",
    sampling: 1,
    originAllowlist: [],
    dashboardUrl: "https://ops.example/grafana",
    ...patch,
  };
}

describe("telemetryLinkoutTarget", () => {
  it("returns the dashboard URL when telemetry is enabled and a URL is set", () => {
    expect(telemetryLinkoutTarget(telemetry())).toBe("https://ops.example/grafana");
  });

  it("is null when telemetry is disabled, even with a URL left over", () => {
    expect(telemetryLinkoutTarget(telemetry({ enabled: false }))).toBeNull();
  });

  it("is null when enabled but no dashboard URL is configured", () => {
    expect(telemetryLinkoutTarget(telemetry({ dashboardUrl: null }))).toBeNull();
  });
});

describe("openTelemetryDashboard", () => {
  // The helper only touches window.open; stub it like preview-popout.test.ts does.
  beforeEach(() => {
    vi.stubGlobal("window", { open: vi.fn(() => ({})) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the URL in an external tab with noopener", () => {
    openTelemetryDashboard("https://ops.example/grafana");
    expect(window.open).toHaveBeenCalledWith("https://ops.example/grafana", "_blank", "noopener");
  });
});
