import { describe, expect, it, vi } from "vitest";
import type { ConfigPluginContext, UserConfig } from "vite";

import { TELEMETRY_TRACES_ROUTE } from "./constants.ts";
import { facilisRum, RUM_CONFIG_DEFINE, RUM_PLUGIN_NAME } from "./vite-rum.ts";

const ON = {
  FACILIS_TELEMETRY: "on",
  FACILIS_TELEMETRY_FE: "on",
  FACILIS_TELEMETRY_TENANT_KEY: "pub_write_only_1",
};

function runConfig(env: Record<string, string>, base: UserConfig = {}): UserConfig {
  const plugin = facilisRum(env);
  // apply is "build"; the hook itself is what Vite calls during a build. Vite 8 binds a
  // plugin context as `this`; the hook never logs, so empty sinks suffice.
  if (typeof plugin.config !== "function") throw new Error("config hook missing");
  const context = {
    error: () => {},
    info: () => {},
    warn: () => {},
    debug: () => {},
    meta: { framework: "vite" },
  } as unknown as ConfigPluginContext;
  plugin.config.call(context, base, { command: "build", mode: "production" });
  return base;
}

describe("facilisRum — build-only companion", () => {
  it("is named and applies to build only (dev stays silent, D-200)", () => {
    const plugin = facilisRum({});
    expect(plugin.name).toBe(RUM_PLUGIN_NAME);
    expect(plugin.apply).toBe("build");
  });

  it("defines null when disabled, preserving existing defines", () => {
    const config = runConfig({}, { define: { OTHER: "1" } });
    expect(config.define?.[RUM_CONFIG_DEFINE]).toBe("null");
    expect(config.define?.["OTHER"]).toBe("1");
  });

  it("defines null when FE is off or the key is missing", () => {
    expect(runConfig({ FACILIS_TELEMETRY: "on" }).define?.[RUM_CONFIG_DEFINE]).toBe("null");
    expect(
      runConfig({ FACILIS_TELEMETRY: "on", FACILIS_TELEMETRY_FE: "on" }).define?.[
        RUM_CONFIG_DEFINE
      ],
    ).toBe("null");
  });

  it("injects the resolved JSON literal when enabled", () => {
    const config = runConfig(
      {
        ...ON,
        FACILIS_TELEMETRY_SAMPLING: "0.5",
        FACILIS_TELEMETRY_SERVICE: "acme-shop",
        FACILIS_DEPLOYMENT_ID: "dep-1",
      },
      { define: { OTHER: "1" } },
    );
    expect(config.define?.["OTHER"]).toBe("1");
    const literal = config.define?.[RUM_CONFIG_DEFINE];
    expect(typeof literal).toBe("string");
    expect(JSON.parse(literal as string)).toEqual({
      tenantKey: "pub_write_only_1",
      endpoint: TELEMETRY_TRACES_ROUTE,
      sampling: 0.5,
      serviceName: "acme-shop",
      deploymentId: "dep-1",
    });
  });

  it("never logs the tenant key", () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    runConfig(ON);
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain("pub_write_only_1");
      }
      spy.mockRestore();
    }
  });
});
