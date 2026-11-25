import { afterEach, describe, expect, it } from "vitest";
import { readRumConfig } from "./config.ts";
import type { RumConfig } from "./config.ts";

const GLOBAL = globalThis as Record<string, unknown>;
const KEY = "__FACILIS_RUM_CONFIG__";

function valid(): RumConfig {
  return {
    tenantKey: "pub_write_only_1",
    endpoint: "/__facilis/telemetry/v1/traces",
    sampling: 0.25,
    serviceName: "acme-shop",
    deploymentId: "dep-1",
  };
}

afterEach(() => {
  delete GLOBAL[KEY];
});

describe("readRumConfig — gating", () => {
  it("is null when the define is absent (unbundled/dev import)", () => {
    expect(readRumConfig()).toBeNull();
  });

  it("is null when the build defined null (disabled build)", () => {
    GLOBAL[KEY] = null;
    expect(readRumConfig()).toBeNull();
  });

  it("is null for a non-object literal", () => {
    for (const value of ["on", 1, true]) {
      GLOBAL[KEY] = value;
      expect(readRumConfig()).toBeNull();
    }
  });

  it("reads a valid literal unchanged", () => {
    GLOBAL[KEY] = valid();
    expect(readRumConfig()).toEqual(valid());
  });
});

describe("readRumConfig — validation", () => {
  it("rejects an empty or whitespace-bearing tenant key (fail-closed)", () => {
    for (const tenantKey of ["", " ", "pub key", "pub\tkey"]) {
      GLOBAL[KEY] = { ...valid(), tenantKey };
      expect(readRumConfig()).toBeNull();
    }
  });

  it("rejects a missing or non-string endpoint", () => {
    for (const endpoint of ["", 42, null, undefined]) {
      GLOBAL[KEY] = { ...valid(), endpoint };
      expect(readRumConfig()).toBeNull();
    }
  });

  it("rejects a missing or empty serviceName", () => {
    for (const serviceName of ["", 42, undefined]) {
      GLOBAL[KEY] = { ...valid(), serviceName };
      expect(readRumConfig()).toBeNull();
    }
  });

  it("keeps a valid sampling ratio, including the 0 and 1 edges", () => {
    for (const sampling of [0, 0.25, 1]) {
      GLOBAL[KEY] = { ...valid(), sampling };
      expect(readRumConfig()?.sampling).toBe(sampling);
    }
  });

  it("falls back to 1 for an invalid sampling (mirrors the backend)", () => {
    for (const sampling of [Number.NaN, Infinity, -0.1, 2, "0.5", null, undefined]) {
      GLOBAL[KEY] = { ...valid(), sampling };
      expect(readRumConfig()?.sampling).toBe(1);
    }
  });

  it("normalizes a non-string deploymentId to null", () => {
    GLOBAL[KEY] = { ...valid(), deploymentId: 7 };
    expect(readRumConfig()?.deploymentId).toBeNull();
    GLOBAL[KEY] = { ...valid(), deploymentId: null };
    expect(readRumConfig()?.deploymentId).toBeNull();
  });
});
