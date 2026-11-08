import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LOGGING_CONFIG, type AccessLogEntry } from "@facilis/core";

import { createBootstrapLogging, effectiveLoggingConfig } from "./bootstrap-logging.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "facilis-bootstrap-logging-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function accessEntry(): AccessLogEntry {
  return {
    kind: "access",
    ts: "2026-11-08T12:00:00.000Z",
    level: "info",
    requestId: "request-12345678",
    method: "GET",
    path: "/api/items",
    status: 200,
    durationMs: 2,
  };
}

describe("createBootstrapLogging", () => {
  it("uses the documented defaults when the project config failed", () => {
    const state = createBootstrapLogging({
      loggingConfig: null,
      env: {},
      projectRoot: root,
    });

    expect(state.config).toEqual(DEFAULT_LOGGING_CONFIG);
    expect(state.logging.settings.mode).toBe("auto");
    expect(state.logging.settings.sinks).toEqual({ stdout: false, file: true });
    expect(state.warnings).toEqual([]);
  });

  it("writes access entries into the project's .facilis/logs in development", () => {
    const state = createBootstrapLogging({
      loggingConfig: null,
      env: {},
      projectRoot: root,
    });

    state.logging.record(accessEntry());

    const path = join(root, ".facilis", "logs", "access.jsonl");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect((JSON.parse(lines[0] ?? "{}") as Record<string, unknown>)["kind"]).toBe("access");
  });

  it("honours the project logging config", () => {
    const state = createBootstrapLogging({
      loggingConfig: {
        level: "warn",
        access: false,
        errors: false,
        includeUserAgent: true,
        trustProxy: true,
      },
      env: {},
      projectRoot: root,
    });

    expect(state.config).toMatchObject({
      level: "warn",
      access: false,
      errors: false,
      includeUserAgent: true,
      trustProxy: true,
    });
    state.logging.record(accessEntry());
    expect(existsSync(join(root, ".facilis", "logs", "access.jsonl"))).toBe(false);
  });

  it("lets FACILIS_LOG_LEVEL override the config level", () => {
    const state = createBootstrapLogging({
      loggingConfig: DEFAULT_LOGGING_CONFIG,
      env: { FACILIS_LOG_LEVEL: "debug" },
      projectRoot: root,
    });

    expect(state.config.level).toBe("debug");
    expect(state.logging.config.level).toBe("debug");
  });

  it("keeps the config level and warns on an invalid override", () => {
    const state = createBootstrapLogging({
      loggingConfig: DEFAULT_LOGGING_CONFIG,
      env: { FACILIS_LOG_LEVEL: "verbose" },
      projectRoot: root,
    });

    expect(state.config.level).toBe("info");
    expect(state.warnings.map((warning) => warning.code)).toEqual(["logging_env_invalid"]);
  });

  it("defaults to stdout in production", () => {
    const lines: string[] = [];
    const state = createBootstrapLogging({
      loggingConfig: null,
      env: { NODE_ENV: "production" },
      projectRoot: root,
      writeStdout: (line) => lines.push(line),
    });

    expect(state.logging.settings.sinks).toEqual({ stdout: true, file: false });
    state.logging
      .logger({ requestId: "request-12345678", method: "GET", path: "/api/items" })
      .info("production line");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("production line");
  });

  it("forwards invalid environment values as warnings", () => {
    const state = createBootstrapLogging({
      loggingConfig: null,
      env: { FACILIS_LOG_SINK: "cloud", FACILIS_LOG_MAX_BYTES: "nope" },
      projectRoot: root,
    });

    expect(state.warnings.map((warning) => warning.code)).toEqual([
      "logging_env_invalid",
      "logging_env_invalid",
    ]);
    expect(state.logging.settings.maxBytes).toBe(10 * 1024 * 1024);
  });
});

describe("effectiveLoggingConfig", () => {
  it("falls back to the defaults", () => {
    expect(effectiveLoggingConfig(null, null)).toEqual(DEFAULT_LOGGING_CONFIG);
  });

  it("applies the level override without mutating the base", () => {
    const base = { ...DEFAULT_LOGGING_CONFIG, access: false };

    expect(effectiveLoggingConfig(base, "debug")).toEqual({ ...base, level: "debug" });
    expect(base.level).toBe("info");
  });
});
