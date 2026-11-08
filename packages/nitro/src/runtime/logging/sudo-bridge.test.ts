import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_LOGGING_CONFIG } from "@facilis/core";
import {
  SudoAuditUnavailableError,
  resetSudoAuditSink,
  writeSudoAudit,
  type SudoAuditEvent,
} from "@facilis/db";

import {
  DEFAULT_LOG_KEEP,
  DEFAULT_LOG_MAX_BYTES,
  type ResolvedLogSettings,
} from "./log-settings.ts";
import { createLoggingRuntime } from "./runtime.ts";
import { installSudoAuditBridge, toSudoAuditEntry } from "./sudo-bridge.ts";

const EVENT: SudoAuditEvent = {
  event: "succeeded",
  id: "sudo-call-1",
  at: "2026-11-08T12:00:00.000Z",
  actorUserId: "user-1",
  actor: "user:user-1",
  sessionHash: "session-hash",
  roles: ["admin"],
  tenantId: "tenant-1",
  route: "/api/items",
  method: "POST",
  permission: "items:write",
  operation: "items:write",
  reason: "requires the system role",
  tables: ["items"],
  requestId: "request-12345678",
  outcome: "succeeded",
  durationMs: 12,
};

function stdoutSettings(): ResolvedLogSettings {
  return {
    mode: "stdout",
    sinks: { stdout: true, file: false },
    dir: "/tmp/facilis-logs-unused",
    maxBytes: DEFAULT_LOG_MAX_BYTES,
    keep: DEFAULT_LOG_KEEP,
    level: null,
  };
}

afterEach(() => {
  resetSudoAuditSink();
});

describe("toSudoAuditEntry", () => {
  it("maps the sudo event onto the audit stream's entry", () => {
    expect(toSudoAuditEntry(EVENT)).toEqual({
      kind: "audit",
      ts: EVENT.at,
      level: "info",
      event: "sudo:succeeded",
      actor: "user:user-1",
      userId: "user-1",
      sessionHash: "session-hash",
      tenantId: "tenant-1",
      roles: ["admin"],
      operation: "items:write",
      reason: "requires the system role",
      tables: ["items"],
      requestId: "request-12345678",
      method: "POST",
      path: "/api/items",
      outcome: "succeeded",
      durationMs: 12,
    });
  });
});

describe("installSudoAuditBridge", () => {
  it("routes db sudo events through the installed runtime", () => {
    const lines: string[] = [];
    const runtime = createLoggingRuntime({
      config: DEFAULT_LOGGING_CONFIG,
      settings: stdoutSettings(),
      writeStdout: (line) => lines.push(line),
    });
    installSudoAuditBridge(runtime);

    writeSudoAudit(EVENT);

    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({
      kind: "audit",
      event: "sudo:succeeded",
      actor: "user:user-1",
      operation: "items:write",
      requestId: "request-12345678",
    });
  });

  it("stays fail-closed when the audit sink is broken", () => {
    const root = mkdtempSync(join(tmpdir(), "facilis-sudo-bridge-"));
    const brokenDir = join(root, "logs");
    writeFileSync(brokenDir, "");
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
      installSudoAuditBridge(runtime);

      expect(() => writeSudoAudit(EVENT)).toThrow(SudoAuditUnavailableError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
