import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { facilis, type FacilisVitePlugin } from "./vite.ts";
import { RESOLVED_OPENAPI_META_ID, VIRTUAL_OPENAPI_META_ID } from "./virtual-ids.ts";

const projectRoot = fileURLToPath(new URL("../test-fixtures/project", import.meta.url));
const absentRoot = fileURLToPath(new URL("../test-fixtures/absent", import.meta.url));

type HookFn = (this: unknown, ...args: unknown[]) => unknown;

function facilisPlugin(): FacilisVitePlugin {
  return facilis()[0];
}

function resolvedPlugin(): FacilisVitePlugin {
  const plugin = facilisPlugin();
  const configResolved = plugin.configResolved as HookFn;
  configResolved.call({}, { root: projectRoot });
  return plugin;
}

function warnSink(): { warn: (message: string) => void; warnings: string[] } {
  const warnings: string[] = [];
  return { warnings, warn: (message) => warnings.push(message) };
}

describe("facilis Vite plugin", () => {
  it("mounts Nitro itself: the framework plugin first, then Nitro's plugins", () => {
    const plugins = facilis();
    const plugin = plugins[0];

    expect(plugin.name).toBe("facilis");
    expect(plugin.enforce).toBe("pre");
    expect(plugin.nitro.name).toBe("facilis");
    expect(plugin.nitro.setup).toBeTypeOf("function");
    // No nitro/vite import is left to the project (D-034): facilis() brings the plugins.
    expect(plugins.length).toBeGreaterThan(1);
    expect(plugins.some((entry) => entry.name === "nitro:init")).toBe(true);
  });

  it("delivers the project Nitro options through the Vite user-config nitro key", async () => {
    const config = facilisPlugin().config as HookFn;

    const result = await config.call({}, { root: projectRoot }, { command: "serve" });

    expect(result).toEqual({
      nitro: {
        serverDir: "./server",
        experimental: { openAPI: true },
        devServer: { runner: "self" },
      },
    });
  });

  it("falls back to the Facilis Nitro defaults when the project has no config file", async () => {
    const config = facilisPlugin().config as HookFn;

    const result = await config.call({}, { root: absentRoot }, { command: "serve" });

    expect(result).toEqual({ nitro: { serverDir: "./server", experimental: { openAPI: true } } });
  });

  it("resolves the metadata virtual module to a null-prefixed id", () => {
    const plugin = facilisPlugin();
    const resolveId = plugin.resolveId as HookFn;
    expect(resolveId.call({}, VIRTUAL_OPENAPI_META_ID, undefined)).toBe(RESOLVED_OPENAPI_META_ID);
    expect(resolveId.call({}, "some-other-module", undefined)).toBeNull();
  });

  it("loads the scanned metadata map as the virtual module", async () => {
    const plugin = resolvedPlugin();
    const load = plugin.load as HookFn;
    const sink = warnSink();
    const code = (await load.call(sink, RESOLVED_OPENAPI_META_ID)) as string;

    expect(code.startsWith("export default ")).toBe(true);
    expect(code).toContain('"/api/todos"');
    expect(code).toContain('"/health"');
    expect(code).toContain("meta-not-static");
    // Warnings are route-level (attached to the metadata), not file-level here.
    expect(sink.warnings).toEqual([]);
  });

  it("ignores non-virtual module ids", async () => {
    const plugin = resolvedPlugin();
    const load = plugin.load as HookFn;
    expect(await load.call(warnSink(), "/abs/some/file.ts")).toBeNull();
  });

  it("accepts a custom routesDir relative to the Vite root", async () => {
    const plugin = facilis({ routesDir: "test-fixtures/project/server/routes" })[0];
    const configResolved = plugin.configResolved as HookFn;
    configResolved.call({}, { root: process.cwd() });
    const load = plugin.load as HookFn;
    const code = (await load.call(warnSink(), RESOLVED_OPENAPI_META_ID)) as string;
    expect(code).toContain('"/api/todos"');
  });

  it("returns an empty map when the routes directory does not exist", async () => {
    const plugin = facilis({ routesDir: "test-fixtures/absent" })[0];
    const configResolved = plugin.configResolved as HookFn;
    configResolved.call({}, { root: projectRoot });
    const load = plugin.load as HookFn;
    expect(await load.call(warnSink(), RESOLVED_OPENAPI_META_ID)).toBe("export default {};");
  });
});
