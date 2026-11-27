import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LOGGING_CONFIG,
  type AccessLogEntry,
  type FacilisRuntimeConfig,
} from "@facilis.dev/core";

import { createBootstrapLogging } from "./bootstrap-logging.ts";

const RUNTIME: FacilisRuntimeConfig = { logLevel: "info" };

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
      runtime: RUNTIME,
      env: { NODE_ENV: "development" },
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
      runtime: RUNTIME,
      env: { NODE_ENV: "development" },
      projectRoot: root,
    });

    state.logging.record(accessEntry());

    const path = join(root, ".facilis", "logs", "access.jsonl");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect((JSON.parse(lines[0] ?? "{}") as Record<string, unknown>)["kind"]).toBe("access");
  });

  it("honours the project logging config and takes the level from runtime", () => {
    const state = createBootstrapLogging({
      loggingConfig: {
        access: false,
        errors: false,
        includeUserAgent: true,
      },
      runtime: { logLevel: "warn" },
      env: { NODE_ENV: "development" },
      projectRoot: root,
    });

    expect(state.config).toEqual({
      access: false,
      errors: false,
      includeUserAgent: true,
    });
    expect(state.logging.settings.level).toBe("warn");
    state.logging.record(accessEntry());
    expect(existsSync(join(root, ".facilis", "logs", "access.jsonl"))).toBe(false);
  });

  it("takes the level from runtime.logLevel", () => {
    const state = createBootstrapLogging({
      loggingConfig: DEFAULT_LOGGING_CONFIG,
      runtime: { logLevel: "debug" },
      env: { NODE_ENV: "development" },
      projectRoot: root,
    });

    expect(state.logging.settings.level).toBe("debug");
  });

  it("suppresses app entries and warns on an invalid level", () => {
    const state = createBootstrapLogging({
      loggingConfig: DEFAULT_LOGGING_CONFIG,
      runtime: { logLevel: "verbose" },
      env: { NODE_ENV: "development" },
      projectRoot: root,
    });

    expect(state.logging.settings.level).toBeNull();
    expect(state.warnings.map((warning) => warning.code)).toEqual(["logging_env_invalid"]);
  });

  it("suppresses app entries and warns when runtime.logLevel is not declared", () => {
    const state = createBootstrapLogging({
      loggingConfig: DEFAULT_LOGGING_CONFIG,
      runtime: {},
      env: { NODE_ENV: "development" },
      projectRoot: root,
    });

    expect(state.logging.settings.level).toBeNull();
    expect(state.warnings.map((warning) => warning.code)).toEqual(["logging_level_missing"]);
    expect(state.warnings[0]?.message).toContain("FACILIS_LOG_LEVEL");
  });

  it("defaults to stdout in production", () => {
    const lines: string[] = [];
    const state = createBootstrapLogging({
      loggingConfig: null,
      runtime: RUNTIME,
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
      runtime: { logLevel: "info", logSink: "cloud", logMaxBytes: Number.NaN },
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

