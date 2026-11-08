import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_LOG_KEEP, DEFAULT_LOG_MAX_BYTES, resolveLogSettings } from "./log-settings.ts";

const ROOT = "/tmp/facilis-project";

function resolveWith(env: Record<string, string> = {}, production?: boolean) {
  return resolveLogSettings({
    env,
    projectRoot: ROOT,
    ...(production === undefined ? {} : { production }),
  });
}

describe("resolveLogSettings", () => {
  it("defaults to file output in development", () => {
    const { settings, warnings } = resolveWith();

    expect(settings.mode).toBe("auto");
    expect(settings.sinks).toEqual({ stdout: false, file: true });
    expect(settings.dir).toBe(resolve(ROOT, ".facilis", "logs"));
    expect(settings.maxBytes).toBe(DEFAULT_LOG_MAX_BYTES);
    expect(settings.keep).toBe(DEFAULT_LOG_KEEP);
    expect(settings.level).toBeNull();
    expect(warnings).toEqual([]);
  });

  it("auto resolves to stdout in production", () => {
    const { settings } = resolveWith({}, true);

    expect(settings.mode).toBe("auto");
    expect(settings.sinks).toEqual({ stdout: true, file: false });
  });

  it.each([
    ["stdout", { stdout: true, file: false }],
    ["file", { stdout: false, file: true }],
    ["both", { stdout: true, file: true }],
  ] as const)("honours FACILIS_LOG_SINK=%s", (mode, sinks) => {
    const { settings, warnings } = resolveWith({ FACILIS_LOG_SINK: mode });

    expect(settings.mode).toBe(mode);
    expect(settings.sinks).toEqual(sinks);
    expect(warnings).toEqual([]);
  });

  it("falls back to auto and warns on an unknown sink", () => {
    const { settings, warnings } = resolveWith({ FACILIS_LOG_SINK: "cloud" });

    expect(settings.mode).toBe("auto");
    expect(settings.sinks).toEqual({ stdout: false, file: true });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("logging_env_invalid");
    expect(warnings[0]?.message).toContain("FACILIS_LOG_SINK");
  });

  it("resolves a relative FACILIS_LOG_DIR against the project root", () => {
    const { settings } = resolveWith({ FACILIS_LOG_DIR: "custom/logs" });

    expect(settings.dir).toBe(resolve(ROOT, "custom", "logs"));
  });

  it("keeps an absolute FACILIS_LOG_DIR", () => {
    const { settings } = resolveWith({ FACILIS_LOG_DIR: "/var/log/facilis" });

    expect(settings.dir).toBe("/var/log/facilis");
  });

  it("parses the byte cap and keep count", () => {
    const { settings, warnings } = resolveWith({
      FACILIS_LOG_MAX_BYTES: "4096",
      FACILIS_LOG_KEEP: "0",
    });

    expect(settings.maxBytes).toBe(4096);
    expect(settings.keep).toBe(0);
    expect(warnings).toEqual([]);
  });

  it("falls back and warns on invalid numeric values", () => {
    const { settings, warnings } = resolveWith({
      FACILIS_LOG_MAX_BYTES: "0",
      FACILIS_LOG_KEEP: "-2",
    });

    expect(settings.maxBytes).toBe(DEFAULT_LOG_MAX_BYTES);
    expect(settings.keep).toBe(DEFAULT_LOG_KEEP);
    expect(warnings.map((warning) => warning.code)).toEqual([
      "logging_env_invalid",
      "logging_env_invalid",
    ]);
  });

  it("takes a valid FACILIS_LOG_LEVEL override", () => {
    const { settings, warnings } = resolveWith({ FACILIS_LOG_LEVEL: "debug" });

    expect(settings.level).toBe("debug");
    expect(warnings).toEqual([]);
  });

  it("ignores an invalid FACILIS_LOG_LEVEL with a warning", () => {
    const { settings, warnings } = resolveWith({ FACILIS_LOG_LEVEL: "verbose" });

    expect(settings.level).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("FACILIS_LOG_LEVEL");
  });
});
