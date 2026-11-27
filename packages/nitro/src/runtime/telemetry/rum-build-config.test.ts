import { describe, expect, it } from "vitest";

import { TELEMETRY_TRACES_ROUTE } from "../../constants.ts";
import { readRumBuildConfig } from "./rum-build-config.ts";

const ON = {
  FACILIS_TELEMETRY_ENABLED: "on",
  FACILIS_TELEMETRY_FE: "on",
  FACILIS_TELEMETRY_TENANT_KEY: "pub_write_only_1",
};

describe("readRumBuildConfig — off by default", () => {
  it("is null with an empty environment", () => {
    expect(readRumBuildConfig({})).toBeNull();
  });

  it("is null with the master switch on but FE unset (FE is an explicit opt-in)", () => {
    expect(
      readRumBuildConfig({ FACILIS_TELEMETRY_ENABLED: "on", FACILIS_TELEMETRY_TENANT_KEY: "k" }),
    ).toBeNull();
  });

  it("is null with FE on but the master switch off", () => {
    expect(
      readRumBuildConfig({ FACILIS_TELEMETRY_FE: "on", FACILIS_TELEMETRY_TENANT_KEY: "k" }),
    ).toBeNull();
  });

  it("is null unless both switches are exactly on (trimmed)", () => {
    expect(readRumBuildConfig({ ...ON, FACILIS_TELEMETRY_ENABLED: "true" })).toBeNull();
    expect(readRumBuildConfig({ ...ON, FACILIS_TELEMETRY_FE: "1" })).toBeNull();
    expect(
      readRumBuildConfig({ ...ON, FACILIS_TELEMETRY_ENABLED: " on ", FACILIS_TELEMETRY_FE: " on " }),
    ).not.toBeNull();
  });
});

describe("readRumBuildConfig — tenant key gate", () => {
  it("is null without a key (the route would reject every POST)", () => {
    expect(readRumBuildConfig({ FACILIS_TELEMETRY_ENABLED: "on", FACILIS_TELEMETRY_FE: "on" })).toBeNull();
  });

  it("is null for an empty or whitespace-bearing key", () => {
    for (const key of ["", "   ", "pub key", "pub\tkey"]) {
      expect(readRumBuildConfig({ ...ON, FACILIS_TELEMETRY_TENANT_KEY: key })).toBeNull();
    }
  });
});

describe("readRumBuildConfig — resolved literal", () => {
  it("defaults sampling to 1, service to facilis-app, deploymentId to null", () => {
    expect(readRumBuildConfig(ON)).toEqual({
      tenantKey: "pub_write_only_1",
      endpoint: TELEMETRY_TRACES_ROUTE,
      sampling: 1,
      serviceName: "facilis-app",
      deploymentId: null,
    });
  });

  it("targets the framework ingestion route constant", () => {
    expect(readRumBuildConfig(ON)?.endpoint).toBe("/__facilis/telemetry/v1/traces");
  });

  it("parses sampling like the backend config", () => {
    expect(readRumBuildConfig({ ...ON, FACILIS_TELEMETRY_SAMPLING: "0.25" })?.sampling).toBe(0.25);
    expect(readRumBuildConfig({ ...ON, FACILIS_TELEMETRY_SAMPLING: "0" })?.sampling).toBe(0);
    for (const raw of ["abc", "2", "-1", ""]) {
      expect(readRumBuildConfig({ ...ON, FACILIS_TELEMETRY_SAMPLING: raw })?.sampling).toBe(1);
    }
  });

  it("honors service and deployment overrides", () => {
    const config = readRumBuildConfig({
      ...ON,
      FACILIS_TELEMETRY_SERVICE: "acme-shop",
      FACILIS_DEPLOYMENT_ID: "dep-1",
    });
    expect(config?.serviceName).toBe("acme-shop");
    expect(config?.deploymentId).toBe("dep-1");
  });
});
