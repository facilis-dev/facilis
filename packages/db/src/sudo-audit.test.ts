import { afterEach, describe, expect, it, vi } from "vitest";

import {
  newSudoId,
  resetSudoAuditSink,
  setSudoAuditSink,
  SudoAuditUnavailableError,
  writeSudoAudit,
  type SudoAuditEvent,
} from "./sudo-audit.ts";

const EVENT: SudoAuditEvent = {
  event: "started",
  id: "audit-id-1",
  at: "2026-11-07T00:00:00.000Z",
  actor: "system:test",
  roles: [],
  operation: "test:operation",
  reason: "unit test",
  tables: ["documents"],
};

afterEach(() => {
  resetSudoAuditSink();
  vi.restoreAllMocks();
});

describe("sudo audit sink", () => {
  it("appends one JSON line to stdout by default", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    writeSudoAudit(EVENT);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("facilis:sudo " + JSON.stringify(EVENT));
  });

  it("delivers events to an injected sink and restores the default on reset", () => {
    const events: SudoAuditEvent[] = [];
    setSudoAuditSink((event) => events.push(event));
    writeSudoAudit(EVENT);
    expect(events).toEqual([EVENT]);

    resetSudoAuditSink();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    writeSudoAudit({ ...EVENT, event: "succeeded", outcome: "succeeded" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
  });

  it("fails closed when the sink throws", () => {
    setSudoAuditSink(() => {
      throw new Error("disk full");
    });

    try {
      writeSudoAudit(EVENT);
      throw new Error("writeSudoAudit should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SudoAuditUnavailableError);
      expect((error as SudoAuditUnavailableError).code).toBe("sudo_audit_unavailable");
    }
  });

  it("generates a UUID call id", () => {
    expect(newSudoId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
