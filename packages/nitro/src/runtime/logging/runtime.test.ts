import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LOGGING_CONFIG,
  type AccessLogEntry,
  type AuditLogEntry,
  type ErrorLogEntry,
  type FacilisLoggingConfig,
  type FacilisLogRequestMeta,
} from "@facilis.dev/core";

import {
  DEFAULT_LOG_KEEP,
  DEFAULT_LOG_MAX_BYTES,
  type ResolvedLogSettings,
} from "./log-settings.ts";
import { createLoggingRuntime } from "./runtime.ts";

const TIMESTAMP = "2026-11-08T12:00:00.000Z";

function accessEntry(): AccessLogEntry {
  return {
    kind: "access",
    ts: TIMESTAMP,
    level: "info",
    requestId: "request-12345678",
    method: "POST",
    path: "/api/items",
    status: 201,
    durationMs: 5,
  };
}

function errorEntry(): ErrorLogEntry {
  return {
    kind: "error",
    ts: TIMESTAMP,
    level: "error",
    requestId: "request-12345678",
    code: "internal_error",
    name: "Error",
    message: "database exploded",
    method: "POST",
    path: "/api/items",
  };
}

function auditEntry(): AuditLogEntry {
  return {
    kind: "audit",
    ts: TIMESTAMP,
    level: "info",
    requestId: "request-12345678",
    event: "sudo:started",
    actor: "user:user-1",
  };
}

function meta(overrides: Partial<FacilisLogRequestMeta> = {}): FacilisLogRequestMeta {
  return { requestId: "request-12345678", method: "POST", path: "/api/items", ...overrides };
}

interface RuntimeOverrides {
  readonly config?: Partial<FacilisLoggingConfig>;
  readonly settings?: Partial<ResolvedLogSettings>;
}

function stdoutRuntime(overrides: RuntimeOverrides = {}) {
  const lines: string[] = [];
  const config: FacilisLoggingConfig = { ...DEFAULT_LOGGING_CONFIG, ...overrides.config };
  const settings: ResolvedLogSettings = {
    mode: "stdout",
    sinks: { stdout: true, file: false },
    dir: "/tmp/facilis-logs-unused",
    maxBytes: DEFAULT_LOG_MAX_BYTES,
    keep: DEFAULT_LOG_KEEP,
    level: null,
    ...overrides.settings,
  };
  const runtime = createLoggingRuntime({
    config,
    settings,
    writeStdout: (line) => lines.push(line),
    now: () => new Date(TIMESTAMP),
  });
  return {
    runtime,
    entries: (): Record<string, unknown>[] =>
      lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe("createLoggingRuntime", () => {
  it("records access, error and app entries through one pipeline", () => {
    const { runtime, entries } = stdoutRuntime();

    runtime.record(accessEntry());
    runtime.record(errorEntry());
    runtime.logger(meta()).info("handler started", { step: 1 });

    expect(entries().map((entry) => entry["kind"])).toEqual(["access", "error", "app"]);
    expect(entries()[2]).toMatchObject({
      ts: TIMESTAMP,
      level: "info",
      message: "handler started",
      requestId: "request-12345678",
      method: "POST",
      path: "/api/items",
      data: { step: 1 },
    });
  });

  it("honours the access and errors switches", () => {
    const { runtime, entries } = stdoutRuntime({ config: { access: false, errors: false } });

    runtime.record(accessEntry());
    runtime.record(errorEntry());

    expect(entries()).toHaveLength(0);
  });

  it("filters app entries by level", () => {
    const { runtime, entries } = stdoutRuntime({ config: { level: "warn" } });
    const log = runtime.logger(meta());

    log.debug("debug");
    log.info("info");
    log.warn("warn");
    log.error("error");

    expect(entries().map((entry) => entry["message"])).toEqual(["warn", "error"]);
  });

  it("never filters audit entries", () => {
    const { runtime, entries } = stdoutRuntime({
      config: { level: "error", access: false, errors: false },
    });

    runtime.record(auditEntry());
    runtime.logger(meta()).audit({ operation: "items:write" });

    expect(entries()).toHaveLength(2);
  });

  it("derives the audit event and actor from the request meta", () => {
    const { runtime, entries } = stdoutRuntime();
    runtime
      .logger(
        meta({
          userId: "user-1",
          sessionHash: "session-hash",
          tenantId: "tenant-1",
          ip: "203.0.113.7",
        }),
      )
      .audit({
        operation: "order:create",
        outcome: "failed",
        errorCode: "conflict",
        reason: "duplicate order",
        tables: ["orders"],
        details: { token: "secret", attempt: 2 },
      });

    const entry = entries()[0];
    expect(entry).toMatchObject({
      kind: "audit",
      event: "order:create",
      actor: "user:user-1",
      userId: "user-1",
      sessionHash: "session-hash",
      tenantId: "tenant-1",
      ip: "203.0.113.7",
      requestId: "request-12345678",
      method: "POST",
      path: "/api/items",
      outcome: "failed",
      errorCode: "conflict",
      reason: "duplicate order",
      tables: ["orders"],
    });
    expect(entry?.["details"]).toEqual({ token: "[redacted]", attempt: 2 });
    // Stdout entries are plain JSON objects; the hash chain belongs to the file sink.
    expect(entry?.["seq"]).toBeUndefined();
    expect(entry?.["hash"]).toBeUndefined();
  });

  it("uses the anonymous actor when there is no user", () => {
    const { runtime, entries } = stdoutRuntime();
    runtime.logger(meta()).audit({ operation: "boot:seed" });

    expect(entries()[0]?.["actor"]).toBe("anonymous");
  });

  it("caps message strings and redacts app data", () => {
    const { runtime, entries } = stdoutRuntime();
    runtime.logger(meta()).info("m".repeat(2000), {
      long: "d".repeat(2000),
      password: "pw",
    });

    const entry = entries()[0];
    expect(entry?.["message"]).toHaveLength(1000);
    expect(entry?.["data"]).toEqual({ long: "d".repeat(1000), password: "[redacted]" });
  });

  it("caps a hostile client ip on every kind", () => {
    const { runtime, entries } = stdoutRuntime();
    const hugeIp = "x".repeat(10_000);

    runtime.record({ ...accessEntry(), ip: hugeIp });
    runtime.record({ ...errorEntry(), ip: hugeIp });
    runtime.record({ ...auditEntry(), ip: hugeIp });
    runtime.logger(meta({ ip: hugeIp })).info("with a client ip");

    expect(entries()).toHaveLength(4);
    for (const entry of entries()) {
      expect((entry["ip"] as string).length).toBe(200);
    }
  });

  it("drops broken best-effort writes once and fails closed for audit", () => {
    const root = mkdtempSync(join(tmpdir(), "facilis-log-runtime-"));
    const brokenDir = join(root, "logs");
    writeFileSync(brokenDir, "");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const runtime = createLoggingRuntime({
        config: DEFAULT_LOGGING_CONFIG,
        settings: {
          mode: "file",
          sinks: { stdout: false, file: true },
          dir: brokenDir,
          maxBytes: DEFAULT_LOG_MAX_BYTES,
          keep: DEFAULT_LOG_KEEP,
          level: null,
        },
      });

      expect(runtime.warnings[0]?.code).toBe("logging_dir_unwritable");
      expect(() => runtime.record(accessEntry())).not.toThrow();
      expect(() => runtime.record(errorEntry())).not.toThrow();
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(() => runtime.record(auditEntry())).toThrow();
    } finally {
      consoleError.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
